import assert from "node:assert/strict";
import express from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, pool, usersTable, articlesTable, projectsTable, groupsTable, groupMembersTable, projectGroupsTable, articleGroupsTable, favoritesTable, siteSettingsTable, policySubjectsTable } from "@workspace/db";
import { decodeBackup, encodeBackup } from "./sso-only-backup-codec";

assert.match(process.env.BACKUP_TEST_SCHEMA ?? "", /^backup_test_[a-f0-9]{32}$/);
const actual = await db.execute(sql`SELECT current_schema() AS schema`);
assert.equal(actual.rows[0].schema, process.env.BACKUP_TEST_SCHEMA);
const people = await db.insert(usersTable).values([
  { name: "Owner", email: "favorite-owner@example.test", role: "editor", passwordHash: "unused" },
  { name: "Member", email: "favorite-member@example.test", role: "user", passwordHash: "unused" },
  { name: "Stranger", email: "favorite-stranger@example.test", role: "user", passwordHash: "unused" },
  { name: "Admin", email: "favorite-admin@example.test", role: "admin", passwordHash: "unused" },
]).returning();
const [owner, member, stranger, admin] = people;
const [group] = await db.insert(groupsTable).values({ name: "Favorite group" }).returning();
const [subject] = await db.insert(policySubjectsTable).values({ name: "Favorite policies" }).returning();
await db.insert(groupMembersTable).values({ userId: member.id, groupId: group.id });
const [project] = await db.insert(projectsTable).values({ name: "Shared project", createdById: owner.id, managerId: owner.id }).returning();
await db.insert(projectGroupsTable).values({ projectId: project.id, groupId: group.id });
const [knowledge, policy, procedure, personal, log, document] = await db.insert(articlesTable).values([
  { title: "Knowledge", slug: "favorite-knowledge", kind: "knowledge", visibility: "public", createdById: owner.id },
  { title: "Policy", slug: "favorite-policy", kind: "policy", policySubjectId: subject.id, visibility: "public", createdById: owner.id },
  { title: "Procedure", slug: "favorite-procedure", kind: "procedure", procedureSteps: [{ title: "First step", description: "<p>Complete this step.</p>" }], visibility: "group", createdById: owner.id },
  { title: "Private", slug: "favorite-private", visibility: "personal", createdById: owner.id },
  { title: "Log", slug: "favorite-log", logSlug: "favorite-log", isLogEntry: true, createdById: owner.id },
  { title: "Document", slug: "favorite-document", projectId: project.id, createdById: owner.id },
]).returning();
await db.insert(articleGroupsTable).values({ articleId: procedure.id, groupId: group.id });
const { default: favorites } = await import("../../src/routes/favorites");
const { default: backups } = await import("../../src/routes/admin-full-backup");
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const person = people.find(person => person.id === Number(req.headers["x-test-actor"]));
  (req as any).session = person ? { userId: person.id, userRole: person.role, destroy: (done: () => void) => done() } : {};
  (req as any).log = { error: () => {}, warn: () => {} };
  next();
});
app.use("/api", favorites, backups);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
async function request(path: string, actor: number, body?: unknown, method = body === undefined ? "GET" : "PUT", status = 200) {
  const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", "x-test-actor": String(actor) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  assert.equal(response.status, status, `${path}: ${text}`);
  return data;
}
const star = (actor: number, type: string, id: number, favorite = true, status = 204) =>
  request("/favorites", actor, { entityType: type, entityId: id, favorite, userId: admin.id }, "PUT", status);
try {
  await request("/favorites", 0, undefined, "GET", 401);
  for (const article of [knowledge, policy, procedure, personal]) await star(owner.id, "article", article.id);
  await star(owner.id, "project", project.id);
  for (const article of [knowledge, policy, procedure]) await star(member.id, "article", article.id);
  await star(member.id, "project", project.id);
  await star(member.id, "article", knowledge.id);
  assert.equal((await request("/favorites", member.id)).items.length, 4);
  assert.equal((await request("/favorites", admin.id)).items.length, 0);
  for (const article of [personal, procedure, log, document]) await star(stranger.id, "article", article.id, true, 404);
  await star(stranger.id, "project", project.id, true, 404);
  await star(owner.id, "article", log.id, true, 404);
  await star(owner.id, "article", document.id, true, 404);
  for (const body of [{}, { entityType: "article", entityId: knowledge.id, favorite: "true" }, { entityType: "task", entityId: 1, favorite: true }, { entityType: "article", entityId: 9_000_000_000, favorite: true }]) {
    await request("/favorites", owner.id, body, "PUT", 400);
  }
  await star(owner.id, "article", knowledge.id, false);
  assert.ok((await request("/favorites", member.id)).items.some((item: any) => item.entityId === knowledge.id && item.entityType === "article"));
  await db.update(articlesTable).set({ title: "Renamed policy", slug: "new-policy-url" }).where(eq(articlesTable.id, policy.id));
  const renamed = (await request("/favorites", member.id)).items.find((item: any) => item.entityId === policy.id && item.entityType === "article");
  assert.equal(renamed.title, "Renamed policy");
  assert.equal(renamed.slug, "new-policy-url");
  await db.update(projectsTable).set({ archivedAt: new Date() }).where(eq(projectsTable.id, project.id));
  assert.equal((await request("/favorites", member.id)).items.find((item: any) => item.entityType === "project").archived, true);
  await db.delete(groupMembersTable).where(and(eq(groupMembersTable.userId, member.id), eq(groupMembersTable.groupId, group.id)));
  assert.equal((await request("/favorites", member.id)).items.length, 2);
  await star(member.id, "project", project.id, false);
  assert.ok((await request("/favorites", owner.id)).items.some((item: any) => item.entityType === "project"));
  await db.insert(siteSettingsTable).values({ key: "projects_enabled", value: "false" }).onConflictDoUpdate({ target: siteSettingsTable.key, set: { value: "false" } });
  assert.equal((await request("/favorites", owner.id)).items.some((item: any) => item.entityType === "project"), false);
  await star(owner.id, "project", project.id, true, 404);
  await db.update(siteSettingsTable).set({ value: "true" }).where(eq(siteSettingsTable.key, "projects_enabled"));
  const count = (await db.select().from(favoritesTable)).length;
  const passphrase = "isolated-favorites-backup";
  const exported = await fetch(base + "/admin/full-backup/export", { method: "POST", headers: { "Content-Type": "application/json", "x-test-actor": String(admin.id) }, body: JSON.stringify({ passphrase }) });
  assert.equal(exported.status, 200);
  const bytes = Buffer.from(await exported.arrayBuffer());
  const archive = decodeBackup(bytes, passphrase);
  assert.equal(archive.data.favorites.length, count);
  const restore = async (payload: Buffer) => {
    const form = new FormData();
    form.append("file", new Blob([payload]), "favorites.memex");
    form.append("passphrase", passphrase);
    form.append("mode", "replace");
    form.append("confirmation", "RESTORE");
    const response = await fetch(base + "/admin/full-backup/restore", { method: "POST", headers: { "x-test-actor": String(admin.id) }, body: form });
    assert.equal(response.status, 200, await response.text());
  };
  await db.delete(favoritesTable);
  await restore(bytes);
  assert.equal((await db.select().from(favoritesTable)).length, count);
  await db.delete(articlesTable).where(eq(articlesTable.id, policy.id));
  assert.equal((await db.select().from(favoritesTable).where(eq(favoritesTable.articleId, policy.id))).length, 0);
  delete archive.data.favorites;
  delete archive.manifest.sections.favorites;
  await restore(encodeBackup(archive, passphrase));
  assert.equal((await db.select().from(favoritesTable)).length, 0);
  console.log("All content types, user isolation, duplicate protection, access revocation, live title/URL changes, archive state, disabled projects, deletion cascades and new/legacy encrypted backups passed.");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}