import { Router } from "express";
import { createRequire } from "node:module";
import { db } from "@workspace/db";
import {
  articlesTable,
  articleGroupsTable,
  articleLinksTable,
  articleImagesTable,
  groupMembersTable,
  groupsTable,
  usersTable,
} from "@workspace/db";
import { eq, ilike, inArray, asc, desc, count, sql, and, or } from "drizzle-orm";
import { requireAuth, requireRole, optionalAuth } from "../lib/auth";
import { sanitizeArticleHtml } from "../lib/sanitize";
import { slugify, extractWikilinks } from "../lib/slugify";
import TurndownService from "turndown";

const _require = createRequire(import.meta.url);
const PDFDocument = _require("pdfkit") as typeof import("pdfkit");

const router = Router();

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

async function getArticleGroups(articleId: number) {
  const ag = await db.select().from(articleGroupsTable).where(eq(articleGroupsTable.articleId, articleId));
  if (ag.length === 0) return [];
  const groups = await db.select().from(groupsTable).where(inArray(groupsTable.id, ag.map((x) => x.groupId)));
  return groups.map((g) => ({ id: g.id, name: g.name, description: g.description }));
}

async function getUserGroupIds(userId: number | undefined): Promise<number[]> {
  if (!userId) return [];
  const rows = await db.select({ groupId: groupMembersTable.groupId }).from(groupMembersTable).where(eq(groupMembersTable.userId, userId));
  return rows.map((r) => r.groupId);
}

function canAccessArticle(articleGroupIds: number[], userGroupIds: number[], userRole: string | undefined): boolean {
  if (articleGroupIds.length === 0) return true;
  if (userRole === "admin") return true;
  return articleGroupIds.some((gid) => userGroupIds.includes(gid));
}

router.get("/articles", optionalAuth, async (req, res) => {
  const { search, sort = "title", order = "asc", limit = 50, offset = 0 } = req.query;
  const userId = req.session.userId;
  const userRole = req.session.userRole;
  const userGroupIds = await getUserGroupIds(userId);

  let query = db
    .select({
      id: articlesTable.id,
      slug: articlesTable.slug,
      title: articlesTable.title,
      updatedAt: articlesTable.updatedAt,
      createdAt: articlesTable.createdAt,
      updatedById: articlesTable.updatedById,
      updatedByName: usersTable.name,
    })
    .from(articlesTable)
    .leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id))
    .$dynamic();

  if (search && typeof search === "string") {
    query = query.where(
      or(
        ilike(articlesTable.title, `%${search}%`),
        ilike(articlesTable.content, `%${search}%`),
      )
    );
  }

  const sortCol = sort === "updated_at" ? articlesTable.updatedAt : sort === "created_at" ? articlesTable.createdAt : articlesTable.title;
  query = query.orderBy(order === "desc" ? desc(sortCol) : asc(sortCol));
  query = query.limit(Number(limit)).offset(Number(offset));

  const articles = await query;

  const allGroups = await db.select().from(articleGroupsTable);
  const groupDetails = await db.select().from(groupsTable);
  const groupMap = new Map(groupDetails.map((g) => [g.id, g]));

  let totalQuery = db.select({ count: count() }).from(articlesTable).$dynamic();
  if (search && typeof search === "string") {
    totalQuery = totalQuery.where(
      or(
        ilike(articlesTable.title, `%${search}%`),
        ilike(articlesTable.content, `%${search}%`),
      )
    );
  }
  const total = await totalQuery;

  const result = articles.map((a) => {
    const articleGroupIds = allGroups.filter((ag) => ag.articleId === a.id).map((ag) => ag.groupId);
    const isRestricted = articleGroupIds.length > 0;
    const canAccess = canAccessArticle(articleGroupIds, userGroupIds, userRole);
    const groups = articleGroupIds
      .map((gid) => groupMap.get(gid))
      .filter(Boolean)
      .map((g) => ({ id: g!.id, name: g!.name, description: g!.description }));
    return {
      id: a.id,
      slug: a.slug,
      title: a.title,
      updatedAt: a.updatedAt,
      createdAt: a.createdAt,
      updatedByName: a.updatedByName ?? null,
      isRestricted,
      canAccess,
      groups,
    };
  });

  res.json({ articles: result, total: Number(total[0].count) });
});

router.get("/articles/stats", requireAuth, async (req, res) => {
  const [totalArticlesRow] = await db.select({ count: count() }).from(articlesTable);
  const [totalUsersRow] = await db.select({ count: count() }).from(usersTable);
  const [totalGroupsRow] = await db.select({ count: count() }).from(groupsTable);
  const restrictedIds = await db.select({ articleId: articleGroupsTable.articleId }).from(articleGroupsTable).groupBy(articleGroupsTable.articleId);

  const recentlyUpdated = await db
    .select({ id: articlesTable.id, slug: articlesTable.slug, title: articlesTable.title, updatedAt: articlesTable.updatedAt, createdAt: articlesTable.createdAt, updatedByName: usersTable.name })
    .from(articlesTable)
    .leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id))
    .orderBy(desc(articlesTable.updatedAt))
    .limit(5);

  const oldestUpdated = await db
    .select({ id: articlesTable.id, slug: articlesTable.slug, title: articlesTable.title, updatedAt: articlesTable.updatedAt, createdAt: articlesTable.createdAt, updatedByName: usersTable.name })
    .from(articlesTable)
    .leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id))
    .orderBy(asc(articlesTable.updatedAt))
    .limit(5);

  const mapArticle = (a: typeof recentlyUpdated[0]) => ({
    id: a.id, slug: a.slug, title: a.title, updatedAt: a.updatedAt, createdAt: a.createdAt,
    updatedByName: a.updatedByName ?? null, isRestricted: false, canAccess: true, groups: [],
  });

  res.json({
    totalArticles: Number(totalArticlesRow.count),
    restrictedArticles: restrictedIds.length,
    totalGroups: Number(totalGroupsRow.count),
    totalUsers: Number(totalUsersRow.count),
    recentlyUpdated: recentlyUpdated.map(mapArticle),
    oldestUpdated: oldestUpdated.map(mapArticle),
  });
});

router.get("/articles/maintenance", requireAuth, requireRole("admin"), async (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  const articles = await db
    .select({ id: articlesTable.id, slug: articlesTable.slug, title: articlesTable.title, updatedAt: articlesTable.updatedAt, createdAt: articlesTable.createdAt, updatedByName: usersTable.name })
    .from(articlesTable)
    .leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id))
    .orderBy(asc(articlesTable.updatedAt))
    .limit(Number(limit))
    .offset(Number(offset));

  const [total] = await db.select({ count: count() }).from(articlesTable);

  const allGroups = await db.select().from(articleGroupsTable);
  const groupDetails = await db.select().from(groupsTable);
  const groupMap = new Map(groupDetails.map((g) => [g.id, g]));

  const result = articles.map((a) => {
    const articleGroupIds = allGroups.filter((ag) => ag.articleId === a.id).map((ag) => ag.groupId);
    const groups = articleGroupIds.map((gid) => groupMap.get(gid)).filter(Boolean).map((g) => ({ id: g!.id, name: g!.name, description: g!.description }));
    return { id: a.id, slug: a.slug, title: a.title, updatedAt: a.updatedAt, createdAt: a.createdAt, updatedByName: a.updatedByName ?? null, isRestricted: articleGroupIds.length > 0, canAccess: true, groups };
  });

  res.json({ articles: result, total: Number(total.count) });
});

router.post("/articles", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  const { title, content, groupIds } = req.body;
  if (!title) {
    res.status(400).json({ error: "Title required" });
    return;
  }
  let slug = slugify(title);
  const existing = await db.select({ id: articlesTable.id }).from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (existing.length > 0) {
    slug = `${slug}-${Date.now()}`;
  }

  const sanitizedContent = sanitizeArticleHtml(content ?? "");
  const [article] = await db
    .insert(articlesTable)
    .values({ slug, title, content: sanitizedContent, updatedById: req.session.userId ?? null })
    .returning();

  if (groupIds && Array.isArray(groupIds) && groupIds.length > 0) {
    await db.insert(articleGroupsTable).values(groupIds.map((gid: number) => ({ articleId: article.id, groupId: gid })));
  }

  const wikilinks = extractWikilinks(content ?? "");
  if (wikilinks.length > 0) {
    await db.insert(articleLinksTable).values(wikilinks.map((s) => ({ fromArticleId: article.id, toSlug: slugify(s) }))).onConflictDoNothing();
  }

  // Associate any images embedded in this article's content with the article record
  const imgIds = [...(content ?? "").matchAll(/\/api\/articles\/images\/(\d+)/g)].map((m) => parseInt(m[1])).filter((n) => !isNaN(n));
  if (imgIds.length > 0) {
    await db.update(articleImagesTable).set({ articleId: article.id }).where(inArray(articleImagesTable.id, imgIds));
  }

  const groups = await getArticleGroups(article.id);
  res.status(201).json({ id: article.id, slug: article.slug, title: article.title, content: article.content, updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: req.session.userName ?? null, isRestricted: groups.length > 0, canAccess: true, groups, backlinks: [] });
});

router.get("/articles/:slug", optionalAuth, async (req, res) => {
  const slug = String(req.params.slug);
  const [article] = await db
    .select({ id: articlesTable.id, slug: articlesTable.slug, title: articlesTable.title, content: articlesTable.content, updatedAt: articlesTable.updatedAt, createdAt: articlesTable.createdAt, updatedById: articlesTable.updatedById, updatedByName: usersTable.name })
    .from(articlesTable)
    .leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id))
    .where(eq(articlesTable.slug, slug))
    .limit(1);

  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  const userId = req.session.userId;
  const userRole = req.session.userRole;
  const userGroupIds = await getUserGroupIds(userId);
  const groups = await getArticleGroups(article.id);
  const articleGroupIds = groups.map((g) => g.id);
  const isRestricted = articleGroupIds.length > 0;
  // Unauthenticated users cannot read article content regardless of group restrictions
  const canAccess = userId ? canAccessArticle(articleGroupIds, userGroupIds, userRole) : false;

  if (!canAccess) {
    res.json({ id: article.id, slug: article.slug, title: article.title, content: "", updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: article.updatedByName ?? null, isRestricted, canAccess: false, groups, backlinks: [] });
    return;
  }

  const backlinkRows = await db
    .select({ fromArticleId: articleLinksTable.fromArticleId })
    .from(articleLinksTable)
    .where(eq(articleLinksTable.toSlug, slug));
  let backlinks: { id: number; slug: string; title: string; updatedAt: Date; createdAt: Date; updatedByName: string | null; isRestricted: boolean; canAccess: boolean; groups: { id: number; name: string; description: string | null }[] }[] = [];
  if (backlinkRows.length > 0) {
    const fromIds = [...new Set(backlinkRows.map((b) => b.fromArticleId))];
    const fromArticles = await db.select({ id: articlesTable.id, slug: articlesTable.slug, title: articlesTable.title, updatedAt: articlesTable.updatedAt, createdAt: articlesTable.createdAt, updatedByName: usersTable.name }).from(articlesTable).leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id)).where(inArray(articlesTable.id, fromIds));
    backlinks = await Promise.all(fromArticles.map(async (a) => {
      const bGroups = await getArticleGroups(a.id);
      const bGroupIds = bGroups.map((g) => g.id);
      const bIsRestricted = bGroupIds.length > 0;
      const bCanAccess = canAccessArticle(bGroupIds, userGroupIds, userRole);
      return { id: a.id, slug: a.slug, title: a.title, updatedAt: a.updatedAt, createdAt: a.createdAt, updatedByName: a.updatedByName ?? null, isRestricted: bIsRestricted, canAccess: bCanAccess, groups: bCanAccess ? bGroups : [] };
    }));
  }

  res.json({ id: article.id, slug: article.slug, title: article.title, content: article.content, updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: article.updatedByName ?? null, isRestricted, canAccess: true, groups, backlinks });
});

router.patch("/articles/:slug", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  const slug = String(req.params.slug);
  const { title, content, groupIds } = req.body;
  const [existing] = await db.select().from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  const updates: Record<string, unknown> = { updatedAt: new Date(), updatedById: req.session.userId ?? null };
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = sanitizeArticleHtml(content);
  const [article] = await db.update(articlesTable).set(updates).where(eq(articlesTable.slug, slug)).returning();

  if (groupIds !== undefined && Array.isArray(groupIds)) {
    await db.delete(articleGroupsTable).where(eq(articleGroupsTable.articleId, article.id));
    if (groupIds.length > 0) {
      await db.insert(articleGroupsTable).values(groupIds.map((gid: number) => ({ articleId: article.id, groupId: gid })));
    }
  }

  if (content !== undefined) {
    await db.delete(articleLinksTable).where(eq(articleLinksTable.fromArticleId, article.id));
    const wikilinks = extractWikilinks(content);
    if (wikilinks.length > 0) {
      await db.insert(articleLinksTable).values(wikilinks.map((s) => ({ fromArticleId: article.id, toSlug: slugify(s) }))).onConflictDoNothing();
    }

    // Re-associate any images embedded in the updated content with this article
    const imgIds = [...content.matchAll(/\/api\/articles\/images\/(\d+)/g)].map((m) => parseInt(m[1])).filter((n) => !isNaN(n));
    if (imgIds.length > 0) {
      await db.update(articleImagesTable).set({ articleId: article.id }).where(inArray(articleImagesTable.id, imgIds));
    }
  }

  const groups = await getArticleGroups(article.id);
  res.json({ id: article.id, slug: article.slug, title: article.title, content: article.content, updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: req.session.userName ?? null, isRestricted: groups.length > 0, canAccess: true, groups, backlinks: [] });
});

router.delete("/articles/:slug", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  const slug = String(req.params.slug);
  const [existing] = await db.select().from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  await db.delete(articlesTable).where(eq(articlesTable.slug, slug));
  res.json({ message: "Article deleted" });
});

router.get("/articles/:slug/backlinks", optionalAuth, async (req, res) => {
  const slug = String(req.params.slug);
  const [article] = await db.select({ id: articlesTable.id }).from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  const backlinkRows = await db
    .select({ fromArticleId: articleLinksTable.fromArticleId })
    .from(articleLinksTable)
    .where(eq(articleLinksTable.toSlug, slug));
  if (backlinkRows.length === 0) {
    res.json([]);
    return;
  }
  const fromIds = [...new Set(backlinkRows.map((b) => b.fromArticleId))];
  const fromArticles = await db
    .select({ id: articlesTable.id, slug: articlesTable.slug, title: articlesTable.title, updatedAt: articlesTable.updatedAt, createdAt: articlesTable.createdAt, updatedByName: usersTable.name })
    .from(articlesTable)
    .leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id))
    .where(inArray(articlesTable.id, fromIds));

  const userId = req.session.userId;
  const userRole = req.session.userRole;
  const userGroupIds = await getUserGroupIds(userId);

  const backlinkResult = await Promise.all(fromArticles.map(async (a) => {
    const bGroups = await getArticleGroups(a.id);
    const bGroupIds = bGroups.map((g) => g.id);
    const bIsRestricted = bGroupIds.length > 0;
    const bCanAccess = canAccessArticle(bGroupIds, userGroupIds, userRole);
    return { id: a.id, slug: a.slug, title: a.title, updatedAt: a.updatedAt, createdAt: a.createdAt, updatedByName: a.updatedByName ?? null, isRestricted: bIsRestricted, canAccess: bCanAccess, groups: bCanAccess ? bGroups : [] };
  }));
  res.json(backlinkResult);
});

router.put("/articles/:slug/groups", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  const { groupIds } = req.body;
  const slug = String(req.params.slug);
  const [article] = await db.select().from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  await db.delete(articleGroupsTable).where(eq(articleGroupsTable.articleId, article.id));
  if (Array.isArray(groupIds) && groupIds.length > 0) {
    await db.insert(articleGroupsTable).values(groupIds.map((gid: number) => ({ articleId: article.id, groupId: gid })));
  }
  const groups = await getArticleGroups(article.id);
  res.json({ id: article.id, slug: article.slug, title: article.title, content: article.content, updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: null, isRestricted: groups.length > 0, canAccess: true, groups, backlinks: [] });
});

router.get("/articles/:slug/export/md", requireAuth, async (req, res) => {
  const slug = String(req.params.slug);
  const userId = req.session.userId;
  const userRole = req.session.userRole;
  const userGroupIds = await getUserGroupIds(userId);
  const [article] = await db.select().from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  const groups = await getArticleGroups(article.id);
  if (!canAccessArticle(groups.map((g) => g.id), userGroupIds, userRole)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const markdown = `# ${article.title}\n\n${turndown.turndown(article.content)}`;
  res.setHeader("Content-Type", "text/markdown");
  res.setHeader("Content-Disposition", `attachment; filename="${slug}.md"`);
  res.send(markdown);
});

router.get("/articles/:slug/export/pdf", requireAuth, async (req, res) => {
  const slug = String(req.params.slug);
  const userId = req.session.userId;
  const userRole = req.session.userRole;
  const userGroupIds = await getUserGroupIds(userId);
  const [article] = await db.select().from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  const groups = await getArticleGroups(article.id);
  if (!canAccessArticle(groups.map((g) => g.id), userGroupIds, userRole)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const doc = new PDFDocument({ margin: 60, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${slug}.pdf"`);
  doc.pipe(res);

  // Title
  doc.fontSize(24).font("Helvetica-Bold").fillColor("#1a1a1a").text(article.title, { align: "left" });
  doc.moveDown(0.5);
  doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor("#cccccc").stroke();
  doc.moveDown(1);

  // Body — convert HTML to plain text via Markdown
  const markdown = turndown.turndown(article.content || "");
  doc.fontSize(11).font("Helvetica").fillColor("#333333").text(markdown, {
    align: "left",
    lineGap: 4,
  });

  doc.moveDown(3);
  doc
    .fontSize(9)
    .fillColor("#888888")
    .text(`Exported from Knowledge Base — ${new Date().toLocaleDateString()}`, { align: "right" });

  doc.end();
});

export default router;
