import { Router } from "express";
import {
  db,
  projectsTable,
  projectGroupsTable,
  boardsTable,
  boardColumnsTable,
  boardCardsTable,
  boardCardMembersTable,
  groupsTable,
  groupMembersTable,
  usersTable,
  siteSettingsTable,
} from "@workspace/db";
import { eq, and, inArray, asc, desc, count, max } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();

// Feature flag — admins always bypass; others blocked if projects_enabled = "false"
router.use(async (req, res, next) => {
  if (!req.session?.userId) { next(); return; }
  if (req.session.userRole === "admin") { next(); return; }
  const [row] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, "projects_enabled")).limit(1);
  if (row?.value === "false") {
    res.status(403).json({ error: "Projects feature is disabled" });
    return;
  }
  next();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getUserGroupIds(userId: number | undefined): Promise<number[]> {
  if (!userId) return [];
  const rows = await db
    .select({ groupId: groupMembersTable.groupId })
    .from(groupMembersTable)
    .where(eq(groupMembersTable.userId, userId));
  return rows.map((r) => r.groupId);
}

async function checkProjectAccess(
  projectId: number,
  userId: number | undefined,
  userRole: string | undefined,
): Promise<{ canAccess: boolean; isOwner: boolean; project: (typeof projectsTable.$inferSelect) | null }> {
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) return { canAccess: false, isOwner: false, project: null };
  if (!userId) return { canAccess: false, isOwner: false, project };
  const isOwner = project.createdById === userId || userRole === "admin";
  if (isOwner) return { canAccess: true, isOwner, project };
  const userGroupIds = await getUserGroupIds(userId);
  if (userGroupIds.length > 0) {
    const pg = await db
      .select()
      .from(projectGroupsTable)
      .where(and(eq(projectGroupsTable.projectId, projectId), inArray(projectGroupsTable.groupId, userGroupIds)))
      .limit(1);
    if (pg.length > 0) return { canAccess: true, isOwner: false, project };
  }
  return { canAccess: false, isOwner: false, project };
}

async function getProjectIdForBoard(boardId: number): Promise<number | null> {
  const [b] = await db.select({ projectId: boardsTable.projectId }).from(boardsTable).where(eq(boardsTable.id, boardId)).limit(1);
  return b?.projectId ?? null;
}

async function getProjectIdForColumn(columnId: number): Promise<number | null> {
  const [col] = await db
    .select({ boardId: boardColumnsTable.boardId })
    .from(boardColumnsTable)
    .where(eq(boardColumnsTable.id, columnId))
    .limit(1);
  if (!col) return null;
  return getProjectIdForBoard(col.boardId);
}

async function getProjectIdForCard(cardId: number): Promise<number | null> {
  const [card] = await db
    .select({ columnId: boardCardsTable.columnId })
    .from(boardCardsTable)
    .where(eq(boardCardsTable.id, cardId))
    .limit(1);
  if (!card) return null;
  return getProjectIdForColumn(card.columnId);
}

// ─── Projects ─────────────────────────────────────────────────────────────────

router.get("/projects", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const userRole = req.session.userRole;

  let accessibleIds: number[];
  if (userRole === "admin") {
    const all = await db.select({ id: projectsTable.id }).from(projectsTable);
    accessibleIds = all.map((p) => p.id);
  } else {
    const own = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.createdById, userId));
    const userGroupIds = await getUserGroupIds(userId);
    let groupProjectIds: number[] = [];
    if (userGroupIds.length > 0) {
      const pgRows = await db.select({ projectId: projectGroupsTable.projectId }).from(projectGroupsTable).where(inArray(projectGroupsTable.groupId, userGroupIds));
      groupProjectIds = pgRows.map((r) => r.projectId);
    }
    accessibleIds = [...new Set([...own.map((p) => p.id), ...groupProjectIds])];
  }

  if (accessibleIds.length === 0) { res.json([]); return; }

  const projects = await db
    .select()
    .from(projectsTable)
    .where(inArray(projectsTable.id, accessibleIds))
    .orderBy(desc(projectsTable.updatedAt));

  const boardCounts = await db
    .select({ projectId: boardsTable.projectId, count: count() })
    .from(boardsTable)
    .where(inArray(boardsTable.projectId, accessibleIds))
    .groupBy(boardsTable.projectId);

  res.json(
    projects.map((p) => ({
      ...p,
      boardCount: Number(boardCounts.find((bc) => bc.projectId === p.id)?.count ?? 0),
    })),
  );
});

router.post("/projects", requireAuth, async (req, res) => {
  const { name, description = "" } = req.body as { name?: string; description?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
  const [project] = await db
    .insert(projectsTable)
    .values({ name: name.trim(), description: description.trim(), createdById: req.session.userId! })
    .returning();
  res.status(201).json(project);
});

router.get("/projects/:projectId", requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId);
  const { canAccess, isOwner, project } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }

  const [boards, projectGroupRows] = await Promise.all([
    db.select().from(boardsTable).where(eq(boardsTable.projectId, projectId)).orderBy(asc(boardsTable.position)),
    db.select({ groupId: projectGroupsTable.groupId }).from(projectGroupsTable).where(eq(projectGroupsTable.projectId, projectId)),
  ]);

  let groups: { id: number; name: string }[] = [];
  if (projectGroupRows.length > 0) {
    groups = await db
      .select({ id: groupsTable.id, name: groupsTable.name })
      .from(groupsTable)
      .where(inArray(groupsTable.id, projectGroupRows.map((r) => r.groupId)));
  }

  res.json({ ...project, boards, groups, isOwner });
});

router.patch("/projects/:projectId", requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId);
  const { canAccess, isOwner } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  if (!isOwner) { res.status(403).json({ error: "Only the project owner can edit project settings" }); return; }
  const { name, description } = req.body as { name?: string; description?: string };
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name.trim();
  if (description !== undefined) updates.description = description.trim();
  const [updated] = await db.update(projectsTable).set(updates).where(eq(projectsTable.id, projectId)).returning();
  res.json(updated);
});

router.delete("/projects/:projectId", requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId);
  const { canAccess, isOwner } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess || !isOwner) { res.status(403).json({ error: "Only the project owner can delete this project" }); return; }
  await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  res.status(204).send();
});

// ─── Project Members & Groups ─────────────────────────────────────────────────

router.get("/projects/:projectId/members", requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId);
  const { canAccess, project } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess || !project) { res.status(403).json({ error: "Access denied" }); return; }

  if (req.session.userRole === "admin") {
    const all = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).orderBy(asc(usersTable.name));
    res.json(all); return;
  }

  const memberMap = new Map<number, { id: number; name: string; email: string }>();
  if (project.createdById) {
    const [creator] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, project.createdById)).limit(1);
    if (creator) memberMap.set(creator.id, creator);
  }
  const pgRows = await db.select({ groupId: projectGroupsTable.groupId }).from(projectGroupsTable).where(eq(projectGroupsTable.projectId, projectId));
  if (pgRows.length > 0) {
    const gms = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(groupMembersTable)
      .innerJoin(usersTable, eq(groupMembersTable.userId, usersTable.id))
      .where(inArray(groupMembersTable.groupId, pgRows.map((r) => r.groupId)));
    for (const m of gms) memberMap.set(m.id, m);
  }
  res.json([...memberMap.values()].sort((a, b) => a.name.localeCompare(b.name)));
});

router.post("/projects/:projectId/groups", requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId);
  const { canAccess, isOwner } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess || !isOwner) { res.status(403).json({ error: "Only the project owner can share this project" }); return; }
  const { groupId } = req.body as { groupId?: number };
  if (!groupId) { res.status(400).json({ error: "groupId required" }); return; }
  await db.insert(projectGroupsTable).values({ projectId, groupId }).onConflictDoNothing();
  res.status(201).json({ projectId, groupId });
});

router.delete("/projects/:projectId/groups/:groupId", requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId);
  const groupId = Number(req.params.groupId);
  const { canAccess, isOwner } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess || !isOwner) { res.status(403).json({ error: "Access denied" }); return; }
  await db.delete(projectGroupsTable).where(and(eq(projectGroupsTable.projectId, projectId), eq(projectGroupsTable.groupId, groupId)));
  res.status(204).send();
});

// ─── Boards ───────────────────────────────────────────────────────────────────

router.post("/projects/:projectId/boards", requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId);
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
  const [maxRow] = await db.select({ pos: max(boardsTable.position) }).from(boardsTable).where(eq(boardsTable.projectId, projectId));
  const position = (Number(maxRow?.pos ?? 0)) + 1000;
  const [board] = await db.insert(boardsTable).values({ projectId, name: name.trim(), position }).returning();
  res.status(201).json(board);
});

router.get("/boards/:boardId", requireAuth, async (req, res) => {
  const boardId = Number(req.params.boardId);
  const projectId = await getProjectIdForBoard(boardId);
  if (!projectId) { res.status(404).json({ error: "Board not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }

  const [board] = await db.select().from(boardsTable).where(eq(boardsTable.id, boardId)).limit(1);
  const columns = await db.select().from(boardColumnsTable).where(eq(boardColumnsTable.boardId, boardId)).orderBy(asc(boardColumnsTable.position));

  let cards: (typeof boardCardsTable.$inferSelect)[] = [];
  let members: { cardId: number; userId: number; name: string }[] = [];

  if (columns.length > 0) {
    const colIds = columns.map((c) => c.id);
    cards = await db.select().from(boardCardsTable).where(inArray(boardCardsTable.columnId, colIds)).orderBy(asc(boardCardsTable.position));
    if (cards.length > 0) {
      const cardIds = cards.map((c) => c.id);
      members = await db
        .select({ cardId: boardCardMembersTable.cardId, userId: boardCardMembersTable.userId, name: usersTable.name })
        .from(boardCardMembersTable)
        .innerJoin(usersTable, eq(boardCardMembersTable.userId, usersTable.id))
        .where(inArray(boardCardMembersTable.cardId, cardIds));
    }
  }

  const result = {
    ...board,
    projectId,
    columns: columns.map((col) => ({
      ...col,
      cards: cards
        .filter((c) => c.columnId === col.id)
        .map((card) => ({
          ...card,
          members: members.filter((m) => m.cardId === card.id).map((m) => ({ id: m.userId, name: m.name })),
        })),
    })),
  };

  res.json(result);
});

router.patch("/boards/:boardId", requireAuth, async (req, res) => {
  const boardId = Number(req.params.boardId);
  const projectId = await getProjectIdForBoard(boardId);
  if (!projectId) { res.status(404).json({ error: "Board not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name required" }); return; }
  const [updated] = await db.update(boardsTable).set({ name: name.trim() }).where(eq(boardsTable.id, boardId)).returning();
  res.json(updated);
});

router.delete("/boards/:boardId", requireAuth, async (req, res) => {
  const boardId = Number(req.params.boardId);
  const projectId = await getProjectIdForBoard(boardId);
  if (!projectId) { res.status(404).json({ error: "Board not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  await db.delete(boardsTable).where(eq(boardsTable.id, boardId));
  res.status(204).send();
});

// Bulk reorder: cards across columns
router.patch("/boards/:boardId/cards/reorder", requireAuth, async (req, res) => {
  const boardId = Number(req.params.boardId);
  const projectId = await getProjectIdForBoard(boardId);
  if (!projectId) { res.status(404).json({ error: "Board not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }

  const { columns } = req.body as { columns: { columnId: number; cardIds: number[] }[] };
  if (!Array.isArray(columns)) { res.status(400).json({ error: "columns array required" }); return; }

  await Promise.all(
    columns.flatMap(({ columnId, cardIds }) =>
      cardIds.map((cardId, idx) =>
        db.update(boardCardsTable)
          .set({ columnId, position: (idx + 1) * 1000, updatedAt: new Date() })
          .where(eq(boardCardsTable.id, cardId)),
      ),
    ),
  );

  res.json({ ok: true });
});

// ─── Columns ──────────────────────────────────────────────────────────────────

router.post("/boards/:boardId/columns", requireAuth, async (req, res) => {
  const boardId = Number(req.params.boardId);
  const projectId = await getProjectIdForBoard(boardId);
  if (!projectId) { res.status(404).json({ error: "Board not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name required" }); return; }
  const [maxRow] = await db.select({ pos: max(boardColumnsTable.position) }).from(boardColumnsTable).where(eq(boardColumnsTable.boardId, boardId));
  const position = (Number(maxRow?.pos ?? 0)) + 1000;
  const [col] = await db.insert(boardColumnsTable).values({ boardId, name: name.trim(), position }).returning();
  res.status(201).json(col);
});

router.patch("/columns/:columnId", requireAuth, async (req, res) => {
  const columnId = Number(req.params.columnId);
  const projectId = await getProjectIdForColumn(columnId);
  if (!projectId) { res.status(404).json({ error: "Column not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name required" }); return; }
  const [updated] = await db.update(boardColumnsTable).set({ name: name.trim() }).where(eq(boardColumnsTable.id, columnId)).returning();
  res.json(updated);
});

router.delete("/columns/:columnId", requireAuth, async (req, res) => {
  const columnId = Number(req.params.columnId);
  const projectId = await getProjectIdForColumn(columnId);
  if (!projectId) { res.status(404).json({ error: "Column not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  await db.delete(boardColumnsTable).where(eq(boardColumnsTable.id, columnId));
  res.status(204).send();
});

// ─── Cards ────────────────────────────────────────────────────────────────────

router.post("/columns/:columnId/cards", requireAuth, async (req, res) => {
  const columnId = Number(req.params.columnId);
  const projectId = await getProjectIdForColumn(columnId);
  if (!projectId) { res.status(404).json({ error: "Column not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  const { title } = req.body as { title?: string };
  if (!title?.trim()) { res.status(400).json({ error: "Title required" }); return; }
  const [maxRow] = await db.select({ pos: max(boardCardsTable.position) }).from(boardCardsTable).where(eq(boardCardsTable.columnId, columnId));
  const position = (Number(maxRow?.pos ?? 0)) + 1000;
  const [card] = await db.insert(boardCardsTable).values({ columnId, title: title.trim(), position, createdById: req.session.userId! }).returning();
  res.status(201).json({ ...card, members: [] });
});

router.patch("/cards/:cardId", requireAuth, async (req, res) => {
  const cardId = Number(req.params.cardId);
  const projectId = await getProjectIdForCard(cardId);
  if (!projectId) { res.status(404).json({ error: "Card not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  const { title, description, dueDate } = req.body as { title?: string; description?: string; dueDate?: string | null };
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (title !== undefined) updates.title = title.trim();
  if (description !== undefined) updates.description = description;
  if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;
  const [updated] = await db.update(boardCardsTable).set(updates).where(eq(boardCardsTable.id, cardId)).returning();
  res.json(updated);
});

router.delete("/cards/:cardId", requireAuth, async (req, res) => {
  const cardId = Number(req.params.cardId);
  const projectId = await getProjectIdForCard(cardId);
  if (!projectId) { res.status(404).json({ error: "Card not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  await db.delete(boardCardsTable).where(eq(boardCardsTable.id, cardId));
  res.status(204).send();
});

router.post("/cards/:cardId/members", requireAuth, async (req, res) => {
  const cardId = Number(req.params.cardId);
  const projectId = await getProjectIdForCard(cardId);
  if (!projectId) { res.status(404).json({ error: "Card not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  const { userId } = req.body as { userId?: number };
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  await db.insert(boardCardMembersTable).values({ cardId, userId }).onConflictDoNothing();
  res.status(201).json({ cardId, userId });
});

router.delete("/cards/:cardId/members/:userId", requireAuth, async (req, res) => {
  const cardId = Number(req.params.cardId);
  const userId = Number(req.params.userId);
  const projectId = await getProjectIdForCard(cardId);
  if (!projectId) { res.status(404).json({ error: "Card not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  await db.delete(boardCardMembersTable).where(and(eq(boardCardMembersTable.cardId, cardId), eq(boardCardMembersTable.userId, userId)));
  res.status(204).send();
});

export default router;
