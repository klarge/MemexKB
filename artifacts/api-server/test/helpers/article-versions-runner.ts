import assert from "node:assert/strict";
import express from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, pool, usersTable, articlesTable, articleVersionsTable, policySubjectsTable, projectsTable } from "@workspace/db";

// Only synthetic fixtures, with no public-schema fallback.
assert.match(process.env.BACKUP_TEST_SCHEMA ?? "", /^backup_test_[a-f0-9]{32}$/);
assert.equal((await db.execute(sql`SELECT current_schema() AS schema`)).rows[0].schema, process.env.BACKUP_TEST_SCHEMA);
const people = await db.insert(usersTable).values([
  { name: "Editor A", email: "checkpoint-a@example.test", role: "admin", passwordHash: "unused" },
  { name: "Editor B", email: "checkpoint-b@example.test", role: "admin", passwordHash: "unused" },
  { name: "Reader", email: "checkpoint-reader@example.test", role: "user", passwordHash: "unused" },
]).returning();
const [editor, other, reader] = people;
const { default: articles } = await import("../../src/routes/articles");
const { default: projects } = await import("../../src/routes/projects");
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const person = people.find(p => p.id === Number(req.headers["x-test-actor"]));
  (req as any).session = person ? { userId: person.id, userRole: person.role, userName: person.name } : {};
  (req as any).log = { error() {}, warn() {} };
  next();
});
app.use("/api", articles, projects);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
async function api(method: string, path: string, data?: unknown, actor = editor.id, expected = 200) {
  const response = await fetch(base + path, {
    method, headers: { "Content-Type": "application/json", "x-test-actor": String(actor) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body)}`);
  return body;
}
const history = (id: number) => db.select().from(articleVersionsTable)
  .where(eq(articleVersionsTable.articleId, id)).orderBy(desc(articleVersionsTable.versionNumber));

try {
  const article = await api("POST", "/articles", { title: "Checkpoint article", content: "<p>Original</p>", visibility: "public" }, editor.id, 201);
  const path = `/articles/${article.slug}`;
  const original = (await history(article.id))[0];
  assert.equal(original.autosaveStartedAt, null);
  const autosave = (content: string, actor = editor.id) => api("PATCH", path, { content, saveMode: "autosave" }, actor);

  await autosave("<p>Draft one</p>");
  const first = (await history(article.id))[0];
  await autosave("<p>Draft two</p>");
  let versions = await history(article.id);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].id, first.id);
  assert.equal(versions[0].content, "<p>Draft two</p>");
  assert.equal(versions[0].autosaveStartedAt!.getTime(), first.autosaveStartedAt!.getTime());
  assert.equal(versions[1].content, original.content);
  assert.equal((await api("GET", path)).content, versions[0].content);
  await autosave("<p>Draft two</p>");
  assert.equal((await history(article.id)).length, 2);

  // Make the absolute window expire without waiting five minutes.
  await db.update(articleVersionsTable).set({ autosaveStartedAt: new Date(Date.now() - 301_000) }).where(eq(articleVersionsTable.id, first.id));
  await autosave("<p>After five minutes</p>");
  assert.equal((await history(article.id)).length, 3);
  await api("PATCH", path, { content: "<p>After five minutes</p>" }); // unchanged explicit save seals
  assert.equal((await history(article.id))[0].autosaveStartedAt, null);
  await autosave("<p>Next draft</p>");
  assert.equal((await history(article.id)).length, 4);
  await api("PATCH", path, { content: "<p>Explicit changed save</p>", saveMode: "manual" });
  assert.equal((await history(article.id)).length, 5);
  await api("PATCH", path, { content: "<p>Explicit changed save</p>" });
  assert.equal((await history(article.id)).length, 5);
  await autosave("<p>Different editor</p>", other.id);
  await autosave("<p>Different editor</p>", editor.id); // identity boundary even if same text
  assert.equal((await history(article.id)).length, 7);
  await api("PATCH", path, { content: "<p>Invalid</p>", saveMode: "unexpected" }, editor.id, 400);
  await api("PATCH", path, { content: "<p>Not allowed</p>", saveMode: "autosave" }, reader.id, 403);
  await api("GET", `${path}/versions`, undefined, reader.id);
  await api("POST", `${path}/versions/${original.id}/restore`, {});
  versions = await history(article.id);
  assert.equal(versions.length, 8);
  assert.equal(versions[0].content, original.content);
  assert.equal(versions[0].autosaveStartedAt, null);
  await autosave("<p>After restore</p>");
  assert.equal((await history(article.id)).length, 9);
  // Concurrent saves must commit a matching article and one latest checkpoint.
  await Promise.all(Array.from({ length: 8 }, (_, i) => autosave(`<p>Concurrent ${i}</p>`)));
  versions = await history(article.id);
  assert.equal(versions.length, 9);
  assert.equal(new Set(versions.map(v => v.versionNumber)).size, versions.length);
  assert.equal((await api("GET", path)).content, versions[0].content);
  assert.equal((await api("GET", `${path}/versions/${original.id}`)).content, "<p>Original</p>");
  // Simulate a storage failure: neither the article nor its recovery copy may commit.
  await db.execute(sql`CREATE FUNCTION checkpoint_reject_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.content = '<p>Reject checkpoint write</p>' THEN
        RAISE EXCEPTION 'synthetic checkpoint failure';
      END IF;
      RETURN NEW;
    END $$`);
  await db.execute(sql`CREATE TRIGGER checkpoint_reject_test BEFORE INSERT OR UPDATE ON article_versions
    FOR EACH ROW EXECUTE FUNCTION checkpoint_reject_test()`);
  const rejected = await fetch(base + path, {
    method: "PATCH", headers: { "Content-Type": "application/json", "x-test-actor": String(editor.id) },
    body: JSON.stringify({ content: "<p>Reject checkpoint write</p>", saveMode: "autosave" }),
  });
  assert.equal(rejected.status, 500);
  assert.equal((await api("GET", path)).content, versions[0].content);
  assert.deepEqual(await history(article.id), versions);
  await db.execute(sql`DROP TRIGGER checkpoint_reject_test ON article_versions`);
  await db.execute(sql`DROP FUNCTION checkpoint_reject_test()`);
  // Metadata-only requests follow the same duplicate suppression path.
  await api("PATCH", path, { isStatic: true });
  assert.equal((await history(article.id)).length, 9);
  assert.equal((await history(article.id))[0].autosaveStartedAt, null);
  await api("PATCH", path, { title: "Title-only checkpoint" });
  assert.equal((await history(article.id)).length, 10);
  assert.equal((await history(article.id))[0].title, "Title-only checkpoint");

  const [subject] = await db.insert(policySubjectsTable).values({ name: "Checkpoint policies" }).returning();
  const policy = await api("POST", "/articles", { title: "Checkpoint policy", kind: "policy", policySubjectId: subject.id, content: "<p>Policy</p>" }, editor.id, 201);
  await api("PATCH", `/articles/${policy.slug}`, { content: "<p>Policy one</p>", saveMode: "autosave" });
  await api("PATCH", `/articles/${policy.slug}`, { content: "<p>Policy two</p>", saveMode: "autosave" });
  assert.equal((await history(policy.id)).length, 2);
  assert.equal((await history(policy.id))[0].policySubjectId, subject.id);
  const steps = [{ title: "First", description: "<p>Step one</p>" }, { title: "Second", description: "<p>Step two</p>" }];
  const procedure = await api("POST", "/articles", { title: "Checkpoint procedure", kind: "procedure", procedureSteps: steps }, editor.id, 201);
  const procedurePath = `/articles/${procedure.slug}`;
  await api("PATCH", procedurePath, { procedureSteps: [...steps].reverse(), saveMode: "autosave" });
  await api("PATCH", procedurePath, { procedureSteps: [{ ...steps[1], description: "<p>Updated</p>" }, steps[0]], saveMode: "autosave" });
  const procedureVersions = await history(procedure.id);
  assert.equal(procedureVersions.length, 2);
  assert.equal(procedureVersions[0].procedureSteps[0].description, "<p>Updated</p>");
  assert.deepEqual(procedureVersions[1].procedureSteps, steps);
  await api("POST", `${procedurePath}/versions/${procedureVersions[1].id}/restore`, {});
  assert.deepEqual((await api("GET", procedurePath)).procedureSteps, steps);

  // Existing versions default to fixed, including legacy inserts.
  const [legacy] = await db.insert(articlesTable).values({ title: "Legacy", slug: "checkpoint-legacy", createdById: editor.id }).returning();
  await db.insert(articleVersionsTable).values({ articleId: legacy.id, versionNumber: 1, title: legacy.title, content: "", createdById: editor.id });
  await api("PATCH", `/articles/${legacy.slug}`, { content: "<p>New legacy content</p>", saveMode: "autosave" });
  assert.equal((await history(legacy.id)).length, 2);
  assert.equal((await history(legacy.id))[1].content, "");

  // Dedicated project-document saves seal checkpoints as well.
  const [project] = await db.insert(projectsTable).values({ name: "Checkpoint project", createdById: editor.id, managerId: editor.id }).returning();
  const document = await api("POST", `/projects/${project.id}/documents`, { title: "Project document", content: "<p>Original document</p>" }, editor.id, 201);
  await api("PATCH", `/articles/${document.slug}`, { content: "<p>Document draft</p>", saveMode: "autosave" });
  await api("PATCH", `/projects/${project.id}/documents/${document.slug}`, { content: "<p>Document draft</p>" });
  assert.equal((await history(document.id)).length, 2);
  assert.equal((await history(document.id))[0].autosaveStartedAt, null);
  console.log("PASS: autosave checkpoints, duplicate suppression, fixed boundaries, editor isolation, restores, concurrent saves, policies, procedures, legacy history and project documents");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}
