import { Router } from "express";
import { db } from "@workspace/db";
import {
  articlesTable,
  articleGroupsTable,
  articleLinksTable,
  groupMembersTable,
  groupsTable,
  usersTable,
} from "@workspace/db";
import { eq, ilike, inArray, asc, desc, count, sql, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth";
import { slugify, extractWikilinks } from "../lib/slugify";
import TurndownService from "turndown";

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
  if (userRole === "admin" || userRole === "editor") return true;
  return articleGroupIds.some((gid) => userGroupIds.includes(gid));
}

router.get("/articles", requireAuth, async (req, res) => {
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
    query = query.where(ilike(articlesTable.title, `%${search}%`));
  }

  const sortCol = sort === "updated_at" ? articlesTable.updatedAt : sort === "created_at" ? articlesTable.createdAt : articlesTable.title;
  query = query.orderBy(order === "desc" ? desc(sortCol) : asc(sortCol));
  query = query.limit(Number(limit)).offset(Number(offset));

  const articles = await query;

  const allGroups = await db.select().from(articleGroupsTable);
  const groupDetails = await db.select().from(groupsTable);
  const groupMap = new Map(groupDetails.map((g) => [g.id, g]));

  const total = await db.select({ count: count() }).from(articlesTable);

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

router.get("/articles/maintenance", requireAuth, async (req, res) => {
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

  const [article] = await db
    .insert(articlesTable)
    .values({ slug, title, content: content ?? "", updatedById: req.session.userId ?? null })
    .returning();

  if (groupIds && Array.isArray(groupIds) && groupIds.length > 0) {
    await db.insert(articleGroupsTable).values(groupIds.map((gid: number) => ({ articleId: article.id, groupId: gid })));
  }

  const wikilinks = extractWikilinks(content ?? "");
  if (wikilinks.length > 0) {
    await db.insert(articleLinksTable).values(wikilinks.map((s) => ({ fromArticleId: article.id, toSlug: slugify(s) }))).onConflictDoNothing();
  }

  const groups = await getArticleGroups(article.id);
  res.status(201).json({ id: article.id, slug: article.slug, title: article.title, content: article.content, updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: req.session.userName ?? null, isRestricted: groups.length > 0, canAccess: true, groups, backlinks: [] });
});

router.get("/articles/:slug", requireAuth, async (req, res) => {
  const slug = req.params.slug;
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
  const canAccess = canAccessArticle(articleGroupIds, userGroupIds, userRole);

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
    backlinks = fromArticles.map((a) => ({ id: a.id, slug: a.slug, title: a.title, updatedAt: a.updatedAt, createdAt: a.createdAt, updatedByName: a.updatedByName ?? null, isRestricted: false, canAccess: true, groups: [] }));
  }

  res.json({ id: article.id, slug: article.slug, title: article.title, content: article.content, updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: article.updatedByName ?? null, isRestricted, canAccess: true, groups, backlinks });
});

router.patch("/articles/:slug", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  const slug = req.params.slug;
  const { title, content, groupIds } = req.body;
  const [existing] = await db.select().from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  const updates: Record<string, unknown> = { updatedAt: new Date(), updatedById: req.session.userId ?? null };
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
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
  }

  const groups = await getArticleGroups(article.id);
  res.json({ id: article.id, slug: article.slug, title: article.title, content: article.content, updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: req.session.userName ?? null, isRestricted: groups.length > 0, canAccess: true, groups, backlinks: [] });
});

router.delete("/articles/:slug", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  const [existing] = await db.select().from(articlesTable).where(eq(articlesTable.slug, req.params.slug)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  await db.delete(articlesTable).where(eq(articlesTable.slug, req.params.slug));
  res.json({ message: "Article deleted" });
});

router.get("/articles/:slug/backlinks", requireAuth, async (req, res) => {
  const slug = req.params.slug;
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
  res.json(fromArticles.map((a) => ({ id: a.id, slug: a.slug, title: a.title, updatedAt: a.updatedAt, createdAt: a.createdAt, updatedByName: a.updatedByName ?? null, isRestricted: false, canAccess: true, groups: [] })));
});

router.put("/articles/:slug/groups", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  const { groupIds } = req.body;
  const [article] = await db.select().from(articlesTable).where(eq(articlesTable.slug, req.params.slug)).limit(1);
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
  const slug = req.params.slug;
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
  const slug = req.params.slug;
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
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${article.title}</title>
<style>
  body { font-family: Georgia, serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.7; color: #1a1a1a; }
  h1 { font-size: 2em; border-bottom: 2px solid #333; padding-bottom: 0.3em; }
  h2, h3 { margin-top: 1.5em; }
  code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
  pre { background: #f4f4f4; padding: 1em; border-radius: 5px; overflow-x: auto; }
  img { max-width: 100%; }
  blockquote { border-left: 4px solid #ccc; margin: 0; padding-left: 1em; color: #666; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>${article.title}</h1>
${article.content}
<hr style="margin-top:3em">
<p style="font-size:0.8em;color:#888">Exported from Knowledge Base — ${new Date().toLocaleDateString()}</p>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

export default router;
