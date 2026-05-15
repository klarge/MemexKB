import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, groupsTable, groupMembersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";

const router = Router();

router.get("/users", requireAuth, requireRole("admin"), async (_req, res) => {
  const users = await db.select().from(usersTable).orderBy(usersTable.name);

  const members = await db.select().from(groupMembersTable);
  const groups = await db.select().from(groupsTable);

  const groupMap = new Map(groups.map((g) => [g.id, g]));

  const result = users.map((u) => {
    const userGroups = members
      .filter((m) => m.userId === u.id)
      .map((m) => groupMap.get(m.groupId))
      .filter(Boolean)
      .map((g) => ({ id: g!.id, name: g!.name, description: g!.description }));
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      createdAt: u.createdAt,
      groups: userGroups,
    };
  });
  res.json(result);
});

router.post("/users", requireAuth, requireRole("admin"), async (req, res) => {
  const { email, name, password, role } = req.body;
  if (!email || !name || !password || !role) {
    res.status(400).json({ error: "All fields required" });
    return;
  }
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "Email already in use" });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(usersTable)
    .values({ email: email.toLowerCase(), name, passwordHash, role })
    .returning();
  res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt, groups: [] });
});

router.get("/users/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const members = await db.select().from(groupMembersTable).where(eq(groupMembersTable.userId, id));
  let userGroups: { id: number; name: string; description: string | null }[] = [];
  if (members.length > 0) {
    const groups = await db
      .select()
      .from(groupsTable)
      .where(inArray(groupsTable.id, members.map((m) => m.groupId)));
    userGroups = groups.map((g) => ({ id: g.id, name: g.name, description: g.description }));
  }
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt, groups: userGroups });
});

router.patch("/users/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }
  const { email, name, role, password } = req.body;
  const updates: Record<string, unknown> = {};
  if (email) updates.email = email.toLowerCase();
  if (name) updates.name = name;
  if (role) updates.role = role;
  if (password) updates.passwordHash = await bcrypt.hash(password, 12);
  updates.updatedAt = new Date();
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt, groups: [] });
});

router.delete("/users/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }
  const deleted = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
  if (deleted.length === 0) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ message: "User deleted" });
});

router.get("/users/:id/groups", requireAuth, async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }
  // Only admins or the user themselves may read group memberships
  if (req.session.userRole !== "admin" && req.session.userId !== id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const members = await db.select().from(groupMembersTable).where(eq(groupMembersTable.userId, id));
  if (members.length === 0) {
    res.json([]);
    return;
  }
  const groups = await db
    .select()
    .from(groupsTable)
    .where(inArray(groupsTable.id, members.map((m) => m.groupId)));
  res.json(groups.map((g) => ({ id: g.id, name: g.name, description: g.description, createdAt: g.createdAt, memberCount: 0 })));
});

export default router;
