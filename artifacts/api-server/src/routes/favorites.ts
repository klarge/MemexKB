import { Router } from "express";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, favoritesTable, articlesTable, projectsTable, boardsTable, groupMembersTable, projectGroupsTable, siteSettingsTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { canAccessArticleRecord, normalArticleVisibilityCondition } from "./articles";
import { checkProjectAccess } from "./projects";
import { isContentKind } from "../lib/content-kinds";

const router = Router();

async function projectsEnabled(role: string | undefined) {
  if (role === "admin") return true;
  const [setting] = await db.select().from(siteSettingsTable).where(eq(siteSettingsTable.key, "projects_enabled")).limit(1);
  return setting?.value !== "false";
}

router.get("/favorites", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const role = req.session.userRole;
  const groups = await db.select({ id: groupMembersTable.groupId }).from(groupMembersTable).where(eq(groupMembersTable.userId, userId));
  const articles = await db.select({
    entityId: articlesTable.id, title: articlesTable.title, slug: articlesTable.slug,
    kind: articlesTable.kind, savedAt: favoritesTable.createdAt,
  }).from(favoritesTable).innerJoin(articlesTable, eq(favoritesTable.articleId, articlesTable.id))
    .where(and(eq(favoritesTable.userId, userId), eq(articlesTable.isLogEntry, false),
      isNull(articlesTable.projectId), inArray(articlesTable.kind, ["knowledge", "policy", "procedure"]),
      normalArticleVisibilityCondition(userId, role, groups.map(group => group.id))));
  const groupAccess = sql`EXISTS (
    SELECT 1 FROM ${projectGroupsTable}
    INNER JOIN ${groupMembersTable} ON ${groupMembersTable.groupId} = ${projectGroupsTable.groupId}
    WHERE ${projectGroupsTable.projectId} = ${projectsTable.id} AND ${groupMembersTable.userId} = ${userId}
  )`;
  const showProjects = await projectsEnabled(role);
  const projectAccess = role === "admin" ? undefined :
    or(eq(projectsTable.createdById, userId), eq(projectsTable.managerId, userId), groupAccess);
  const projects = showProjects ? await db.select({
    entityId: projectsTable.id, title: projectsTable.name, archivedAt: projectsTable.archivedAt,
    savedAt: favoritesTable.createdAt,
  }).from(favoritesTable).innerJoin(projectsTable, eq(favoritesTable.projectId, projectsTable.id))
    .where(and(eq(favoritesTable.userId, userId), projectAccess))
    .orderBy(desc(favoritesTable.createdAt)) : [];
  const boards = showProjects ? await db.select({
    entityId: boardsTable.id, title: boardsTable.name,
    projectId: projectsTable.id, projectName: projectsTable.name,
    archivedAt: boardsTable.archivedAt, projectArchivedAt: projectsTable.archivedAt,
    savedAt: favoritesTable.createdAt,
  }).from(favoritesTable)
    .innerJoin(boardsTable, eq(favoritesTable.boardId, boardsTable.id))
    .innerJoin(projectsTable, eq(boardsTable.projectId, projectsTable.id))
    .where(and(eq(favoritesTable.userId, userId), projectAccess)) : [];
  const items = [
    ...articles.map(article => ({ ...article, entityType: "article", projectId: null, archived: false })),
    ...projects.map(project => ({ entityId: project.entityId, title: project.title, slug: null,
      kind: "project", entityType: "project", projectId: project.entityId, archived: !!project.archivedAt, savedAt: project.savedAt })),
    ...boards.map(board => ({ entityId: board.entityId, title: board.title, slug: null,
      kind: "board", entityType: "board", projectId: board.projectId, projectName: board.projectName,
      archived: !!(board.archivedAt || board.projectArchivedAt), savedAt: board.savedAt })),
  ].sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime() || a.entityType.localeCompare(b.entityType) || a.entityId - b.entityId);
  res.json({ items });
});

router.put("/favorites", requireAuth, async (req, res) => {
  const { entityType, entityId, favorite } = req.body ?? {};
  if (!["article", "project", "board"].includes(entityType) || !Number.isSafeInteger(entityId) || entityId < 1 || entityId > 2_147_483_647 || typeof favorite !== "boolean") {
    res.status(400).json({ error: "A valid content type, ID, and favorite flag are required." }); return;
  }
  const userId = req.session.userId!;
  const target = entityType === "article" ? eq(favoritesTable.articleId, entityId)
    : entityType === "board" ? eq(favoritesTable.boardId, entityId) : eq(favoritesTable.projectId, entityId);
  if (!favorite) {
    await db.delete(favoritesTable).where(and(eq(favoritesTable.userId, userId), target));
    res.status(204).send(); return;
  }
  if (entityType === "article") {
    const [article] = await db.select().from(articlesTable).where(eq(articlesTable.id, entityId)).limit(1);
    if (!article || article.isLogEntry || article.projectId || !isContentKind(article.kind) ||
        !await canAccessArticleRecord(article, userId, req.session.userRole)) {
      res.status(404).json({ error: "Content not found." }); return;
    }
  } else if (entityType === "board") {
    const [board] = await db.select({ projectId: boardsTable.projectId }).from(boardsTable).where(eq(boardsTable.id, entityId)).limit(1);
    if (!board || !await projectsEnabled(req.session.userRole) ||
        !(await checkProjectAccess(board.projectId, userId, req.session.userRole)).canAccess) {
      res.status(404).json({ error: "Content not found." }); return;
    }
  } else if (!await projectsEnabled(req.session.userRole) ||
      !(await checkProjectAccess(entityId, userId, req.session.userRole)).canAccess) {
    res.status(404).json({ error: "Content not found." }); return;
  }
  await db.insert(favoritesTable).values({
    userId, articleId: entityType === "article" ? entityId : null,
    projectId: entityType === "project" ? entityId : null,
    boardId: entityType === "board" ? entityId : null,
  }).onConflictDoNothing();
  res.status(204).send();
});

export default router;