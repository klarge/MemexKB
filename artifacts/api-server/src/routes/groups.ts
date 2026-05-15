import { Router } from "express";
import { db } from "@workspace/db";
import { groupsTable, groupMembersTable, usersTable } from "@workspace/db";
import { eq, count, inArray, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";

const router = Router();

router.get("/groups", requireAuth, async (_req, res) => {
  const groups = await db.select().from(groupsTable).orderBy(groupsTable.name);
  const memberCounts = await db
    .select({ groupId: groupMembersTable.groupId, count: count() })
    .from(groupMembersTable)
    .groupBy(groupMembersTable.groupId);
  const countMap = new Map(memberCounts.map((m) => [m.groupId, Number(m.count)]));
  res.json(
    groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      createdAt: g.createdAt,
      memberCount: countMap.get(g.id) ?? 0,
    })),
  );
});

router.post("/groups", requireAuth, requireRole("admin"), async (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    res.status(400).json({ error: "Name required" });
    return;
  }
  const [group] = await db
    .insert(groupsTable)
    .values({ name, description: description ?? null })
    .returning();
  res.status(201).json({ id: group.id, name: group.name, description: group.description, createdAt: group.createdAt, memberCount: 0 });
});

router.get("/groups/:id", requireAuth, async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, id)).limit(1);
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const members = await db
    .select({ userId: groupMembersTable.userId })
    .from(groupMembersTable)
    .where(eq(groupMembersTable.groupId, id));

  let memberUsers: Array<{ id: number; email: string; name: string; role: string; createdAt: Date; groups: unknown[] }> = [];
  if (members.length > 0) {
    const users = await db
      .select()
      .from(usersTable)
      .where(inArray(usersTable.id, members.map((m) => m.userId)));
    memberUsers = users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt, groups: [] }));
  }
  res.json({ id: group.id, name: group.name, description: group.description, createdAt: group.createdAt, members: memberUsers });
});

router.patch("/groups/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const { name, description } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  const [group] = await db.update(groupsTable).set(updates).where(eq(groupsTable.id, id)).returning();
  if (!group) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  res.json({ id: group.id, name: group.name, description: group.description, createdAt: group.createdAt, memberCount: 0 });
});

router.delete("/groups/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const deleted = await db.delete(groupsTable).where(eq(groupsTable.id, parseInt(String(req.params.id)))).returning();
  if (deleted.length === 0) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  res.json({ message: "Group deleted" });
});

router.post("/groups/:id/members", requireAuth, requireRole("admin"), async (req, res) => {
  const groupId = parseInt(String(req.params.id));
  const { userId } = req.body;
  if (!userId) {
    res.status(400).json({ error: "userId required" });
    return;
  }
  await db
    .insert(groupMembersTable)
    .values({ groupId, userId })
    .onConflictDoNothing();
  res.json({ message: "Member added" });
});

router.delete("/groups/:id/members/:userId", requireAuth, requireRole("admin"), async (req, res) => {
  const groupId = parseInt(String(req.params.id));
  const userId = parseInt(String(req.params.userId));
  await db
    .delete(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.groupId, groupId),
        eq(groupMembersTable.userId, userId),
      ),
    );
  res.json({ message: "Member removed" });
});

export default router;
