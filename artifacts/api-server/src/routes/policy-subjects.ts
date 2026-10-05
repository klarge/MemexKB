import { Router } from "express";
import { db, policySubjectsTable, articlesTable } from "@workspace/db";
import { eq, asc, sql, or } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";

const router = Router();
router.get("/policy-subjects", requireAuth, async (_req, res) => {
  res.json(await db.select().from(policySubjectsTable).orderBy(asc(policySubjectsTable.name)));
});
async function save(id: number | null, name: string, parentId: number | null) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(824200)`);
    const subjects = await tx.select().from(policySubjectsTable);
    if (id !== null && !subjects.some((s) => s.id === id)) throw new Error("Subject not found");
    let cursor = parentId;
    const visited = new Set<number>();
    while (cursor !== null) {
      if (cursor === id || visited.has(cursor)) throw new Error("Subjects cannot contain cycles");
      visited.add(cursor);
      const parent = subjects.find((s) => s.id === cursor);
      if (!parent) throw new Error("Parent subject not found");
      cursor = parent.parentId;
    }
    if (subjects.some((s) => s.id !== id && s.parentId === parentId && s.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("A subject with this name already exists under this parent");
    }
    const [subject] = id === null
      ? await tx.insert(policySubjectsTable).values({ name, parentId }).returning()
      : await tx.update(policySubjectsTable).set({ name, parentId }).where(eq(policySubjectsTable.id, id)).returning();
    return subject;
  });
}
for (const method of ["post", "patch"] as const) {
  router[method](method === "post" ? "/policy-subjects" : "/policy-subjects/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const id = method === "post" ? null : Number(req.params.id);
    const { name, parentId = null } = req.body;
    if (typeof name !== "string" || !name.trim() || name.length > 200 ||
        (id !== null && (!Number.isSafeInteger(id) || id < 1)) ||
        (parentId !== null && (!Number.isSafeInteger(parentId) || parentId < 1))) {
      res.status(400).json({ error: "A subject name and valid parent are required" }); return;
    }
    try { res.status(method === "post" ? 201 : 200).json(await save(id, name.trim(), parentId)); }
    catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Unable to save subject" }); }
  });
}
router.delete("/policy-subjects/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Invalid subject" }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(824200)`);
      const [child] = await tx.select().from(policySubjectsTable).where(eq(policySubjectsTable.parentId, id)).limit(1);
      const [article] = await tx.select({ id: articlesTable.id }).from(articlesTable).where(eq(articlesTable.policySubjectId, id)).limit(1);
      if (child || article) return "used";
      const deleted = await tx.delete(policySubjectsTable).where(eq(policySubjectsTable.id, id)).returning();
      return deleted.length ? "deleted" : "missing";
    });
    if (result === "used") { res.status(409).json({ error: "Move child subjects and policies before deleting this subject" }); return; }
    if (result === "missing") { res.status(404).json({ error: "Subject not found" }); return; }
    res.status(204).send();
  } catch { res.status(409).json({ error: "This subject is in use" }); }
});
export default router;