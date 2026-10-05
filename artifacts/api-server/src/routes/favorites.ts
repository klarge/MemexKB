import { Router } from "express";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, favoritesTable, articlesTable, projectsTable, groupMembersTable, projectGroupsTable, siteSettingsTable } from "@workspace/db";
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
  const projects = await projectsEnabled(role) ? await db.select({
    entityId: projectsTable.id, title: projectsTable.name, archivedAt: projectsTable.archivedAt,
    savedAt: favoritesTable.createdAt,
  }).from(favoritesTable).innerJoin(projectsTable, eq(favoritesTable.projectId, projectsTable.id))
    .where(and(eq(favoritesTable.userId, userId), role === "admin" ? undefined :
      or(eq(projectsTable.createdById, userId), eq(projectsTable.managerId, userId), groupAccess)))
    .orderBy(desc(favoritesTable.createdAt)) : [];
  const items = [
    ...articles.map(article => ({ ...article, entityType: "article", archived: false })),
    ...projects.map(project => ({ entityId: project.entityId, title: project.title, slug: null,
      kind: "project", entityType: "project", archived: !!project.archivedAt, savedAt: project.savedAt })),
  ].sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime() || a.entityType.localeCompare(b.entityType) || a.entityId - b.entityId);
  res.json({ items });
});

router.put("/favorites", requireAuth, async (req, res) => {
  const { entityType, entityId, favorite } = req.body ?? {};
  if (!["article", "project"].includes(entityType) || !Number.isSafeInteger(entityId) || entityId < 1 || entityId > 2_147_483_647 || typeof favorite !== "boolean") {
    res.status(400).json({ error: "A valid content type, ID, and favorite flag are required." }); return;
  }
  const userId = req.session.userId!;
  const target = entityType === "article" ? eq(favoritesTable.articleId, entityId) : eq(favoritesTable.projectId, entityId);
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
  } else if (!await projectsEnabled(req.session.userRole) ||
      !(await checkProjectAccess(entityId, userId, req.session.userRole)).canAccess) {
    res.status(404).json({ error: "Content not found." }); return;
  }
  await db.insert(favoritesTable).values({
    userId, articleId: entityType === "article" ? entityId : null,
    projectId: entityType === "project" ? entityId : null,
  }).onConflictDoNothing();
  res.status(204).send();
});

export default router;