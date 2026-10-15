import assert from "node:assert/strict";
import express from "express";
import { writeFileSync } from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db, pool, usersTable, articlesTable, articleVersionsTable, articleImagesTable,
  templatesTable, projectsTable, boardsTable, boardColumnsTable, boardCardsTable,
  boardCardCommentsTable, siteSettingsTable, taskListsTable, tasksTable,
} from "@workspace/db";
import { csrfProtection } from "../../src/lib/csrf";
import { mediaDiagramPng } from "./media-diagram-fixture";

assert.match(process.env.BACKUP_TEST_SCHEMA ?? "", /^backup_test_[a-f0-9]{32}$/);
assert.equal((await db.execute(sql`SELECT current_schema() AS schema`)).rows[0].schema, process.env.BACKUP_TEST_SCHEMA);
const [admin, editor] = await db.insert(usersTable).values([
  { name: "Maintenance admin", email: "media-admin@example.test", role: "admin", passwordHash: "unused" },
  { name: "Maintenance editor", email: "media-editor@example.test", role: "editor", passwordHash: "unused" },
]).returning();
const old = new Date(Date.now() - 10 * 86400_000);
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ioAAAAASUVORK5CYII=";
const names = ["current.png", "infobox.png", "history-diagram.png", "step.png", "template.png", "template-step.png",
  "project.png", "document.png", "card.png", "comment.png", "setting.png", "task.png",
  "attached-unused.png", "abandoned.png", "recent.png", ...Array.from({ length: 110 }, (_, i) => `unused-${String(i).padStart(3, "0")}.png`)];
const images = await db.insert(articleImagesTable).values(names.map(filename => ({
  filename, mimeType: "image/png", data: png, uploadedById: admin.id,
  createdAt: filename === "recent.png" ? new Date() : old,
}))).returning();
const image = (name: string) => images.find(i => i.filename === name)!;
const url = (name: string) => `/api/articles/images/${image(name).id}`;
const [article] = await db.insert(articlesTable).values({
  title: "Current fixture", slug: "media-current", content: `<img src="${url("current.png")}"><div data-image="${url("infobox.png")}"></div>`,
  createdById: admin.id,
}).returning();
await db.update(articleImagesTable).set({ articleId: article.id }).where(inArray(articleImagesTable.id, [image("current.png").id, image("attached-unused.png").id]));
await db.insert(articleVersionsTable).values([1, 2].map(versionNumber => ({
  articleId: article.id, versionNumber, title: "Historical diagram", content: `<img data-type="drawio" src="${url("history-diagram.png")}">`, createdById: admin.id,
})));
await db.insert(articlesTable).values({
  title: "Procedure fixture", slug: "media-procedure", kind: "procedure", createdById: admin.id,
  procedureSteps: [{ title: "Read", description: `<img src="${url("step.png")}">` }],
});
await db.insert(templatesTable).values({
  name: "Protected template", content: `<img src="${url("template.png")}">`, kind: "procedure", createdById: admin.id,
  procedureSteps: [{ title: "Template step", description: `<img src="${url("template-step.png")}">` }],
});
const [project] = await db.insert(projectsTable).values({
  name: "Archived fixture", description: url("project.png"), archivedAt: old, createdById: admin.id, managerId: admin.id,
}).returning();
await db.insert(articlesTable).values({
  title: "Project document", slug: "media-document", projectId: project.id, createdById: admin.id, content: `<img src="${url("document.png")}">`,
});
const [board] = await db.insert(boardsTable).values({ name: "Fixture board", projectId: project.id }).returning();
const [column] = await db.insert(boardColumnsTable).values({ name: "To do", boardId: board.id }).returning();
const [card] = await db.insert(boardCardsTable).values({ title: "Fixture card", columnId: column.id, description: url("card.png"), createdById: admin.id }).returning();
await db.insert(boardCardCommentsTable).values({ cardId: card.id, userId: admin.id, content: url("comment.png") });
await db.insert(siteSettingsTable).values({ key: "fixture_media", value: url("setting.png") });
const [list] = await db.insert(taskListsTable).values({ userId: admin.id, name: "Fixture tasks" }).returning();
await db.insert(tasksTable).values({ listId: list.id, title: `Read ${url("task.png")}` });

const { default: maintenance } = await import("../../src/routes/admin-maintenance");
const { default: imageRoutes } = await import("../../src/routes/images");
const sessions = new Map<string, any>();
const app = express();
app.use(express.json());
app.use("/api", csrfProtection({ allowedOrigins: process.env.REPLIT_DEV_DOMAIN ? [`https://${process.env.REPLIT_DEV_DOMAIN}`] : [] }));
app.use((req, _res, next) => {
  const key = String(req.headers["x-test-session"] ?? "admin");
  let session = sessions.get(key);
  if (!session) {
    const actor = key === "anonymous" ? null : key === "editor" ? editor : admin;
    session = {
      ...(actor ? { userId: actor.id, userRole: actor.role, userName: actor.name } : {}),
      save: (callback: (err?: Error) => void) => callback(),
    };
    sessions.set(key, session);
  }
  (req as any).session = session;
  next();
});
app.use("/api", maintenance, imageRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: err.message });
});
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}/api`;
async function api(method: string, path: string, data?: unknown, session = "admin", expected = 200, origin = base) {
  const response = await fetch(base + path, {
    method, headers: { "Content-Type": "application/json", "x-test-session": session, Origin: new URL(origin).origin },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body)}`);
  return body;
}
const preview = (session = "admin") => api("POST", "/admin/media/cleanup-preview", undefined, session);
const clean = (previewId: string, session = "admin", expected = 200) =>
  api("POST", "/admin/media/cleanup", { previewId, confirmation: "DELETE UNUSED MEDIA" }, session, expected);
const stored = () => db.select({ id: articleImagesTable.id }).from(articleImagesTable);

if (process.env.MEDIA_BROWSER_FIXTURE === "1") {
  writeFileSync("/tmp/memex-media-fixture-ready.json", JSON.stringify({ base, count: images.length, currentId: image("current.png").id, recentId: image("recent.png").id }));
  console.log(`Synthetic isolated media fixture ready at ${base}`);
  await new Promise<void>(resolve => {
    process.once("SIGTERM", () => resolve());
    process.once("SIGINT", () => resolve());
  });
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
} else {
  try {
    const all = await api("GET", "/admin/media");
    assert.equal(all.images.length, 20);
    assert.equal(all.total, images.length);
    assert.equal(all.summary.current, 11);
    assert.equal(all.summary.history, 1);
    assert.equal(all.summary.recent, 1);
    assert.equal(all.summary.unused, 112);
    assert.equal(all.summary.totalBytes, images.length * png.length);
    assert.ok(all.images.every((i: any) => !("data" in i)));
    assert.equal((await api("GET", "/admin/media?limit=20&offset=100")).images.length, 20);
    assert.equal((await api("GET", "/admin/media?status=unused&search=attached")).images[0].id, image("attached-unused.png").id);
    const historical = (await api("GET", "/admin/media?status=history")).images[0];
    assert.equal(historical.id, image("history-diagram.png").id);
    assert.equal(historical.historyReferences, 2);
    for (const bad of ["limit=101", "offset=-1", "status=missing", "search=" + "x".repeat(201)]) await api("GET", `/admin/media?${bad}`, undefined, "admin", 400);
    for (const session of ["anonymous", "editor"]) {
      const expected = session === "anonymous" ? 401 : 403;
      await api("GET", "/admin/media", undefined, session, expected);
      await api("POST", "/admin/media/cleanup-preview", undefined, session, expected);
      await api("POST", "/admin/media/cleanup", { previewId: "forged", confirmation: "DELETE UNUSED MEDIA" }, session, expected);
    }
    await api("POST", "/admin/media/cleanup-preview", undefined, "admin", 403, "https://untrusted.example");
    let p = await preview();
    assert.equal(p.count, 112);
    assert.equal(p.reclaimableBytes, 112 * png.length);
    assert.equal((await stored()).length, images.length, "Preview and cancellation cannot delete");
    await api("POST", "/admin/media/cleanup", { previewId: p.previewId }, "admin", 400);
    await clean(p.previewId, "another-admin-session", 409);
    sessions.get("admin").mediaCleanupPreview.expiresAt = Date.now() - 1;
    await clean(p.previewId, "admin", 409);
    await clean("forged", "admin", 409);
    // Transactional failure must roll back every delete.
    p = await preview();
    await db.execute(sql`CREATE FUNCTION reject_media_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF OLD.filename = 'abandoned.png' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN OLD; END $$`);
    await db.execute(sql`CREATE TRIGGER reject_media_delete BEFORE DELETE ON article_images FOR EACH ROW EXECUTE FUNCTION reject_media_delete()`);
    await clean(p.previewId, "admin", 500);
    assert.equal((await stored()).length, images.length);
    await db.execute(sql`DROP TRIGGER reject_media_delete ON article_images`);
    await db.execute(sql`DROP FUNCTION reject_media_delete()`);
    // A simultaneous writer causes a safe retry rather than racing deletion.
    p = await preview();
    const writer = await pool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query("INSERT INTO templates(name,content) VALUES ($1,$2)", ["Concurrent writer", url("abandoned.png")]);
      await clean(p.previewId, "admin", 409);
      assert.equal((await stored()).length, images.length);
      await writer.query("COMMIT");
    } finally { await writer.query("ROLLBACK"); writer.release(); }
    // Recheck current references, fingerprints, and never expand a preview's set.
    p = await preview();
    assert.equal(p.count, 111);
    await db.insert(templatesTable).values({ name: "Newly in use", content: url("attached-unused.png") });
    await db.update(articleImagesTable).set({ data: Buffer.from("replacement bytes").toString("base64") }).where(eq(articleImagesTable.id, image("unused-000.png").id));
    await db.update(articlesTable).set({ content: `<img src="${url("current.png")}">` }).where(eq(articlesTable.id, article.id)); // infobox now unused, not previewed
    const [newImage] = await db.insert(articleImagesTable).values({ filename: "new-after-preview.png", data: png, mimeType: "image/png", createdAt: old, uploadedById: admin.id }).returning();
    const result = await clean(p.previewId);
    assert.equal(result.deletedCount, 109);
    assert.equal(result.skippedCount, 2);
    assert.equal(result.reclaimedBytes, 109 * png.length);
    const survivors = new Set((await stored()).map(i => i.id));
    for (const name of names.slice(0, 15)) assert.ok(survivors.has(image(name).id), `${name} must survive`);
    assert.ok(survivors.has(image("unused-000.png").id));
    assert.ok(survivors.has(newImage.id));
    await clean(p.previewId, "admin", 409);
    const after = await api("GET", "/admin/media");
    assert.equal(after.summary.total, 17);
    // A flattened diagram can depend on media through compressed editable source.
    const [leaf] = await db.insert(articleImagesTable).values({ filename: "diagram-leaf.png", data: png, mimeType: "image/png", createdAt: old }).returning();
    const [nested] = await db.insert(articleImagesTable).values({ filename: "nested-diagram.png", data: mediaDiagramPng(leaf.id).toString("base64"), mimeType: "image/png", createdAt: old }).returning();
    const [root] = await db.insert(articleImagesTable).values({ filename: "root-diagram.png", data: mediaDiagramPng(nested.id).toString("base64"), mimeType: "image/png", createdAt: old }).returning();
    const [diagramArticle] = await db.insert(articlesTable).values({ title: "Diagram dependencies", slug: "media-diagram-dependencies", content: `<img src="/api/articles/images/${root.id}" data-diagram="drawio">`, createdById: admin.id }).returning();
    let dependencies = await api("GET", "/admin/media?search=diagram");
    assert.equal(dependencies.images.find((i: any) => i.id === leaf.id).status, "current");
    assert.equal(dependencies.images.find((i: any) => i.id === nested.id).status, "current");
    await db.insert(articleVersionsTable).values({ articleId: diagramArticle.id, versionNumber: 1, title: diagramArticle.title, content: diagramArticle.content });
    await db.update(articlesTable).set({ content: "" }).where(eq(articlesTable.id, diagramArticle.id));
    dependencies = await api("GET", "/admin/media?status=history&search=diagram");
    for (const id of [leaf.id, nested.id, root.id]) assert.ok(dependencies.images.some((i: any) => i.id === id));
    assert.equal((await preview()).count, 3, "Diagram dependencies are never cleanup candidates");
    const [orphanLeaf] = await db.insert(articleImagesTable).values({ filename: "orphan-leaf.png", data: png, mimeType: "image/png", createdAt: old }).returning();
    const [orphanParent] = await db.insert(articleImagesTable).values({ filename: "orphan-parent.png", data: mediaDiagramPng(orphanLeaf.id).toString("base64"), mimeType: "image/png", createdAt: old }).returning();
    const orphanPreview = await preview();
    assert.equal(orphanPreview.count, 4, "Stored orphan diagram protects its child for this pass");
    // Changed parents skipped by fingerprint checks must not lose their dependencies.
    await db.update(articleImagesTable).set({ filename: "changed-orphan-parent.png" }).where(eq(articleImagesTable.id, orphanParent.id));
    const orphanResult = await clean(orphanPreview.previewId);
    assert.equal(orphanResult.deletedCount, 3);
    assert.equal(orphanResult.skippedCount, 1);
    assert.ok((await stored()).some(i => i.id === orphanLeaf.id));
    const parentPreview = await preview();
    assert.equal(parentPreview.count, 1);
    await clean(parentPreview.previewId);
    assert.ok((await stored()).some(i => i.id === orphanLeaf.id));
    assert.equal((await preview()).count, 1, "The child becomes eligible only after its orphan parent is gone");
    console.log("PASS: safe media maintenance; pagination, all saved references, recent uploads, metadata-only responses, authorization/CSRF, confirmation/expiry/session binding, rollback, concurrent writers, fresh references, changed files and preview-bound deletion");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
}
