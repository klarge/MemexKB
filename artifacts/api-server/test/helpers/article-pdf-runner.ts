import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db, pool, usersTable, articlesTable, articleImagesTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import articles from "../../src/routes/articles";

assert.match(process.env.BACKUP_TEST_SCHEMA ?? "", /^backup_test_[a-f0-9]{32}$/);
const actual = await db.execute(sql`SELECT current_schema() AS schema`);
assert.equal(actual.rows[0].schema, process.env.BACKUP_TEST_SCHEMA);
const [owner, stranger] = await db.insert(usersTable).values([
  { email: "owner@example.test", name: "Owner", role: "editor", passwordHash: "unused" },
  { email: "stranger@example.test", name: "Stranger", role: "user", passwordHash: "unused" },
]).returning();
const [article] = await db.insert(articlesTable).values({
  slug: "pdf-layout-regression", title: "HTML article export — formatting check",
  content: "", visibility: "personal", createdById: owner.id,
  procedureSteps: [{ title: "Preserve the procedure", description: "<p>Steps retain <strong>formatted text</strong> and lists.</p><ul><li>Step item</li></ul>" }],
}).returning();
const [foreignArticle] = await db.insert(articlesTable).values({
  slug: "unrelated-private", title: "Unrelated", content: "", visibility: "personal", createdById: stranger.id,
}).returning();
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDHsAAAAASUVORK5CYII=";
const [image, foreignImage] = await db.insert(articleImagesTable).values([
  { articleId: article.id, filename: "fixture.png", mimeType: "image/png", data: png },
  { articleId: foreignArticle.id, filename: "foreign.png", mimeType: "image/png", data: png },
]).returning();
let externalRequests = 0;
const external = createServer((_req, res) => { externalRequests++; res.end("not permitted"); }).listen(0, "127.0.0.1");
await new Promise<void>(resolve => external.once("listening", resolve));
const externalAddress = external.address();
assert.ok(externalAddress && typeof externalAddress !== "string");
const paragraphs = Array.from({ length: 25 }, (_, index) => `<p>Full-width paragraph ${index + 1}: This paragraph must start at the left margin and use the available page width. It must never inherit the position of an infobox cell. Browser layout should wrap this text naturally across multiple lines.</p>`).join("");
await db.update(articlesTable).set({
  content: `<p>Introductory paragraph with <strong>bold text</strong>, <em>italic text</em>, <u>underlined text</u> and a <a href="https://example.test/reference">source link</a>.</p>
  <div data-type="infobox"><table class="infobox"><caption>Summary</caption><tbody>
    <tr><th>Owner</th><td>Example team</td></tr><tr><th>Status</th><td>Published</td></tr>
    <tr><th>Long value</th><td>Values wrap without truncation, preserving the HTML table layout.</td></tr></tbody></table></div>
  <h2>Headings and lists</h2><p>Article text wraps beside the summary, then returns to the full content width below it. A [[related article|readable wikilink]] retains its label.</p>
  <ol type="1" start="3"><li>Numbered entry<ol type="a"><li>Alphabetic nested item<ol type="i"><li>Roman nested item</li></ol></li></ol></li><li>Next numbered entry</li></ol>
  <blockquote><p>A quoted passage should keep its distinct indentation and styling.</p></blockquote>
  <h3>A real table</h3><table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody><tr><td>Typography</td><td>HTML styling preserved</td></tr><tr><td>Alignment</td><td>Left aligned, not a narrow right-hand column</td></tr></tbody></table>
  <p><img src="/api/articles/images/${image.id}" width="80" data-caption="Attached image and caption"></p>
  <p><img src="/api/articles/images/${foreignImage.id}" alt="foreign private image"><img src="http://127.0.0.1:${externalAddress.port}/private" alt="external image"></p>
  <pre><code>const example = "code retains monospace";
return example;</code></pre>
  <p style="text-align:center">Intentional center alignment stays centered.</p>
  <p>A source citation<sup data-type="citation"><a id="cite-ref-c-example" href="#cite-source-1">[1]</a></sup>.</p>
  <section data-type="citation-sources"><h2>Sources</h2><ol><li id="cite-source-1"><a href="https://example.test/reference">Reference title</a></li></ol></section>
  ${paragraphs}`,
}).where(eq(articlesTable.id, article.id));
const app = express();
app.use((req, _res, next) => {
  const person = Number(req.headers["x-test-actor"]) === owner.id ? owner : stranger;
  (req as any).session = req.headers["x-test-actor"] ? { userId: person.id, userRole: person.role } : {};
  (req as any).log = { error: (...args: unknown[]) => console.error(...args) };
  next();
});
app.use("/api", articles);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const url = `http://127.0.0.1:${address.port}/api/articles/${article.slug}/export/pdf`;
try {
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { "x-test-actor": String(stranger.id) } })).status, 404);
  const response = await fetch(url, { headers: { "x-test-actor": String(owner.id) } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("content-disposition")!, /attachment.*\.pdf/);
  const pdf = Buffer.from(await response.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(externalRequests, 0);
  const directory = await mkdtemp(path.join(tmpdir(), "article-pdf-"));
  const output = path.join(directory, "regression.pdf");
  await writeFile(output, pdf);
  console.log(`article PDF checks passed; visual fixture: ${output}`);
} finally {
  server.close();
  external.close();
  await pool.end();
}
