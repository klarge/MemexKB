import { Router } from "express";
import { db } from "@workspace/db";
import { templatesTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { sanitizeArticleHtml } from "../lib/sanitize";

const router = Router();

router.get("/templates", requireAuth, async (_req, res) => {
  const rows = await db
    .select({
      id: templatesTable.id,
      name: templatesTable.name,
      content: templatesTable.content,
      createdAt: templatesTable.createdAt,
      updatedAt: templatesTable.updatedAt,
      createdByName: usersTable.name,
    })
    .from(templatesTable)
    .leftJoin(usersTable, eq(templatesTable.createdById, usersTable.id))
    .orderBy(desc(templatesTable.updatedAt));

  res.json(rows);
});

router.get("/templates/:id", requireAuth, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select({
      id: templatesTable.id,
      name: templatesTable.name,
      content: templatesTable.content,
      createdAt: templatesTable.createdAt,
      updatedAt: templatesTable.updatedAt,
      createdByName: usersTable.name,
    })
    .from(templatesTable)
    .leftJoin(usersTable, eq(templatesTable.createdById, usersTable.id))
    .where(eq(templatesTable.id, id))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  res.json(row);
});

router.post("/templates", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  const { name, content } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }

  const [row] = await db
    .insert(templatesTable)
    .values({
      name: name.trim(),
      content: sanitizeArticleHtml(content ?? ""),
      createdById: req.session.userId ?? null,
    })
    .returning();

  res.status(201).json(row);
});

router.patch("/templates/:id", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select({ id: templatesTable.id }).from(templatesTable).where(eq(templatesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Template not found" }); return; }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
  if (req.body.content !== undefined) updates.content = sanitizeArticleHtml(req.body.content);

  const [row] = await db.update(templatesTable).set(updates).where(eq(templatesTable.id, id)).returning();
  res.json(row);
});

router.delete("/templates/:id", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select({ id: templatesTable.id }).from(templatesTable).where(eq(templatesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Template not found" }); return; }

  await db.delete(templatesTable).where(eq(templatesTable.id, id));
  res.json({ message: "Deleted" });
});

export default router;
