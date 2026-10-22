import { Router } from "express";
import { db, groupsTable, groupMembersTable, usersTable } from "@workspace/db";
import { eq, count, inArray, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { z } from "zod";
const router = Router();
const input = z.object({ name: z.string().trim().min(1).max(100), description: z.string().max(2000).nullable().optional() });
const idOf = (value: unknown) => z.coerce.number().int().positive().parse(value);
router.get("/groups", requireAuth, async (req, res) => {
  const memberships = await db.select().from(groupMembersTable).where(eq(groupMembersTable.userId, req.session.userId!));
  const ids = memberships.map(m => m.groupId);
  const groups = req.session.userRole === "admin"
    ? await db.select().from(groupsTable).orderBy(groupsTable.name)
    : ids.length ? await db.select().from(groupsTable).where(inArray(groupsTable.id, ids)).orderBy(groupsTable.name) : [];
  // Counts are only returned for visible groups.
  const counts = groups.length ? await db.select({ groupId: groupMembersTable.groupId, count: count() }).from(groupMembersTable)
    .where(inArray(groupMembersTable.groupId, groups.map(g => g.id))).groupBy(groupMembersTable.groupId) : [];
  res.json(groups.map(g => ({ ...g, memberCount: Number(counts.find(c => c.groupId === g.id)?.count ?? 0) })));
});
router.get("/groups/:id", requireAuth, async (req, res) => {
  const id = idOf(req.params.id);
  if (req.session.userRole !== "admin") {
    const [membership] = await db.select().from(groupMembersTable).where(and(eq(groupMembersTable.groupId, id), eq(groupMembersTable.userId, req.session.userId!)));
    if (!membership) { res.status(403).json({ error: "Forbidden" }); return; }
  }
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, id));
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }
  const members = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, createdAt: usersTable.createdAt })
    .from(usersTable).innerJoin(groupMembersTable, eq(groupMembersTable.userId, usersTable.id)).where(eq(groupMembersTable.groupId, id));
  // Non-admin group members can see names, not other accounts' email/role.
  res.json({ ...group, members: members.map(m => req.session.userRole === "admin" ? { ...m, groups: [] } : { id: m.id, name: m.name }) });
});
router.post("/groups", requireRole("admin"), async (req, res) => {
  const [group] = await db.insert(groupsTable).values(input.parse(req.body)).returning();
  res.status(201).json({ ...group, memberCount: 0 });
});
router.patch("/groups/:id", requireRole("admin"), async (req, res) => {
  const [group] = await db.update(groupsTable).set(input.partial().refine(v => Object.keys(v).length > 0).parse(req.body)).where(eq(groupsTable.id, idOf(req.params.id))).returning();
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }
  res.json({ ...group, memberCount: 0 });
});
router.delete("/groups/:id", requireRole("admin"), async (req, res) => {
  const rows = await db.delete(groupsTable).where(eq(groupsTable.id, idOf(req.params.id))).returning();
  if (!rows.length) { res.status(404).json({ error: "Group not found" }); return; }
  res.json({ message: "Group deleted" });
});
router.post("/groups/:id/members", requireRole("admin"), async (req, res) => {
  await db.insert(groupMembersTable).values({ groupId: idOf(req.params.id), userId: idOf(req.body.userId) }).onConflictDoNothing();
  res.json({ message: "Member added" });
});
router.delete("/groups/:id/members/:userId", requireRole("admin"), async (req, res) => {
  await db.delete(groupMembersTable).where(and(eq(groupMembersTable.groupId, idOf(req.params.id)), eq(groupMembersTable.userId, idOf(req.params.userId))));
  res.json({ message: "Member removed" });
});
export default router;
