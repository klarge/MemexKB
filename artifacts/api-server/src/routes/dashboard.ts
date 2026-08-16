import { Router } from "express";
import {
  db,
  taskListsTable,
  tasksTable,
  projectsTable,
  projectGroupsTable,
  boardsTable,
  boardColumnsTable,
  boardCardsTable,
  boardCardMembersTable,
  groupMembersTable,
  siteSettingsTable,
} from "@workspace/db";
import { eq, and, inArray, asc, isNull, isNotNull } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();

async function isFeatureEnabled(key: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.key, key))
    .limit(1);
  return row?.value !== "false";
}

async function getUserGroupIds(userId: number): Promise<number[]> {
  const rows = await db
    .select({ groupId: groupMembersTable.groupId })
    .from(groupMembersTable)
    .where(eq(groupMembersTable.userId, userId));
  return rows.map((r) => r.groupId);
}

// GET /api/dashboard — active tasks + upcoming project cards for the current user
router.get("/dashboard", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const userRole = req.session.userRole;

  const [tasksEnabled, projectsEnabled] = await Promise.all([
    isFeatureEnabled("tasks_enabled"),
    isFeatureEnabled("projects_enabled"),
  ]);

  // ── Active (incomplete) personal tasks ──────────────────────────────────────
  let activeTasks: {
    id: number;
    title: string;
    listId: number;
    listName: string;
  }[] = [];

  if (tasksEnabled || userRole === "admin") {
    activeTasks = await db
      .select({
        id: tasksTable.id,
        title: tasksTable.title,
        listId: tasksTable.listId,
        listName: taskListsTable.name,
      })
      .from(tasksTable)
      .innerJoin(taskListsTable, eq(tasksTable.listId, taskListsTable.id))
      .where(and(eq(tasksTable.userId, userId), isNull(tasksTable.completedAt)))
      .orderBy(asc(tasksTable.position), asc(tasksTable.createdAt))
      .limit(10);
  }

  // ── Project cards with due dates assigned to this user ─────────────────────
  let upcomingCards: {
    id: number;
    title: string;
    dueDate: Date | null;
    boardId: number;
    boardName: string;
    projectId: number;
    projectName: string;
    columnName: string;
  }[] = [];

  if (projectsEnabled || userRole === "admin") {
    // Resolve projects the user can access
    const [ownedRows, userGroupIds] = await Promise.all([
      db
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .where(eq(projectsTable.createdById, userId)),
      getUserGroupIds(userId),
    ]);

    const ownedIds = ownedRows.map((r) => r.id);

    let groupProjectIds: number[] = [];
    if (userGroupIds.length > 0) {
      const gp = await db
        .select({ projectId: projectGroupsTable.projectId })
        .from(projectGroupsTable)
        .where(inArray(projectGroupsTable.groupId, userGroupIds));
      groupProjectIds = gp.map((r) => r.projectId);
    }

    const accessibleProjectIds = [...new Set([...ownedIds, ...groupProjectIds])];

    if (accessibleProjectIds.length > 0) {
      upcomingCards = await db
        .select({
          id: boardCardsTable.id,
          title: boardCardsTable.title,
          dueDate: boardCardsTable.dueDate,
          boardId: boardsTable.id,
          boardName: boardsTable.name,
          projectId: projectsTable.id,
          projectName: projectsTable.name,
          columnName: boardColumnsTable.name,
        })
        .from(boardCardMembersTable)
        .innerJoin(boardCardsTable, eq(boardCardMembersTable.cardId, boardCardsTable.id))
        .innerJoin(boardColumnsTable, eq(boardCardsTable.columnId, boardColumnsTable.id))
        .innerJoin(boardsTable, eq(boardColumnsTable.boardId, boardsTable.id))
        .innerJoin(projectsTable, eq(boardsTable.projectId, projectsTable.id))
        .where(
          and(
            eq(boardCardMembersTable.userId, userId),
            isNotNull(boardCardsTable.dueDate),
            inArray(boardsTable.projectId, accessibleProjectIds),
          ),
        )
        .orderBy(asc(boardCardsTable.dueDate))
        .limit(10);
    }
  }

  res.json({ activeTasks, upcomingCards });
});

export default router;
