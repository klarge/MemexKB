import { Router } from "express";
import { db } from "@workspace/db";
import { tagsTable, articleTagsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";

const router = Router();

// GET /api/tags — list all tags (any authenticated user)
router.get("/tags", requireAuth, async (req, res) => {
  const tags = await db
    .select({
      id: tagsTable.id,
      name: tagsTable.name,
      color: tagsTable.color,
      createdAt: tagsTable.createdAt,
    })
    .from(tagsTable)
    .orderBy(tagsTable.name);

  // Attach article counts
  const counts = await db
    .select({ tagId: articleTagsTable.tagId, count: count() })
    .from(articleTagsTable)
    .groupBy(articleTagsTable.tagId);

  const countMap = new Map(counts.map((c) => [c.tagId, Number(c.count)]));

  res.json(
    tags.map((t) => ({
      ...t,
      articleCount: countMap.get(t.id) ?? 0,
    })),
  );
});

// POST /api/tags — create a tag (admin only)
router.post("/tags", requireAuth, requireRole("admin"), async (req, res) => {
  const { name, color } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Tag name is required" });
    return;
  }
  const trimmed = name.trim();
  const existing = await db
    .select({ id: tagsTable.id })
    .from(tagsTable)
    .where(eq(tagsTable.name, trimmed))
    .limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "A tag with that name already exists" });
    return;
  }
  const [tag] = await db
    .insert(tagsTable)
    .values({ name: trimmed, color: color ?? "#6366f1" })
    .returning();
  res.status(201).json({ ...tag, articleCount: 0 });
});

// PATCH /api/tags/:id — update a tag name/color (admin only)
router.patch("/tags/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid tag id" });
    return;
  }
  const { name, color } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) {
      res.status(400).json({ error: "Tag name cannot be empty" });
      return;
    }
    updates.name = trimmed;
  }
  if (color !== undefined) updates.color = color;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }
  const [tag] = await db
    .update(tagsTable)
    .set(updates)
    .where(eq(tagsTable.id, id))
    .returning();
  if (!tag) {
    res.status(404).json({ error: "Tag not found" });
    return;
  }
  const [countRow] = await db
    .select({ count: count() })
    .from(articleTagsTable)
    .where(eq(articleTagsTable.tagId, id));
  res.json({ ...tag, articleCount: Number(countRow?.count ?? 0) });
});

// DELETE /api/tags/:id — delete a tag (admin only)
router.delete("/tags/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid tag id" });
    return;
  }
  const [existing] = await db
    .select({ id: tagsTable.id })
    .from(tagsTable)
    .where(eq(tagsTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Tag not found" });
    return;
  }
  await db.delete(tagsTable).where(eq(tagsTable.id, id));
  res.json({ message: "Tag deleted" });
});

export default router;
