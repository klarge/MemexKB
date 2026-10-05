import assert from "node:assert/strict";
import express from "express";
import { eq, sql } from "drizzle-orm";
import { db, pool, usersTable, projectsTable, groupsTable, groupMembersTable, articleImagesTable } from "@workspace/db";
import { decodeBackup, encodeBackup } from "./sso-only-backup-codec";

const schema = process.env.BACKUP_TEST_SCHEMA;
assert.match(schema ?? "", /^backup_test_[a-f0-9]{32}$/);
const actual = await db.execute(sql`SELECT current_schema() AS schema, current_setting('search_path') AS path`);
assert.equal(actual.rows[0].schema, schema);
assert.equal(actual.rows[0].path, schema);
const people = await db.insert(usersTable).values([
  { email: "admin@example.test", name: "Admin", role: "admin", passwordHash: "unused" },
  { email: "creator@example.test", name: "Creator", role: "editor", passwordHash: "unused" },
  { email: "manager@example.test", name: "First manager", role: "user", passwordHash: "unused" },
  { email: "replacement@example.test", name: "Replacement manager", role: "user", passwordHash: "unused" },
  { email: "viewer@example.test", name: "Viewer", role: "user", passwordHash: "unused" },
]).returning();
const [admin, creator, manager, replacement, viewer] = people;
const { default: projects } = await import("../../src/routes/projects");
const { default: articles } = await import("../../src/routes/articles");
const { default: images } = await import("../../src/routes/images");
const { default: dashboard } = await import("../../src/routes/dashboard");
const { default: backups } = await import("../../src/routes/admin");
const { default: fullBackup } = await import("../../src/routes/admin-full-backup");
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const person = people.find((p) => p.id === Number(req.headers["x-test-actor"]))!;
  (req as any).session = { userId: person.id, userRole: person.role, userName: person.name, destroy: (done: () => void) => done() };
  (req as any).log = { error: () => undefined, warn: () => undefined };
  next();
});
app.use("/api", projects, articles, images, dashboard, backups, fullBackup);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
async function request(path: string, actor = creator.id, body?: unknown, method = body === undefined ? "GET" : "POST") {
  return fetch(base + path, { method, headers: { "Content-Type": "application/json", "x-test-actor": String(actor) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function json(path: string, actor = creator.id, body?: unknown, method?: string, status = 200) {
  const response = await request(path, actor, body, method);
  const text = await response.text();
  const result = text ? JSON.parse(text) : {};
  assert.equal(response.status, status, `${path}: ${result.error ?? "unexpected response"}`);
  return result;
}
try {
  const project = await json("/projects", creator.id, { name: "Managed fixture" }, "POST", 201);
  assert.equal(project.managerId, creator.id);
  const path = `/projects/${project.id}`;
  await json(path, creator.id, { managerId: manager.id }, "PATCH");
  await json(path, creator.id, { managerId: 999999 }, "PATCH", 400);
  await json(path, creator.id, { managerId: null }, "PATCH", 400);
  await json(path, viewer.id, { managerId: viewer.id }, "PATCH", 403);
  assert.equal((await json(path, manager.id)).isOwner, true);
  assert.equal((await json(path, manager.id)).manager.name, manager.name);
  assert.ok((await json("/projects", manager.id)).projects.some((p: any) => p.id === project.id && p.managerName === manager.name));
  const candidates = await json(path + "/manager-candidates", manager.id);
  assert.ok(candidates.some((p: any) => p.id === replacement.id));
  assert.deepEqual(Object.keys(candidates[0]).sort(), ["id", "name"]);
  await json(path + "/manager-candidates", viewer.id, undefined, undefined, 403);
  await json(path, manager.id, { name: "Renamed by manager" }, "PATCH");
  const board = await json(path + "/boards", manager.id, { name: "Managed board" }, "POST", 201);
  for (const person of [manager, creator, admin]) {
    const created = await json(path + "/boards", person.id, { name: `${person.name} board` }, "POST", 201);
    const renamed = await json(`/boards/${created.id}`, person.id, { name: `  ${person.name} renamed board  ` }, "PATCH");
    assert.equal(renamed.name, `${person.name} renamed board`);
    assert.equal(renamed.id, created.id);
    assert.equal(renamed.projectId, created.projectId);
    assert.equal(renamed.position, created.position);
    assert.equal(renamed.archivedAt, created.archivedAt);
    assert.equal((await json(`/boards/${created.id}`, person.id)).name, renamed.name);
  }
  await json(path + "/boards", viewer.id, { name: "Denied board" }, "POST", 403);
  await json(`/boards/${board.id}`, viewer.id, { name: "Denied rename" }, "PATCH", 403);
  for (const name of ["", "   ", null, 42, {}]) {
    await json(`/boards/${board.id}`, manager.id, { name }, "PATCH", 400);
  }
  assert.equal((await json(`/boards/${board.id}`, manager.id)).name, board.name);
  const document = await json(path + "/documents", manager.id, { title: "Managed document", content: "<p>Private project content</p>" }, "POST", 201);
  assert.equal((await json(`/articles/${document.slug}`, manager.id)).canEdit, true);
  const [image] = await db.insert(articleImagesTable).values({
    articleId: document.id, uploadedById: manager.id, filename: "fixture.txt", mimeType: "text/plain", data: Buffer.from("private image").toString("base64"),
  }).returning();
  assert.equal((await request(`/articles/images/${image.id}`, manager.id)).status, 200);
  const [group] = await db.insert(groupsTable).values({ name: "Viewers" }).returning();
  await db.insert(groupMembersTable).values({ userId: viewer.id, groupId: group.id });
  await json(path + "/groups", manager.id, { groupId: group.id }, "POST", 201);
  assert.equal((await json(path, viewer.id)).isOwner, false);
  const memberBoard = await json(path + "/boards", viewer.id, { name: "Member board" }, "POST", 201);
  assert.equal((await json(`/boards/${memberBoard.id}`, viewer.id, { name: "Member renamed board" }, "PATCH")).name, "Member renamed board");
  await json(`/boards/${memberBoard.id}`, viewer.id, { archived: true }, "PATCH");
  assert.equal((await json(`/boards/${memberBoard.id}`, viewer.id, { name: "Renamed archived board" }, "PATCH")).name, "Renamed archived board");
  await json(path, viewer.id, undefined, "DELETE", 403);
  await json(path, manager.id, { managerId: replacement.id }, "PATCH");
  assert.equal((await json(path, replacement.id)).isOwner, true);
  await json(path, manager.id, undefined, undefined, 403);
  await json(path + "/boards", manager.id, { name: "Former manager board" }, "POST", 403);
  await json(`/boards/${board.id}`, manager.id, { name: "Former manager rename" }, "PATCH", 403);
  assert.equal((await request(`/articles/${document.slug}`, manager.id)).status, 404);
  assert.ok([403, 404].includes((await request(`/articles/images/${image.id}`, manager.id)).status));
  assert.equal((await json(path, creator.id)).isOwner, true);
  assert.equal((await json(path, admin.id)).isOwner, true);
  const [unrelated] = await db.insert(projectsTable).values({ name: "Other private project", createdById: admin.id, managerId: admin.id }).returning();
  await json(`/projects/${unrelated.id}`, replacement.id, undefined, undefined, 403);
  assert.equal((await db.select().from(usersTable).where(eq(usersTable.id, replacement.id)))[0].role, "user");
  assert.ok((await json(path + "/members", viewer.id)).some((p: any) => p.id === replacement.id));
  await json(`/boards/${board.id}`, replacement.id);

  const portable = await json("/admin/export/projects", admin.id);
  assert.equal(portable.projects.find((p: any) => p.id === project.id).managerRef.id, replacement.id);
  await json(path, replacement.id, undefined, "DELETE", 204);
  const portableForm = new FormData();
  portableForm.append("file", new Blob([JSON.stringify(portable)]), "projects.json");
  const previewForm = new FormData();
  previewForm.append("file", new Blob([JSON.stringify(portable)]), "projects.json");
  const previewResponse = await fetch(base + "/admin/restore/preview", { method: "POST", headers: { "x-test-actor": String(admin.id) }, body: previewForm });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  portableForm.append("ownerMappings", JSON.stringify(Object.fromEntries(preview.owners.map((owner: any) => [
    owner.key, owner.suggestedUserId,
  ]))));
  const restoredPortable = await fetch(base + "/admin/restore", { method: "POST", headers: { "x-test-actor": String(admin.id) }, body: portableForm });
  assert.equal(restoredPortable.status, 200, await restoredPortable.text());
  const [restoredProject] = await db.select().from(projectsTable).where(eq(projectsTable.name, "Renamed by manager"));
  assert.equal(restoredProject.managerId, replacement.id);
  assert.equal(restoredProject.createdById, creator.id);

  const passphrase = "isolated-manager-backup";
  const exported = await request("/admin/full-backup/export", admin.id, { passphrase });
  const bytes = Buffer.from(await exported.arrayBuffer());
  const archive = decodeBackup(bytes, passphrase);
  assert.equal(archive.data.projects.find((p: any) => p.id === restoredProject.id).managerId, replacement.id);
  async function restore(buffer: Buffer) {
    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from(buffer)]), "backup.mex");
    form.append("passphrase", passphrase); form.append("mode", "replace"); form.append("confirmation", "RESTORE");
    const response = await fetch(base + "/admin/full-backup/restore", { method: "POST", headers: { "x-test-actor": String(admin.id) }, body: form });
    assert.equal(response.status, 200);
  }
  await restore(bytes);
  assert.equal((await db.select().from(projectsTable).where(eq(projectsTable.id, restoredProject.id)))[0].managerId, replacement.id);
  for (const row of archive.data.projects) delete row.managerId;
  await restore(encodeBackup(archive, passphrase));
  assert.equal((await db.select().from(projectsTable).where(eq(projectsTable.id, restoredProject.id)))[0].managerId, creator.id);
  console.log("Manager default/reassignment, scoped management, sharing, documents/images, revocation, membership, unchanged global role and portable/full/legacy backups passed.");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}