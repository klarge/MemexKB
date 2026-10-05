import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express from "express";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db, pool, usersTable, passwordResetTokensTable, apiTokensTable, groupsTable, groupMembersTable } from "@workspace/db";
import { decodeBackup, encodeBackup } from "./sso-only-backup-codec";

const schema = process.env.BACKUP_TEST_SCHEMA;
assert.match(schema ?? "", /^backup_test_[a-f0-9]{32}$/);
pool.options.max = 1;
const actual = await db.execute(sql`SELECT current_schema() AS schema, current_setting('search_path') AS path`);
assert.equal(actual.rows[0].schema, schema);
assert.equal(actual.rows[0].path, schema, "No public schema fallback is permitted");

const { default: users } = await import("../../src/routes/users");
const { default: auth } = await import("../../src/routes/auth");
const { default: fullBackup } = await import("../../src/routes/admin-full-backup");
const { provisionUser } = await import("../../src/routes/sso-auth");
const [admin] = await db.insert(usersTable).values({
  email: "isolated-admin@example.test", name: "Isolated admin", role: "admin",
  passwordHash: await bcrypt.hash("isolated-admin-password", 10),
}).returning();
const app = express();
app.use(express.json());
app.use(async (req, _res, next) => {
  const id = Number(req.headers["x-test-actor"] ?? 0);
  const [user] = id ? await db.select().from(usersTable).where(eq(usersTable.id, id)) : [];
  (req as any).session = {
    userId: user?.id, userRole: user?.role,
    regenerate: (done: (error?: Error) => void) => done(),
    // Model the real session store's shared-pool I/O with a one-connection pool.
    save: (done: (error?: Error) => void) => {
      (async () => {
        await db.execute(sql`SELECT 1`);
        if (req.headers["x-test-enable-sso-on-save"]) {
          await db.update(usersTable).set({ ssoOnly: true }).where(eq(usersTable.id, Number(req.headers["x-test-enable-sso-on-save"])));
        }
      })().then(() => done(), done);
    },
    destroy: (done: () => void) => done(),
  };
  (req as any).log = { error: () => undefined, warn: () => undefined };
  next();
});
app.use("/api", users, auth, fullBackup);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
const password = "original-local-password";
const nextPassword = "deliberately-new-password";
const passphrase = "isolated-sso-backup-passphrase";

async function json(path: string, body?: unknown, actor = admin.id, method = body === undefined ? "GET" : "POST") {
  return fetch(base + path, {
    method, headers: { "Content-Type": "application/json", "x-test-actor": String(actor) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function login(email: string, password: string) { return json("/auth/login", { email, password }, 0); }
async function archiveRequest(path: string, archive: Buffer) {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(archive)]), "fixture.mex");
  form.append("passphrase", passphrase);
  form.append("mode", "replace");
  form.append("confirmation", "RESTORE");
  return fetch(base + path, { method: "POST", headers: { "x-test-actor": String(admin.id) }, body: form });
}
async function userRecord(id: number) {
  return (await db.select().from(usersTable).where(eq(usersTable.id, id)))[0];
}

try {
  const localResponse = await json("/users", { email: "local@example.test", name: "Local user", role: "editor", password });
  assert.equal(localResponse.status, 201);
  const local = await localResponse.json();
  assert.equal(local.ssoOnly, false, "Existing/default local behavior is preserved");
  assert.equal((await login(local.email, password)).status, 200);

  const onlyResponse = await json("/users", { email: "only@example.test", name: "SSO user", role: "user", ssoOnly: true });
  assert.equal(onlyResponse.status, 201, "SSO-only creation needs no local password");
  const only = await onlyResponse.json();
  assert.equal(only.ssoOnly, true);
  assert.equal((await (await json(`/users/${only.id}`)).json()).ssoOnly, true);
  assert.equal((await (await json("/users")).json()).find((u: any) => u.id === only.id).ssoOnly, true);
  assert.equal((await json("/users", { email: "bad@example.test", name: "Invalid", role: "user", ssoOnly: "true" })).status, 400);
  assert.equal((await json("/users", { email: "short@example.test", name: "Invalid", role: "user", password: "short" })).status, 400);
  assert.equal((await json(`/users/${only.id}`, { password }, admin.id, "PATCH")).status, 400);
  assert.equal((await json(`/users/${only.id}`, { ssoOnly: false }, admin.id, "PATCH")).status, 400);
  assert.equal((await json(`/users/${only.id}`, { ssoOnly: false, password: "short" }, admin.id, "PATCH")).status, 400);
  assert.equal((await userRecord(only.id)).ssoOnly, true);

  const [group] = await db.insert(groupsTable).values({ name: "Isolated SSO group" }).returning();
  await db.insert(groupMembersTable).values({ groupId: group.id, userId: local.id });
  const linkToken = "isolated-unused-reset-token";
  await db.insert(passwordResetTokensTable).values({
    userId: local.id, tokenHash: createHash("sha256").update(linkToken).digest("hex"),
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal((await json(`/users/${local.id}`, { ssoOnly: true }, admin.id, "PATCH")).status, 200);
  assert.equal((await login(local.email, password)).status, 401);
  assert.equal((await (await json("/auth/me", undefined, local.id)).json()).ssoOnly, true);
  assert.equal((await json("/auth/change-password", { currentPassword: password, newPassword: nextPassword }, local.id)).status, 403);
  assert.equal((await json("/auth/recovery/reset", { token: linkToken, newPassword: nextPassword }, 0)).status, 400);
  assert.equal((await json(`/users/${local.id}`, { password: nextPassword }, admin.id, "PATCH")).status, 400);
  assert.equal((await json(`/users/${local.id}`, { name: "Updated SSO user" }, admin.id, "PATCH")).status, 200);
  assert.equal((await userRecord(local.id)).ssoOnly, true);

  // Even a correct retained hash or a separately issued token cannot bypass the flag.
  const retainedHash = await bcrypt.hash(password, 10);
  await db.update(usersTable).set({ passwordHash: retainedHash }).where(eq(usersTable.id, local.id));
  await db.insert(passwordResetTokensTable).values({
    userId: local.id, tokenHash: createHash("sha256").update(linkToken).digest("hex"),
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal((await login(local.email, password)).status, 401);
  assert.equal((await json("/auth/recovery/reset", { token: linkToken, newPassword: nextPassword }, 0)).status, 400);
  assert.equal((await userRecord(local.id)).passwordHash, retainedHash);

  const key = "isolated-authorized-api-key";
  await db.insert(apiTokensTable).values({
    userId: local.id, name: "Isolated key", tokenHash: createHash("sha256").update(key).digest("hex"),
  });
  const me = await fetch(base + "/auth/me", { headers: { Authorization: `Bearer ${key}` } });
  assert.equal(me.status, 200, "Authorized API keys still work for SSO-only accounts");
  assert.equal((await me.json()).id, local.id);

  for (const provider of ["saml", "oidc"]) {
    const provisioned = await provisionUser(`${provider}@example.test`, `${provider} user`, provider, `${provider}-identity`);
    assert.equal(provisioned.ssoOnly, true);
    assert.equal(provisioned.role, "user");
    assert.equal(provisioned.ssoProvider, provider);
    assert.equal((await login(provisioned.email, password)).status, 401);
    assert.equal((await provisionUser(local.email, "Replacement name", provider, `${provider}-existing`)).ssoOnly, true);
    assert.equal((await userRecord(local.id)).role, "editor", "SSO linking never broadens a role");
  }
  assert.equal((await db.select().from(groupMembersTable).where(eq(groupMembersTable.userId, local.id))).length, 1);
  assert.equal((await json(`/users/${local.id}`, { ssoOnly: false, password: nextPassword }, admin.id, "PATCH")).status, 200);
  assert.equal((await login(local.email, password)).status, 401, "An old password is not reactivated");
  assert.equal((await login(local.email, nextPassword)).status, 200);
  for (const provider of ["saml", "oidc"]) {
    assert.equal((await provisionUser(local.email, "Another name", provider, `${provider}-existing`)).ssoOnly, false, "SSO preserves an administrator's local-login choice");
  }

  // Reproduce a mode change during bcrypt, before the final session grant.
  const originalCompare = bcrypt.compare;
  (bcrypt as any).compare = async (supplied: string, hash: string) => {
    const matched = await originalCompare(supplied, hash);
    assert.equal((await json(`/users/${local.id}`, { ssoOnly: true }, admin.id, "PATCH")).status, 200);
    return matched;
  };
  try {
    assert.equal((await login(local.email, nextPassword)).status, 401, "A concurrent SSO-only change must prevent a password session");
  } finally {
    bcrypt.compare = originalCompare;
  }
  assert.equal((await json(`/users/${local.id}`, { ssoOnly: false, password: nextPassword }, admin.id, "PATCH")).status, 200);

  const lateChange = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-enable-sso-on-save": String(local.id) },
    body: JSON.stringify({ email: local.email, password: nextPassword }),
  });
  assert.equal(lateChange.status, 401, "A flag enabled during session persistence must revoke the attempted login");
  assert.equal((await json(`/users/${local.id}`, { ssoOnly: false, password: nextPassword }, admin.id, "PATCH")).status, 200);

  const exportResponse = await json("/admin/full-backup/export", { passphrase });
  assert.equal(exportResponse.status, 200);
  const encrypted = Buffer.from(await exportResponse.arrayBuffer());
  const backup = decodeBackup(encrypted, passphrase);
  assert.equal(backup.data.users.find((u: any) => u.id === only.id).ssoOnly, true);
  for (const row of backup.data.users) {
    assert.equal("passwordHash" in row, false, "No password hashes are exported");
    assert.equal("mustResetPassword" in row, false);
  }
  const restoredResponse = await archiveRequest("/admin/full-backup/restore", encrypted);
  assert.equal(restoredResponse.status, 200);
  const restored = await restoredResponse.json();
  assert.equal(restored.recoveryLinks.some((l: any) => l.userId === only.id), false);
  assert.equal(restored.ssoOnlyUsers.some((u: any) => u.userId === only.id), true);
  const onlyRestored = await userRecord(only.id);
  assert.equal(onlyRestored.ssoOnly, true);
  assert.equal(onlyRestored.mustResetPassword, false);
  assert.equal((await db.select().from(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, only.id))).length, 0);
  const localRecovery = restored.recoveryLinks.find((l: any) => l.userId === local.id);
  assert.ok(localRecovery);
  assert.equal((await json("/auth/recovery/reset", {
    token: new URL(localRecovery.recoveryUrl, base).searchParams.get("token"), newPassword: nextPassword,
  }, 0)).status, 200);

  // Legacy archives do not infer a restriction from SSO linkage.
  for (const row of backup.data.users) delete row.ssoOnly;
  const legacyResponse = await archiveRequest("/admin/full-backup/restore", encodeBackup(backup, passphrase));
  assert.equal(legacyResponse.status, 200);
  const legacy = await legacyResponse.json();
  assert.equal(legacy.recoveryLinks.length, backup.data.users.length);
  assert.equal((await userRecord(only.id)).ssoOnly, false);
  assert.equal((await userRecord(only.id)).mustResetPassword, true);
  assert.equal((await userRecord(local.id)).ssoOnly, false);

  backup.data.users[0].ssoOnly = "true";
  assert.equal((await archiveRequest("/admin/full-backup/preview", encodeBackup(backup, passphrase))).status, 400, "Invalid flags are rejected, never silently downgraded");
  backup.data.users[0].ssoOnly = true;
  const unsafeArchive = encodeBackup(backup, passphrase);
  const preview = await archiveRequest("/admin/full-backup/preview", unsafeArchive);
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).hasLocalAdministrator, false);
  assert.equal((await archiveRequest("/admin/full-backup/restore", unsafeArchive)).status, 400, "No administrator lockout via restore");
  assert.equal((await userRecord(admin.id)).ssoOnly, false, "Rejected restore changes no data");
  console.log("SSO Only: create/edit, retained-password rejection, change/reset guards, both provisioning paths, roles/groups/API keys, explicit local re-enable, backup round trips and legacy defaults passed.");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
}