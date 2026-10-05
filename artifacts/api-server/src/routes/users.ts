import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, groupsTable, groupMembersTable, passwordResetTokensTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { CreateUserBody, UpdateUserBody } from "@workspace/api-zod";
import { SSO_ONLY_PASSWORD_HASH, SSO_ONLY_PASSWORD_MESSAGE } from "../lib/login-mode";

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
      ssoOnly: u.ssoOnly,
      createdAt: u.createdAt,
      groups: userGroups,
    };
  });
  res.json(result);
});

router.post("/users", requireAuth, requireRole("admin"), async (req, res) => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide a valid email, name, role, SSO Only option, and a password of at least 8 characters when using password sign-in." });
    return;
  }
  const { email, name, password, role, ssoOnly = false } = parsed.data;
  if (!name.trim() || (!ssoOnly && !password) || (ssoOnly && password !== undefined)) {
    res.status(400).json({ error: ssoOnly ? "Do not supply a local password for an SSO-only account." : "Name and a password of at least 8 characters are required." });
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
  const passwordHash = ssoOnly ? SSO_ONLY_PASSWORD_HASH : await bcrypt.hash(password!, 12);
  const [user] = await db
    .insert(usersTable)
    .values({ email: email.toLowerCase(), name: name.trim(), passwordHash, role, ssoOnly })
    .returning();
  res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role, ssoOnly: user.ssoOnly, createdAt: user.createdAt, groups: [] });
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
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, ssoOnly: user.ssoOnly, createdAt: user.createdAt, groups: userGroups });
});

router.patch("/users/:id", requireAuth, requireRole("admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Invalid user id" }); return; }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success || (parsed.data.name !== undefined && !parsed.data.name.trim())) {
    res.status(400).json({ error: "Provide valid user fields; a new password must have at least 8 characters." });
    return;
  }
  const { email, name, role, password, ssoOnly } = parsed.data;
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(usersTable).where(eq(usersTable.id, id)).for("update");
    if (!existing) return { status: 404, error: "User not found" } as const;
    const nextSsoOnly = ssoOnly ?? existing.ssoOnly;
    if (nextSsoOnly && password !== undefined) return { status: 400, error: SSO_ONLY_PASSWORD_MESSAGE } as const;
    if (existing.ssoOnly && !nextSsoOnly && !password) {
      return { status: 400, error: "Supply a new password of at least 8 characters when disabling SSO Only." } as const;
    }
    const updates: Partial<typeof usersTable.$inferInsert> = { updatedAt: new Date() };
    if (email !== undefined) updates.email = email.toLowerCase();
    if (name !== undefined) updates.name = name.trim();
    if (role !== undefined) updates.role = role;
    if (ssoOnly !== undefined) updates.ssoOnly = ssoOnly;
    if (nextSsoOnly) {
      updates.passwordHash = SSO_ONLY_PASSWORD_HASH;
      updates.mustResetPassword = false;
      await tx.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, id));
    } else if (password !== undefined) {
      updates.passwordHash = await bcrypt.hash(password, 12);
      updates.mustResetPassword = false;
    }
    const [user] = await tx.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
    return { user } as const;
  });
  if (result.status !== undefined) { res.status(result.status).json({ error: result.error }); return; }
  const { user } = result;
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, ssoOnly: user.ssoOnly, createdAt: user.createdAt, groups: [] });
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
