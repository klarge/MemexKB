import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import express from "express";
import { sql, eq } from "drizzle-orm";
import * as records from "@workspace/db";
import { seedBackupFixtures } from "./backup-fixtures";

const schema = process.env.BACKUP_TEST_SCHEMA;
assert.match(schema ?? "", /^backup_test_[a-f0-9]{32}$/);
const actual = await records.db.execute(sql`SELECT current_schema() AS schema, current_setting('search_path') AS path`);
assert.equal(actual.rows[0].schema, schema);
assert.equal(actual.rows[0].path, schema, "Never allow public-schema fallback during destructive tests");
const outside = await records.db.execute(sql`
  SELECT c.conname FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_class r ON r.oid = c.confrelid JOIN pg_namespace rn ON rn.oid = r.relnamespace
  WHERE c.contype = 'f' AND n.nspname = current_schema() AND rn.nspname <> current_schema()
`);
assert.equal(outside.rows.length, 0, "No test FK may reach a live table");
const outsideSequences = await records.db.execute(sql`
  SELECT t.relname FROM pg_attrdef d
  JOIN pg_class t ON t.oid = d.adrelid JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_depend dep ON dep.classid = 'pg_attrdef'::regclass AND dep.objid = d.oid AND dep.refclassid = 'pg_class'::regclass
  JOIN pg_class s ON s.oid = dep.refobjid JOIN pg_namespace sn ON sn.oid = s.relnamespace
  WHERE n.nspname = current_schema() AND s.relkind = 'S' AND sn.nspname <> current_schema()
`);
assert.equal(outsideSequences.rows.length, 0, "No test insert may advance a live serial sequence");

// Load production handlers only after isolation is established. Fake sessions
// stand in for sign-in; these tests exercise actual archive and authorization APIs.
const { default: admin } = await import("../../src/routes/admin");
const { default: fullBackup } = await import("../../src/routes/admin-full-backup");
const { default: articles } = await import("../../src/routes/articles");
const { default: images } = await import("../../src/routes/images");
const { default: projects } = await import("../../src/routes/projects");
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const id = Number(req.headers["x-test-actor"] ?? 1);
  const role = id === 1 ? "admin" : id === 2 ? "editor" : "user";
  (req as any).session = { userId: id, userRole: role, destroy: (done: () => void) => done() };
  (req as any).log = { error: () => undefined, warn: () => undefined, info: () => undefined };
  next();
});
app.use("/api", admin, fullBackup, articles, images, projects);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
const passphrase = "isolated-backup-fixture-passphrase";
type Backup = { manifest: { sections: Record<string, { count: number; checksum: string }> }; data: Record<string, any[]> };

async function request(path: string, init: RequestInit = {}, actor = 1) {
  const headers = new Headers(init.headers);
  headers.set("x-test-actor", String(actor));
  return fetch(base + path, { ...init, headers });
}
async function json(path: string, init: RequestInit = {}, actor = 1, status = 200): Promise<any> {
  const response = await request(path, init, actor);
  const value = await response.json();
  assert.equal(response.status, status, `${path}: ${value.error ?? "unexpected response"}`);
  return value;
}
const postJson = (value: unknown): RequestInit => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
});
function decode(bytes: Buffer): Backup {
  assert.equal(bytes.subarray(0, 8).toString(), "MEMEXENV");
  const key = scryptSync(passphrase, bytes.subarray(9, 25), 32);
  const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(25, 37));
  cipher.setAuthTag(bytes.subarray(37, 53));
  return JSON.parse(gunzipSync(Buffer.concat([cipher.update(bytes.subarray(53)), cipher.final()])).toString());
}
function encode(backup: Backup, refreshChecksums = true): Buffer {
  if (refreshChecksums) for (const [name, rows] of Object.entries(backup.data)) {
    backup.manifest.sections[name] = { count: rows.length, checksum: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
  }
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  const ciphertext = Buffer.concat([cipher.update(gzipSync(JSON.stringify(backup))), cipher.final()]);
  return Buffer.concat([Buffer.from("MEMEXENV"), Buffer.from([1]), salt, iv, cipher.getAuthTag(), ciphertext]);
}
async function exportFull() {
  const response = await request("/admin/full-backup/export", postJson({ passphrase }));
  assert.equal(response.status, 200);
  return Buffer.from(await response.arrayBuffer());
}
function form(bytes: Buffer, filename = "backup.mex", password = passphrase) {
  const body = new FormData();
  body.append("file", new Blob([new Uint8Array(bytes)]), filename);
  body.append("passphrase", password);
  body.append("mode", "replace");
  body.append("confirmation", "RESTORE");
  return { method: "POST", body };
}
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function equalSections(actual: Backup, expected: Backup) {
  for (const [name, rows] of Object.entries(expected.data)) {
    const normalize = (input: any[]) => input.map((r) => JSON.stringify(canonical(r))).sort();
    assert.deepEqual(normalize(actual.data[name]), normalize(rows), `Section ${name} changed during full restore`);
  }
}
try {
  await seedBackupFixtures();
  const fullBytes = await exportFull();
  const original = decode(fullBytes);
  assert.ok(original.data.users.every((u) => !("passwordHash" in u)));
  assert.equal(original.data.ssoConfigs[0].enabled, false);
  assert.ok(!("clientSecret" in original.data.ssoConfigs[0].config));
  assert.ok(!("user_sessions" in original.data));
  const preview = await json("/admin/full-backup/preview", form(fullBytes));
  assert.equal(preview.sections.policySubjects.count, 3);
  assert.equal(preview.sections.procedureRuns.count, 2);
  assert.equal(preview.destinationHasData, true);

  // Content ZIP restores into emptied content tables, leaving identity tables.
  const zipResponse = await request("/admin/export");
  assert.equal(zipResponse.status, 200);
  const zipBytes = Buffer.from(await zipResponse.arrayBuffer());
  const unzipper = await import("unzipper");
  const directory = await unzipper.Open.buffer(zipBytes);
  assert.ok(directory.files.some((f) => f.path === "images/51-step.png"), "Step-only image missing from ZIP");
  assert.ok(directory.files.some((f) => f.path === "images/52-intro.png"));
  const stepMeta = JSON.parse((await directory.files.find((f) => f.path === "articles/procedure.json")!.buffer()).toString());
  assert.match(stepMeta.procedureSteps[0].description, /\.\.\/images\/51-step\.png/);
  await records.db.delete(records.articlesTable);
  await records.db.delete(records.articleImagesTable);
  await records.db.execute(sql`DELETE FROM policy_subjects`);
  const zipForm = form(zipBytes, "content.zip");
  const imported = await json("/admin/import", zipForm);
  assert.deepEqual(imported.errors, []);
  assert.equal(imported.imported, original.data.articles.length);
  const policy = await json("/articles/rule", {}, 3);
  assert.equal(policy.kind, "policy");
  assert.equal(policy.visibility, "group");
  assert.equal(policy.ownerId, 2);
  const subjects = await records.db.select().from(records.policySubjectsTable);
  const child = subjects.find((s) => s.id === policy.policySubjectId)!;
  assert.equal(child.name, "Safety");
  assert.equal(subjects.find((s) => s.id === child.parentId)!.name, "Operations");
  const procedure = await json("/articles/procedure", {}, 2);
  assert.equal(procedure.kind, "procedure");
  assert.equal(procedure.content, "<p>Introduction only.</p>");
  assert.deepEqual(procedure.procedureSteps.map((s: any) => s.title), ["Review policy", "Finish independently"]);
  assert.match(procedure.procedureSteps[0].description, /\[\[rule\|Policy\]\]/);
  const imageId = Number(procedure.procedureSteps[0].description.match(/\/api\/articles\/images\/(\d+)/)[1]);
  assert.notEqual(imageId, 51, "Image references must use the imported IDs");
  const image = await request(`/articles/images/${imageId}`, {}, 2);
  assert.equal(image.status, 200);
  assert.equal(await image.text(), "step-image-bytes");
  const denied = await request(`/articles/images/${imageId}`, {}, 4);
  assert.ok([403, 404].includes(denied.status), "Step image must inherit private article access");
  await json("/articles/procedure", {}, 4, 404);
  assert.equal((await json("/articles/procedure/backlinks", {}, 2)).some((a: any) => a.slug === "knowledge"), true);
  assert.equal((await json("/articles/rule/backlinks", {}, 2)).some((a: any) => a.slug === "procedure"), true);
  assert.equal(policy.tags[0].name, "Fixture tag");
  // Overwrite must replace ownership, kind, permissions, steps and empty tags.
  await records.db.update(records.articlesTable).set({
    kind: "knowledge", procedureSteps: [], visibility: "public", createdById: 4,
  }).where(eq(records.articlesTable.id, procedure.id));
  await records.db.insert(records.articleGroupsTable).values({ articleId: procedure.id, groupId: 7 });
  const knowledge = await json("/articles/knowledge", {}, 2);
  await records.db.insert(records.articleTagsTable).values({ articleId: knowledge.id, tagId: 5 });
  const overwriteZip = form(zipBytes, "content.zip");
  overwriteZip.body.set("overwrite", "true");
  const overwritten = await json("/admin/import", overwriteZip);
  assert.deepEqual(overwritten.errors, []);
  const restoredProcedure = await json("/articles/procedure", {}, 2);
  assert.equal(restoredProcedure.id, procedure.id);
  assert.equal(restoredProcedure.kind, "procedure");
  assert.equal(restoredProcedure.ownerId, 2);
  assert.equal(restoredProcedure.visibility, "personal");
  assert.deepEqual(restoredProcedure.groups, []);
  assert.equal((await json("/articles/knowledge", {}, 2)).tags.length, 0);
  assert.ok((await records.db.select().from(records.articlesTable)).find((a) => a.slug === "rule")!.isStatic);
  console.info("ZIP round-trip and overwrite: kinds, categories, ownership/access, steps, links/tags, intro and step-only images");

  // Real transaction failure after TRUNCATE must restore the original target.
  const beforeFailure = decode(await exportFull());
  const badForeignKey = structuredClone(original);
  badForeignKey.data.boardCards[0].columnId = 999_999;
  const failedRestore = await json("/admin/full-backup/restore", form(encode(badForeignKey)), 1, 400);
  assert.match(failedRestore.error, /board_cards/, "Exercise a late insertion failure, not just preflight validation");
  equalSections(decode(await exportFull()), beforeFailure);
  assert.equal((await records.db.execute(sql`SELECT COUNT(*)::int AS count FROM user_sessions`)).rows[0].count, 1);

  // Checksum, encryption, metadata and confirmation failures cannot write data.
  const checksumMismatch = structuredClone(original);
  checksumMismatch.data.articles[0].title = "Tampered";
  await json("/admin/full-backup/restore", form(encode(checksumMismatch, false)), 1, 400);
  const cyclic = structuredClone(original);
  cyclic.data.policySubjects[0].parentId = 8;
  await json("/admin/full-backup/restore", form(encode(cyclic)), 1, 400);
  const emptySteps = structuredClone(original);
  emptySteps.data.articles.find((a) => a.kind === "procedure")!.procedureSteps = [];
  await json("/admin/full-backup/restore", form(encode(emptySteps)), 1, 400);
  await json("/admin/full-backup/restore", form(fullBytes, "backup.mex", "incorrect-fixture-passphrase"), 1, 400);
  const noConfirmation = form(fullBytes);
  noConfirmation.body.set("confirmation", "");
  await json("/admin/full-backup/restore", noConfirmation, 1, 400);
  const noReplacement = form(fullBytes);
  noReplacement.body.set("mode", "empty");
  await json("/admin/full-backup/restore", noReplacement, 1, 409);
  equalSections(decode(await exportFull()), beforeFailure);

  const restored = await json("/admin/full-backup/restore", form(fullBytes));
  assert.equal(restored.restored.policySubjects, 3);
  assert.equal(restored.restored.procedureRuns, 2);
  assert.equal(restored.recoveryLinks.length, 4);
  equalSections(decode(await exportFull()), original);
  assert.equal((await records.db.execute(sql`SELECT COUNT(*)::int AS count FROM user_sessions`)).rows[0].count, 0);
  assert.ok((await records.db.select().from(records.usersTable)).every((u) => u.mustResetPassword));
  await json("/projects/5", {}, 4, 403);
  await json("/projects/6", {}, 3);
  const runs = await records.db.select().from(records.procedureRunsTable);
  assert.ok(runs.some((r) => r.sourceSlug === "deleted-procedure" && r.projectId === 5));
  const cards = await records.db.select().from(records.boardCardsTable);
  assert.equal(cards.find((c) => c.id === 42)!.completedAt!.toISOString(), "2026-01-02T03:04:05.000Z");
  assert.equal(cards.find((c) => c.id === 41)!.description, "Copied original description");
  const [newCategory] = await records.db.insert(records.policySubjectsTable).values({ name: "After restore" }).returning();
  assert.ok(newCategory.id > 9, "Category sequence must advance past restored IDs");
  console.info("Full round-trip: every section, history/templates/settings, private/shared snapshots, absent source, card completion, recovery and sequences");

  const legacy = structuredClone(original);
  for (const name of ["policySubjects", "procedureRuns"]) {
    delete legacy.data[name];
    delete legacy.manifest.sections[name];
  }
  for (const row of [...legacy.data.articles, ...legacy.data.articleVersions, ...legacy.data.templates]) {
    delete row.kind; delete row.policySubjectId; delete row.procedureSteps;
  }
  legacy.data.siteSettings = legacy.data.siteSettings.filter((s) => !["policy_template_id", "procedure_template_id", "policies_enabled", "procedures_enabled"].includes(s.key));
  await json("/admin/full-backup/restore", form(encode(legacy)));
  assert.ok((await records.db.select().from(records.articlesTable)).every((a) => a.kind === "knowledge" && a.procedureSteps.length === 0));
  assert.ok((await records.db.select().from(records.templatesTable)).every((t) => t.kind === "knowledge"));
  assert.equal((await records.db.select().from(records.policySubjectsTable)).length, 0);

  const sparse = structuredClone(original);
  for (const name of Object.keys(sparse.data)) sparse.data[name] = [];
  sparse.data.users = [original.data.users[0]];
  await json("/admin/full-backup/restore", form(encode(sparse)));
  assert.equal((await records.db.select().from(records.articlesTable)).length, 0);
  assert.equal((await records.db.select().from(records.procedureRunsTable)).length, 0);
  const [firstCategory] = await records.db.insert(records.policySubjectsTable).values({ name: "First category" }).returning();
  assert.equal(firstCategory.id, 1);
  const entirelyEmpty = structuredClone(sparse);
  entirelyEmpty.data.users = [];
  await json("/admin/full-backup/restore", form(encode(entirelyEmpty)));
  assert.equal((await records.db.select().from(records.usersTable)).length, 0);
  console.info("Compatibility and safety: old archives, empty sections/entire environment, confirmation, checksum/passphrase rejection and transactional rollback");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await records.pool.end();
}