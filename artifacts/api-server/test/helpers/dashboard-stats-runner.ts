import assert from "node:assert/strict";
import express from "express";
import { sql } from "drizzle-orm";
import { db, pool, usersTable, groupsTable, articlesTable, articleGroupsTable } from "@workspace/db";
import articles from "../../src/routes/articles";
import users from "../../src/routes/users";
import groups from "../../src/routes/groups";

assert.match(process.env.BACKUP_TEST_SCHEMA ?? "", /^backup_test_[a-f0-9]{32}$/);
const actual = await db.execute(sql`SELECT current_schema() AS schema`);
assert.equal(actual.rows[0].schema, process.env.BACKUP_TEST_SCHEMA);
const [admin, author, reader, inactive] = await db.insert(usersTable).values([
  { name: "Admin", email: "stats-admin@example.test", role: "admin", passwordHash: "unused" },
  { name: "Author", email: "stats-author@example.test", role: "editor", passwordHash: "unused" },
  { name: "Reader", email: "stats-reader@example.test", role: "user", passwordHash: "unused" },
  { name: "No articles", email: "stats-unused@example.test", role: "user", passwordHash: "unused" },
]).returning();
const [shared] = await db.insert(groupsTable).values([
  { name: "Article group" }, { name: "Empty group" }, { name: "Another unused group" },
]).returning();
const [, restricted] = await db.insert(articlesTable).values([
  { title: "Public article", slug: "stats-public", visibility: "public", createdById: author.id },
  { title: "Group article", slug: "stats-group", visibility: "group", createdById: author.id },
  { title: "Private article", slug: "stats-private", visibility: "personal", createdById: inactive.id },
]).returning();
await db.insert(articleGroupsTable).values({ articleId: restricted.id, groupId: shared.id });

const people = [admin, author, reader, inactive];
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const person = people.find(person => person.id === Number(req.headers["x-test-actor"]));
  (req as any).session = person ? { userId: person.id, userRole: person.role } : {};
  (req as any).log = { error: () => {}, warn: () => {} };
  next();
});
app.use("/api", articles, users, groups);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
async function request(path: string, actor: number, method = "GET", body?: unknown, expected = 200) {
  const response = await fetch(base + path, {
    method, headers: { "Content-Type": "application/json", "x-test-actor": String(actor) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
try {
  await request("/articles/stats", 0, "GET", undefined, 401);
  let totals = await request("/articles/stats", admin.id);
  assert.equal(totals.totalUsers, 4);
  assert.equal(totals.totalGroups, 3);
  assert.equal(totals.totalArticles, 3);
  assert.equal(totals.restrictedArticles, 1);
  const readerTotals = await request("/articles/stats", reader.id);
  assert.equal(readerTotals.totalUsers, 1, "Non-admins must not receive global account totals");
  assert.equal(readerTotals.totalGroups, 0, "Non-admins must not receive global group totals");
  assert.equal(readerTotals.totalArticles, 1);
  assert.equal(readerTotals.recentlyUpdated.length, 1);
  const createdUser = await request("/users", admin.id, "POST", {
    name: "New account without articles", email: "stats-new@example.test", password: "fixture-password", role: "user",
  }, 201);
  const createdGroup = await request("/groups", admin.id, "POST", { name: "New group without articles" }, 201);
  totals = await request("/articles/stats", admin.id);
  assert.equal(totals.totalUsers, 5);
  assert.equal(totals.totalGroups, 4);
  await request(`/users/${createdUser.id}`, admin.id, "DELETE");
  await request(`/groups/${createdGroup.id}`, admin.id, "DELETE");
  totals = await request("/articles/stats", admin.id);
  assert.equal(totals.totalUsers, 4);
  assert.equal(totals.totalGroups, 3);
  // Even an empty knowledge base must still report every account and group.
  await db.delete(articlesTable);
  totals = await request("/articles/stats", admin.id);
  assert.equal(totals.totalUsers, 4);
  assert.equal(totals.totalGroups, 3);
  assert.equal(totals.totalArticles, 0);
  console.log("Dashboard totals checks passed: unused accounts/groups, create/delete, empty articles and non-admin privacy.");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}
