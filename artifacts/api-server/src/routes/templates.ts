import { Router } from "express";
import { db } from "@workspace/db";
import { templatesTable, templateTagsTable, tagsTable, usersTable, siteSettingsTable } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { sanitizeArticleHtml } from "../lib/sanitize";
import { isContentKind, validateSteps } from "../lib/content-kinds";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getTemplateTags(templateId: number) {
  const rows = await db
    .select({ id: tagsTable.id, name: tagsTable.name, color: tagsTable.color })
    .from(templateTagsTable)
    .innerJoin(tagsTable, eq(templateTagsTable.tagId, tagsTable.id))
    .where(eq(templateTagsTable.templateId, templateId));
  return rows;
}

async function setTemplateTags(templateId: number, tagIds: number[]) {
  await db.delete(templateTagsTable).where(eq(templateTagsTable.templateId, templateId));
  if (tagIds.length > 0) {
    await db.insert(templateTagsTable).values(
      tagIds.map((tagId) => ({ templateId, tagId }))
    );
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get("/templates", requireAuth, async (_req, res) => {
  const rows = await db
    .select({
      id: templatesTable.id,
      name: templatesTable.name,
      content: templatesTable.content,
      kind: templatesTable.kind,
      procedureSteps: templatesTable.procedureSteps,
      createdAt: templatesTable.createdAt,
      updatedAt: templatesTable.updatedAt,
      createdByName: usersTable.name,
    })
    .from(templatesTable)
    .leftJoin(usersTable, eq(templatesTable.createdById, usersTable.id))
    .orderBy(desc(templatesTable.updatedAt));

  // Attach tags to each template
  const ids = rows.map((r) => r.id);
  let tagRows: { templateId: number; id: number; name: string; color: string }[] = [];
  if (ids.length > 0) {
    tagRows = await db
      .select({
        templateId: templateTagsTable.templateId,
        id: tagsTable.id,
        name: tagsTable.name,
        color: tagsTable.color,
      })
      .from(templateTagsTable)
      .innerJoin(tagsTable, eq(templateTagsTable.tagId, tagsTable.id))
      .where(inArray(templateTagsTable.templateId, ids));
  }

  const tagsByTemplate = new Map<number, { id: number; name: string; color: string }[]>();
  for (const t of tagRows) {
    const arr = tagsByTemplate.get(t.templateId) ?? [];
    arr.push({ id: t.id, name: t.name, color: t.color });
    tagsByTemplate.set(t.templateId, arr);
  }

  res.json(rows.map((r) => ({ ...r, tags: tagsByTemplate.get(r.id) ?? [] })));
});

router.get("/templates/:id", requireAuth, async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select({
      id: templatesTable.id,
      name: templatesTable.name,
      content: templatesTable.content,
      kind: templatesTable.kind,
      procedureSteps: templatesTable.procedureSteps,
      createdAt: templatesTable.createdAt,
      updatedAt: templatesTable.updatedAt,
      createdByName: usersTable.name,
    })
    .from(templatesTable)
    .leftJoin(usersTable, eq(templatesTable.createdById, usersTable.id))
    .where(eq(templatesTable.id, id))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Template not found" }); return; }

  const tags = await getTemplateTags(id);
  res.json({ ...row, tags });
});

router.post("/templates", requireAuth, requireRole("admin"), async (req, res) => {
  const { name, content, tagIds } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
  const kind = req.body.kind ?? "knowledge";
  if (!isContentKind(kind)) { res.status(400).json({ error: "Invalid template kind" }); return; }
  let procedureSteps: ReturnType<typeof validateSteps> = [];
  try { if (kind === "procedure") procedureSteps = validateSteps(req.body.procedureSteps); }
  catch (e) { res.status(400).json({ error: (e as Error).message }); return; }

  const [row] = await db
    .insert(templatesTable)
    .values({
      name: name.trim(),
      content: sanitizeArticleHtml(content ?? ""),
      kind,
      procedureSteps,
      createdById: req.session.userId ?? null,
    })
    .returning();

  const ids: number[] = Array.isArray(tagIds) ? tagIds.filter((x) => typeof x === "number") : [];
  await setTemplateTags(row.id, ids);
  const tags = await getTemplateTags(row.id);

  res.status(201).json({ ...row, tags });
});

router.patch("/templates/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(templatesTable).where(eq(templatesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Template not found" }); return; }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  const kind = req.body.kind ?? existing.kind;
  if (!isContentKind(kind)) { res.status(400).json({ error: "Invalid template kind" }); return; }
  if (kind !== existing.kind) {
    const defaults = await db.select().from(siteSettingsTable).where(inArray(siteSettingsTable.key, ["policy_template_id", "procedure_template_id"]));
    if (defaults.some((s) => s.value === String(id))) { res.status(409).json({ error: "Clear or replace the default before changing its template kind" }); return; }
  }
  updates.kind = kind;
  try { updates.procedureSteps = kind === "procedure" ? validateSteps(req.body.procedureSteps === undefined ? existing.procedureSteps : req.body.procedureSteps) : []; }
  catch (e) { res.status(400).json({ error: (e as Error).message }); return; }
  if (req.body.name !== undefined && (typeof req.body.name !== "string" || !req.body.name.trim())) { res.status(400).json({ error: "Name is required" }); return; }
  if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
  if (req.body.content !== undefined) updates.content = sanitizeArticleHtml(req.body.content);

  const [row] = await db.update(templatesTable).set(updates).where(eq(templatesTable.id, id)).returning();

  if (Array.isArray(req.body.tagIds)) {
    const ids: number[] = req.body.tagIds.filter((x: unknown) => typeof x === "number");
    await setTemplateTags(id, ids);
  }

  const tags = await getTemplateTags(id);
  res.json({ ...row, tags });
});

router.delete("/templates/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select({ id: templatesTable.id }).from(templatesTable).where(eq(templatesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Template not found" }); return; }

  const defaults = await db.select().from(siteSettingsTable).where(inArray(siteSettingsTable.key, ["policy_template_id", "procedure_template_id"]));
  if (defaults.some((s) => s.value === String(id))) { res.status(409).json({ error: "Clear or replace the selected default template before deleting it" }); return; }
  await db.delete(templatesTable).where(eq(templatesTable.id, id));
  res.json({ message: "Deleted" });
});

export default router;
