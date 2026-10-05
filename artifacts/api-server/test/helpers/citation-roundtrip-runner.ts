import assert from "node:assert/strict";
import express from "express";
import { eq, sql } from "drizzle-orm";
import { db, pool, usersTable, articlesTable, articleVersionsTable } from "@workspace/db";
import { decodeBackup } from "./sso-only-backup-codec";
import { sanitizeArticleHtml } from "../../src/lib/sanitize";

assert.match(process.env.BACKUP_TEST_SCHEMA ?? "", /^backup_test_[a-f0-9]{32}$/);
const actual = await db.execute(sql`SELECT current_schema() AS schema, current_setting('search_path') AS path`);
assert.equal(actual.rows[0].schema, process.env.BACKUP_TEST_SCHEMA);
assert.equal(actual.rows[0].path, process.env.BACKUP_TEST_SCHEMA);
const [admin] = await db.insert(usersTable).values({
  name: "Citation fixture", email: "citations@example.test", passwordHash: "unused", role: "admin",
}).returning();
const { default: articles } = await import("../../src/routes/articles");
const { default: projects } = await import("../../src/routes/projects");
const { default: backups } = await import("../../src/routes/admin");
const { default: full } = await import("../../src/routes/admin-full-backup");
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).session = { userId: admin.id, userRole: "admin", userName: admin.name, destroy: (cb: () => void) => cb() };
  (req as any).log = { error: () => {}, warn: () => {} };
  next();
});
app.use("/api", articles, projects, backups, full);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
async function json(path: string, body: unknown) {
  const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}
const html = sanitizeArticleHtml('<p>A cited word<sup data-type="citation" data-citation-id="c-fixture" data-citation-description="Literal &lt;b&gt;text&lt;/b&gt; [[not-a-link]]" data-citation-url="https://example.test/?a=1&amp;b=2" data-citation-number="1"><a id="cite-ref-c-fixture" href="#cite-source-1">[1]</a></sup></p><div data-type="citation-sources"><h2>Sources</h2><ol><li id="cite-source-1">Literal &lt;b&gt;text&lt;/b&gt; [[not-a-link]] — <a href="https://example.test/?a=1&amp;b=2">https://example.test/?a=1&amp;b=2</a> <a href="#cite-ref-c-fixture">↩</a></li></ol></div>');
try {
  const body = { content: html, visibility: "personal", groupIds: [], tagIds: [], isStatic: false };
  const article = await json("/articles", { ...body, title: "Citation article" });
  const log = await json("/articles", { ...body, isStatic: undefined, title: "Citation log", isLogEntry: true });
  const project = await json("/projects", { name: "Citation project" });
  const document = await json(`/projects/${project.id}/documents`, { title: "Citation document", content: html });
  for (const record of [article, log, document]) {
    const [saved] = await db.select().from(articlesTable).where(eq(articlesTable.id, record.id));
    assert.equal(saved.content, html);
    const versions = await db.select().from(articleVersionsTable).where(eq(articleVersionsTable.articleId, record.id));
    assert.ok(versions.some(v => v.content === html));
    const path = record.id === log.id ? `/logs/${admin.id}/${saved.logSlug}` : `/articles/${saved.slug}`;
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).content, html);
  }
  const exportResponse = await fetch(base + "/admin/export");
  assert.equal(exportResponse.status, 200);
  const zip = Buffer.from(await exportResponse.arrayBuffer());
  const unzipper = await import("unzipper");
  const archive = await unzipper.Open.buffer(zip);
  assert.equal((await archive.files.find(f => f.path === `articles/${article.slug}.html`)!.buffer()).toString(), html);
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(zip)]), "citations.zip");
  form.append("overwrite", "true");
  const imported = await fetch(base + "/admin/import", { method: "POST", body: form });
  assert.equal(imported.status, 200);
  assert.deepEqual((await imported.json()).errors, []);
  const [afterZip] = await db.select().from(articlesTable).where(eq(articlesTable.id, article.id));
  assert.equal(afterZip.content, html);
  const passphrase = "isolated-citation-backup";
  const exported = await fetch(base + "/admin/full-backup/export", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passphrase }) });
  assert.equal(exported.status, 200);
  const bytes = Buffer.from(await exported.arrayBuffer());
  const decoded = decodeBackup(bytes, passphrase);
  assert.ok(decoded.data.articles.some((row: any) => row.content === html));
  const restore = new FormData();
  restore.append("file", new Blob([Uint8Array.from(bytes)]), "citations.mex");
  restore.append("passphrase", passphrase); restore.append("mode", "replace"); restore.append("confirmation", "RESTORE");
  const restored = await fetch(base + "/admin/full-backup/restore", { method: "POST", body: restore });
  assert.equal(restored.status, 200, await restored.text());
  assert.equal((await db.select().from(articlesTable).where(eq(articlesTable.id, article.id)))[0].content, html);
  console.log("Citation save/read/history in all three contexts, ZIP import and isolated full-backup restore passed.");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
}