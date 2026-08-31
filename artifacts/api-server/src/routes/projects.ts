import { Router } from "express";
import {
  db,
  projectsTable,
  projectGroupsTable,
  boardsTable,
  boardColumnsTable,
  boardCardsTable,
  boardCardMembersTable,
  boardCardCommentsTable,
  articlesTable,
  articleLinksTable,
  articleVersionsTable,
  articleTagsTable,
  tagsTable,
  groupsTable,
  groupMembersTable,
  usersTable,
  siteSettingsTable,
} from "@workspace/db";
import { eq, and, inArray, asc, desc, count, max, or, sql, isNull, isNotNull } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { sanitizeArticleHtml } from "../lib/sanitize";
import { slugify, extractWikilinks } from "../lib/slugify";
import { ArticleImageAttachmentError, attachReferencedArticleImages } from "../lib/article-images";

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

function canEditProjectDocument(
  access: { canAccess: boolean; isOwner: boolean },
  userRole: string | undefined,
): boolean {
  return access.canAccess && (access.isOwner || userRole === "editor");
}

async function getProjectDocumentTags(articleId: number) {
  const rows = await db
    .select({ id: tagsTable.id, name: tagsTable.name, color: tagsTable.color, createdAt: tagsTable.createdAt })
    .from(articleTagsTable)
    .innerJoin(tagsTable, eq(articleTagsTable.tagId, tagsTable.id))
    .where(eq(articleTagsTable.articleId, articleId));
  return rows.map((tag) => ({ ...tag, articleCount: 0 }));
}

function projectDocumentResponse(
  article: typeof articlesTable.$inferSelect,
  tags: Awaited<ReturnType<typeof getProjectDocumentTags>>,
  canEdit: boolean,
) {
  return {
    id: article.id,
    slug: article.slug,
    projectId: article.projectId,
    title: article.title,
    visibility: article.visibility,
    ownerId: article.createdById,
    content: article.content,
    updatedAt: article.updatedAt,
    createdAt: article.createdAt,
    updatedByName: null,
    isRestricted: true,
    canAccess: true,
    canEdit,
    groups: [],
    tags,
    backlinks: [],
  };
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
  return getProjectIdForBoard(col.boardId);
}

async function getProjectIdForCard(cardId: number): Promise<number | null> {
  const [card] = await db
    .select({ columnId: boardCardsTable.columnId })
    .from(boardCardsTable)
    .where(eq(boardCardsTable.id, cardId))
    .limit(1);
  return getProjectIdForColumn(card.columnId);
}

// Safety cap: return at most this many projects per request.
const PROJECTS_CAP = 100;

router.get("/projects", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const userRole = req.session.userRole;
  const showArchived = req.query.archived === "true";

  let accessibleIds: number[];
  if (userRole === "admin") {
    const rawRows = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(showArchived ? isNotNull(projectsTable.archivedAt) : isNull(projectsTable.archivedAt))
      .orderBy(desc(projectsTable.updatedAt), asc(projectsTable.id))
      .limit(PROJECTS_CAP + 1);
    accessibleIds = rawRows.map((r) => r.id);
  } else {
    // Single access-filtered query: owned OR group-shared projects, globally
    const userGroupIds = await getUserGroupIds(userId);
    const groupAccessClause = userGroupIds.length > 0
      ? sql`EXISTS (
          SELECT 1 FROM project_groups pg
          WHERE pg.project_id = ${projectsTable.id}
          AND pg.group_id IN ${sql.raw("(" + userGroupIds.join(",") + ")")}
        )`
      : sql`false`;
    const accessFilter = or(eq(projectsTable.createdById, userId), groupAccessClause)!;
    // No DISTINCT needed: the correlated EXISTS cannot produce duplicate project rows,
    const rawRows = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(accessFilter, showArchived ? isNotNull(projectsTable.archivedAt) : isNull(projectsTable.archivedAt)))
      .orderBy(desc(projectsTable.updatedAt), asc(projectsTable.id))
      .limit(PROJECTS_CAP + 1);
    accessibleIds = rawRows.map((r) => r.id);
  }

  const truncated = accessibleIds.length > PROJECTS_CAP;
  if (truncated) accessibleIds = accessibleIds.slice(0, PROJECTS_CAP);

  if (accessibleIds.length === 0) { res.json({ projects: [], truncated: false }); return; }

  const [projects, boardCounts] = await Promise.all([
    db.select().from(projectsTable)
      .where(inArray(projectsTable.id, accessibleIds))
      .orderBy(desc(projectsTable.updatedAt), asc(projectsTable.id)),
    db.select({ projectId: boardsTable.projectId, count: count() })
      .from(boardsTable)
      .where(and(inArray(boardsTable.projectId, accessibleIds), isNull(boardsTable.archivedAt)))
      .groupBy(boardsTable.projectId),
  ]);

  res.json({
    truncated,
    projects: projects.map((p) => ({
      ...p,
      boardCount: Number(boardCounts.find((bc) => bc.projectId === p.id)?.count ?? 0),
    })),
  });
});

router.post("/projects", requireAuth, async (req, res) => {
  const { name, description } = req.body as { name?: string; description?: string };
  if (!name?.trim()) { res.status(400).json({ error: "Name is required" }); return; }
  const [project] = await db
    .insert(projectsTable)
    .values({ name: name.trim(), description: description?.trim() ?? "", createdById: req.session.userId! })
    .returning();
  res.status(201).json(project);
});

router.get("/projects/:projectId", requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId);
  const { canAccess, isOwner, project } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }

  const [boards, projectGroupRows] = await Promise.all([
    // Return all boards (active + archived); the frontend separates them
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
  const { name, description, archived } = req.body as { name?: string; description?: string; archived?: boolean };
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name.trim();
  if (description !== undefined) updates.description = description.trim();
  if (archived !== undefined) updates.archivedAt = archived ? new Date() : null;
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

// ─── Project Documents ───────────────────────────────────────────────────────

router.get("/projects/:projectId/documents", requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId);
  const access = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!access.project) { res.status(404).json({ error: "Project not found" }); return; }
  if (!access.canAccess) { res.status(403).json({ error: "Access denied" }); return; }

  const documents = await db
    .select({
      id: articlesTable.id,
      slug: articlesTable.slug,
      projectId: articlesTable.projectId,
      title: articlesTable.title,
      visibility: articlesTable.visibility,
      ownerId: articlesTable.createdById,
      updatedAt: articlesTable.updatedAt,
      createdAt: articlesTable.createdAt,
      updatedByName: usersTable.name,
    })
    .from(articlesTable)
    .leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id))
    .where(and(eq(articlesTable.projectId, projectId), eq(articlesTable.isLogEntry, false)))
    .orderBy(desc(articlesTable.updatedAt), desc(articlesTable.id));

  res.json({
    documents: documents.map((document) => ({
      ...document,
      isRestricted: true,
      canAccess: true,
      canEdit: canEditProjectDocument(access, req.session.userRole),
    })),
  });
});

router.get("/projects/:projectId/documents/:slug", requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId);
  const access = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!access.project) { res.status(404).json({ error: "Project not found" }); return; }
  if (!access.canAccess) { res.status(403).json({ error: "Access denied" }); return; }

  const [document] = await db
    .select()
    .from(articlesTable)
    .where(and(
      eq(articlesTable.projectId, projectId),
      eq(articlesTable.slug, String(req.params.slug)),
      eq(articlesTable.isLogEntry, false),
    ))
    .limit(1);
  if (!document) { res.status(404).json({ error: "Document not found" }); return; }

  const tags = await getProjectDocumentTags(document.id);
  res.json(projectDocumentResponse(document, tags, canEditProjectDocument(access, req.session.userRole)));
});

router.post("/projects/:projectId/documents", requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId);
  const access = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!access.project) { res.status(404).json({ error: "Project not found" }); return; }
  if (!canEditProjectDocument(access, req.session.userRole)) {
    res.status(403).json({ error: "Only the project owner, an administrator, or an editor can create documents" });
    return;
  }

  const { title, content, tagIds } = req.body as { title?: string; content?: string; tagIds?: unknown };
  const trimmedTitle = title?.trim();
  if (!trimmedTitle) { res.status(400).json({ error: "Title required" }); return; }
  const slug = slugify(trimmedTitle);
  if (!slug) { res.status(400).json({ error: "Title must contain at least one letter or number" }); return; }

  const existing = await db.select({ id: articlesTable.id }).from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "An article already uses this URL. Choose a more specific title." });
    return;
  }

  const sanitizedContent = sanitizeArticleHtml(content ?? "");
  const article = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(824199)`);
    const [slugConflict] = await tx.select({ id: articlesTable.id }).from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
    if (slugConflict) return null;

    const [created] = await tx.insert(articlesTable).values({
      slug,
      title: trimmedTitle,
      content: sanitizedContent,
      isLogEntry: false,
      projectId,
      createdById: req.session.userId!,
      updatedById: req.session.userId!,
    }).returning();

    await attachReferencedArticleImages(
      tx,
      content ?? "",
      created.id,
      req.session.userId,
      req.session.userRole,
    );

    const wikilinks = extractWikilinks(content ?? "");
    if (wikilinks.length > 0) {
      await tx.insert(articleLinksTable)
        .values(wikilinks.map((target) => ({ fromArticleId: created.id, toSlug: slugify(target) })))
        .onConflictDoNothing();
    }

    await tx.insert(articleVersionsTable).values({
      articleId: created.id,
      versionNumber: 1,
      title: created.title,
      content: created.content,
      createdById: req.session.userId!,
    });
    return created;
  }).catch((error: unknown) => {
    if (error instanceof ArticleImageAttachmentError) {
      res.status(error.status).json({ error: error.message });
      return undefined;
    }
    throw error;
  });

  if (article === undefined) return;
  if (!article) { res.status(409).json({ error: "Could not reserve a unique document URL. Please try again." }); return; }
  if (Array.isArray(tagIds)) {
    const numericTagIds = tagIds.filter((id): id is number => typeof id === "number");
    if (numericTagIds.length > 0) {
      await db.insert(articleTagsTable)
        .values(numericTagIds.map((tagId) => ({ articleId: article.id, tagId })))
        .onConflictDoNothing();
    }
  }

  const tags = await getProjectDocumentTags(article.id);
  res.status(201).json(projectDocumentResponse(article, tags, true));
});

router.patch("/projects/:projectId/documents/:slug", requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId);
  const access = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!access.project) { res.status(404).json({ error: "Project not found" }); return; }
  if (!canEditProjectDocument(access, req.session.userRole)) {
    res.status(403).json({ error: "Only the project owner, an administrator, or an editor can edit documents" });
    return;
  }

  const [existing] = await db
    .select()
    .from(articlesTable)
    .where(and(eq(articlesTable.projectId, projectId), eq(articlesTable.slug, String(req.params.slug)), eq(articlesTable.isLogEntry, false)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Document not found" }); return; }

  const { title, content, tagIds } = req.body as { title?: string; content?: string; tagIds?: unknown };
  const nextTitle = title === undefined ? existing.title : title.trim();
  if (!nextTitle) { res.status(400).json({ error: "Title required" }); return; }

  const updates: Record<string, unknown> = {
    title: nextTitle,
    updatedAt: new Date(),
    updatedById: req.session.userId!,
  };
  if (content !== undefined) updates.content = sanitizeArticleHtml(content);

  let article;
  try {
    article = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(824199)`);
      if (content !== undefined) {
        await attachReferencedArticleImages(
          tx,
          content,
          existing.id,
          req.session.userId,
          req.session.userRole,
        );
      }
      const [updated] = await tx.update(articlesTable).set(updates).where(eq(articlesTable.id, existing.id)).returning();
      if (!updated) return null;

      if (content !== undefined) {
        await tx.delete(articleLinksTable).where(eq(articleLinksTable.fromArticleId, updated.id));
        const wikilinks = extractWikilinks(content);
        if (wikilinks.length > 0) {
          await tx.insert(articleLinksTable)
            .values(wikilinks.map((target) => ({ fromArticleId: updated.id, toSlug: slugify(target) })))
            .onConflictDoNothing();
        }
      }

      const [versionCount] = await tx.select({ value: count() }).from(articleVersionsTable).where(eq(articleVersionsTable.articleId, updated.id));
      await tx.insert(articleVersionsTable).values({
        articleId: updated.id,
        versionNumber: Number(versionCount?.value ?? 0) + 1,
        title: updated.title,
        content: updated.content,
        createdById: req.session.userId!,
      });
      return updated;
    });
  } catch (error) {
    if (error instanceof ArticleImageAttachmentError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }
  if (!article) { res.status(409).json({ error: "Could not save this document. Reload and try again." }); return; }

  if (Array.isArray(tagIds)) {
    await db.delete(articleTagsTable).where(eq(articleTagsTable.articleId, article.id));
    const numericTagIds = tagIds.filter((id): id is number => typeof id === "number");
    if (numericTagIds.length > 0) {
      await db.insert(articleTagsTable).values(numericTagIds.map((tagId) => ({ articleId: article.id, tagId }))).onConflictDoNothing();
    }
  }

  const tags = await getProjectDocumentTags(article.id);
  res.json(projectDocumentResponse(article, tags, true));
});

router.delete("/projects/:projectId/documents/:slug", requireAuth, async (req, res) => {
  const projectId = Number(req.params.projectId);
  const access = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!access.project) { res.status(404).json({ error: "Project not found" }); return; }
  if (!canEditProjectDocument(access, req.session.userRole)) {
    res.status(403).json({ error: "Only the project owner, an administrator, or an editor can delete documents" });
    return;
  }

  const deleted = await db.delete(articlesTable).where(and(
    eq(articlesTable.projectId, projectId),
    eq(articlesTable.slug, String(req.params.slug)),
    eq(articlesTable.isLogEntry, false),
  )).returning({ id: articlesTable.id });
  if (deleted.length === 0) { res.status(404).json({ error: "Document not found" }); return; }
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

  const CARDS_CAP = 300;
  let cards: (typeof boardCardsTable.$inferSelect)[] = [];
  let members: { cardId: number; userId: number; name: string }[] = [];

  if (columns.length > 0) {
    const colIds = columns.map((c) => c.id);
    const fetched = await db
      .select()
      .from(boardCardsTable)
      .where(inArray(boardCardsTable.columnId, colIds))
      .orderBy(asc(boardCardsTable.id))
      .limit(CARDS_CAP + 1);
    const cardsTruncated = fetched.length > CARDS_CAP;
    cards = cardsTruncated ? fetched.slice(0, CARDS_CAP) : fetched;

    if (cards.length > 0) {
      const cardIds = cards.map((c) => c.id);
      members = await db
        .select({ cardId: boardCardMembersTable.cardId, userId: boardCardMembersTable.userId, name: usersTable.name })
        .from(boardCardMembersTable)
        .innerJoin(usersTable, eq(boardCardMembersTable.userId, usersTable.id))
        .where(inArray(boardCardMembersTable.cardId, cardIds));
    }

    const result = {
      ...board,
      projectId,
      cardsTruncated: fetched.length > CARDS_CAP,
      columns: columns.map((col) => ({
        ...col,
        cards: cards
          .filter((c) => c.columnId === col.id)
          .sort((a, b) => a.position - b.position || a.id - b.id)
          .map((card) => ({
            ...card,
            members: members.filter((m) => m.cardId === card.id).map((m) => ({ id: m.userId, name: m.name })),
          })),
      })),
    };
    res.json(result);
    return;
  }

  res.json({ ...board, projectId, cardsTruncated: false, columns: [] });
});

router.patch("/boards/:boardId", requireAuth, async (req, res) => {
  const boardId = Number(req.params.boardId);
  const projectId = await getProjectIdForBoard(boardId);
  if (!projectId) { res.status(404).json({ error: "Board not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  const { name, archived } = req.body as { name?: string; archived?: boolean };
  const updates: Record<string, unknown> = {};
  if (name !== undefined) {
    if (!name.trim()) { res.status(400).json({ error: "Name required" }); return; }
    updates.name = name.trim();
  }
  if (archived !== undefined) updates.archivedAt = archived ? new Date() : null;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
  const [updated] = await db.update(boardsTable).set(updates).where(eq(boardsTable.id, boardId)).returning();
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

  const boardColumns = await db
    .select({ id: boardColumnsTable.id })
    .from(boardColumnsTable)
    .where(eq(boardColumnsTable.boardId, boardId));
  const validColumnIds = new Set(boardColumns.map((c) => c.id));

  const submittedColumnIds = columns.map((c) => c.columnId);
  if (submittedColumnIds.some((id) => !validColumnIds.has(id))) {
    res.status(400).json({ error: "One or more columns do not belong to this board" });
    return;
  }

  const allSubmittedCardIds = columns.flatMap((c) => c.cardIds);
  if (allSubmittedCardIds.length > 0) {
    const validCards = await db
      .select({ id: boardCardsTable.id })
      .from(boardCardsTable)
      .where(inArray(boardCardsTable.columnId, [...validColumnIds]));
    const validCardIds = new Set(validCards.map((c) => c.id));

    if (allSubmittedCardIds.some((id) => !validCardIds.has(id))) {
      res.status(400).json({ error: "One or more cards do not belong to this board" });
      return;
    }
  }

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

// Reorder columns within a board
router.patch("/boards/:boardId/columns/reorder", requireAuth, async (req, res) => {
  const boardId = Number(req.params.boardId);
  const projectId = await getProjectIdForBoard(boardId);
  if (!projectId) { res.status(404).json({ error: "Board not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }

  const { columnIds } = req.body as { columnIds?: number[] };
  if (!Array.isArray(columnIds)) { res.status(400).json({ error: "columnIds array required" }); return; }

  // Validate all IDs belong to this board
  const boardColumns = await db
    .select({ id: boardColumnsTable.id })
    .from(boardColumnsTable)
    .where(eq(boardColumnsTable.boardId, boardId));
  const validIds = new Set(boardColumns.map((c) => c.id));
  if (columnIds.some((id) => !validIds.has(id))) {
    res.status(400).json({ error: "One or more columns do not belong to this board" });
    return;
  }

  await Promise.all(
    columnIds.map((columnId, idx) =>
      db.update(boardColumnsTable)
        .set({ position: (idx + 1) * 1000 })
        .where(eq(boardColumnsTable.id, columnId)),
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

// ─── Card Comments ────────────────────────────────────────────────────────────

router.get("/cards/:cardId/comments", requireAuth, async (req, res) => {
  const cardId = Number(req.params.cardId);
  const projectId = await getProjectIdForCard(cardId);
  if (!projectId) { res.status(404).json({ error: "Card not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  const comments = await db
    .select({
      id: boardCardCommentsTable.id,
      cardId: boardCardCommentsTable.cardId,
      userId: boardCardCommentsTable.userId,
      content: boardCardCommentsTable.content,
      createdAt: boardCardCommentsTable.createdAt,
      userName: usersTable.name,
    })
    .from(boardCardCommentsTable)
    .leftJoin(usersTable, eq(boardCardCommentsTable.userId, usersTable.id))
    .where(eq(boardCardCommentsTable.cardId, cardId))
    .orderBy(asc(boardCardCommentsTable.createdAt));
  res.json(comments);
});

router.post("/cards/:cardId/comments", requireAuth, async (req, res) => {
  const cardId = Number(req.params.cardId);
  const projectId = await getProjectIdForCard(cardId);
  if (!projectId) { res.status(404).json({ error: "Card not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  const { content } = req.body as { content?: string };
  if (!content?.trim()) { res.status(400).json({ error: "Content required" }); return; }
  const [comment] = await db
    .insert(boardCardCommentsTable)
    .values({ cardId, userId: req.session.userId!, content: content.trim() })
    .returning();
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.session.userId!)).limit(1);
  res.status(201).json({ ...comment, userName: user?.name ?? null });
});

router.delete("/cards/:cardId/comments/:commentId", requireAuth, async (req, res) => {
  const cardId = Number(req.params.cardId);
  const commentId = Number(req.params.commentId);
  const projectId = await getProjectIdForCard(cardId);
  if (!projectId) { res.status(404).json({ error: "Card not found" }); return; }
  const { canAccess } = await checkProjectAccess(projectId, req.session.userId, req.session.userRole);
  if (!canAccess) { res.status(403).json({ error: "Access denied" }); return; }
  const [comment] = await db.select().from(boardCardCommentsTable).where(eq(boardCardCommentsTable.id, commentId)).limit(1);
  if (!comment) { res.status(404).json({ error: "Comment not found" }); return; }
  if (comment.userId !== req.session.userId && req.session.userRole !== "admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  await db.delete(boardCardCommentsTable).where(eq(boardCardCommentsTable.id, commentId));
  res.status(204).send();
});

export default router;
