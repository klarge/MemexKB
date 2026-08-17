import { Router } from "express";
import { createRequire } from "node:module";
import { db } from "@workspace/db";
import {
  articlesTable,
  articleGroupsTable,
  articleLinksTable,
  articleImagesTable,
  articleVersionsTable,
  articleTagsTable,
  tagsTable,
  groupMembersTable,
  groupsTable,
  usersTable,
  editLocksTable,
  siteSettingsTable,
  tasksTable,
  taskListsTable,
  boardCardsTable,
  boardColumnsTable,
  boardsTable,
  projectsTable,
  projectGroupsTable,
} from "@workspace/db";
import { eq, ilike, inArray, asc, desc, count, sql, and, or, ne } from "drizzle-orm";
import { requireAuth, requireRole, optionalAuth } from "../lib/auth";
import { sanitizeArticleHtml } from "../lib/sanitize";
import { slugify, extractWikilinks } from "../lib/slugify";
import TurndownService from "turndown";

const _require = createRequire(import.meta.url);
const PDFDocument = _require("pdfkit") as typeof import("pdfkit");

const router = Router();

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

// ─── PDF infobox helpers ──────────────────────────────────────────────────────

interface PdfInfoboxData {
  title: string;
  rows: Array<{ label: string; value: string }>;
  image: string; // /api/articles/images/N, data URL, or ""
}

function parsePdfInfobox(htmlFragment: string): PdfInfoboxData {
  // Title: prefer data-title attribute (new format), fall back to <caption> (legacy)
  const dataTitleMatch = htmlFragment.match(/data-title=["']([^"']*)["']/i);
  const captionMatch = htmlFragment.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
  const title = dataTitleMatch?.[1] ?? (captionMatch ? captionMatch[1].replace(/<[^>]+>/g, "").trim() : "");

  // Image: prefer data-image attribute (new format), fall back to first <img src> (legacy)
  const dataImageMatch = htmlFragment.match(/data-image=["']([^"']+)["']/i);
  const legacyImgMatch = htmlFragment.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  const image = dataImageMatch?.[1] ?? legacyImgMatch?.[1] ?? "";

  const rows: PdfInfoboxData["rows"] = [];
  const rowRe = /<tr[^>]*>[\s\S]*?<th[^>]*>([\s\S]*?)<\/th>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(htmlFragment)) !== null) {
    const label = m[1].replace(/<[^>]+>/g, "").trim();
    const value = m[2].replace(/<[^>]+>/g, "").trim();
    if (label || value) rows.push({ label, value });
  }
  return { title, rows, image };
}

/** Read natural pixel dimensions from a PNG or JPEG buffer (returns null if unrecognised). */
function readImageDimensions(buf: Buffer, mime: string): { w: number; h: number } | null {
  try {
    if (mime === "image/png" && buf.length >= 24) {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      return { w, h };
    }
    if (mime === "image/jpeg") {
      let i = 2; // skip SOI marker (FF D8)
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1];
        const segLen = buf.readUInt16BE(i + 2);
        // SOF markers: C0, C1, C2, C3, C5..C7, C9..CB, CD..CF
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
          const h = buf.readUInt16BE(i + 5);
          const w = buf.readUInt16BE(i + 7);
          return { w, h };
        }
        i += 2 + segLen;
      }
    }
  } catch { /* ignore */ }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawPdfInfobox(
  doc: any,
  infobox: PdfInfoboxData,
  pageLeft: number,
  usableWidth: number,
  imageBuffer?: Buffer | null,
  imageMimeType?: string,
) {
  const BOX_W = 180;
  const BOX_X = pageLeft + usableWidth - BOX_W;
  const PAD = 5;
  const FS = 8.5;
  const TITLE_H = 22;
  const ROW_H = 20;
  const LABEL_W = Math.round(BOX_W * 0.42);
  const VALUE_W = BOX_W - LABEL_W;
  let curY: number = doc.y;

  // Title bar
  doc.rect(BOX_X, curY, BOX_W, TITLE_H).fillAndStroke("#2d6a4f", "#1b4332");
  doc
    .fillColor("#ffffff").fontSize(FS + 0.5).font("Helvetica-Bold")
    .text(infobox.title || "Info", BOX_X + PAD, curY + 6, {
      width: BOX_W - PAD * 2, align: "center", lineBreak: false,
    });
  curY += TITLE_H;

  // Image zone (if present)
  if (imageBuffer && (imageMimeType === "image/jpeg" || imageMimeType === "image/png")) {
    const MAX_IMG_H = 140;
    const dims = readImageDimensions(imageBuffer, imageMimeType);
    // Scale to fit BOX_W while preserving aspect ratio, capped at MAX_IMG_H
    let renderH = MAX_IMG_H;
    if (dims && dims.w > 0) {
      const scaleW = Math.min(1, BOX_W / dims.w);
      renderH = Math.min(MAX_IMG_H, Math.round(dims.h * scaleW));
    }
    try {
      doc.image(imageBuffer, BOX_X, curY, { fit: [BOX_W, renderH] });
    } catch { /* skip unembeddable image */ }
    curY += renderH;
    // thin separator line below image
    doc.moveTo(BOX_X, curY).lineTo(BOX_X + BOX_W, curY).strokeColor("#dee2e6").lineWidth(0.5).stroke();
  }

  // Data rows
  infobox.rows.forEach((row, i) => {
    const bg = i % 2 === 0 ? "#f8f9fa" : "#ffffff";
    doc.rect(BOX_X, curY, LABEL_W, ROW_H).fillAndStroke("#e9ecef", "#dee2e6");
    doc.rect(BOX_X + LABEL_W, curY, VALUE_W, ROW_H).fillAndStroke(bg, "#dee2e6");
    doc
      .fillColor("#212529").fontSize(FS).font("Helvetica-Bold")
      .text(row.label, BOX_X + PAD, curY + 6, {
        width: LABEL_W - PAD * 2, align: "left", lineBreak: false,
      });
    doc
      .fillColor("#212529").fontSize(FS).font("Helvetica")
      .text(row.value, BOX_X + LABEL_W + PAD, curY + 6, {
        width: VALUE_W - PAD * 2, align: "left", lineBreak: false,
      });
    curY += ROW_H;
  });

  doc.y = curY + 8;
}

async function getArticleGroups(articleId: number) {
  const ag = await db.select().from(articleGroupsTable).where(eq(articleGroupsTable.articleId, articleId));
  if (ag.length === 0) return [];
  const groups = await db.select().from(groupsTable).where(inArray(groupsTable.id, ag.map((x) => x.groupId)));
  return groups.map((g) => ({ id: g.id, name: g.name, description: g.description }));
}

async function getArticleTags(articleId: number) {
  const at = await db.select().from(articleTagsTable).where(eq(articleTagsTable.articleId, articleId));
  if (at.length === 0) return [];
  const tags = await db.select().from(tagsTable).where(inArray(tagsTable.id, at.map((x) => x.tagId)));
  return tags.map((t) => ({ id: t.id, name: t.name, color: t.color, createdAt: t.createdAt, articleCount: 0 }));
}

async function setArticleTags(articleId: number, tagIds: number[]) {
  await db.delete(articleTagsTable).where(eq(articleTagsTable.articleId, articleId));
  if (tagIds.length > 0) {
    await db.insert(articleTagsTable).values(tagIds.map((tid) => ({ articleId, tagId: tid }))).onConflictDoNothing();
  }
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
  const { search, sort = "title", order = "asc", limit = 50, offset = 0, tagId } = req.query;
  const userId = req.session.userId;
  const userRole = req.session.userRole;
  const userGroupIds = await getUserGroupIds(userId);

  const tagIdNum = tagId ? parseInt(String(tagId), 10) : null;

  // When filtering by tag, fetch matching article IDs first
  let tagFilterIds: number[] | null = null;
  if (tagIdNum && !isNaN(tagIdNum)) {
    const rows = await db
      .select({ articleId: articleTagsTable.articleId })
      .from(articleTagsTable)
      .where(eq(articleTagsTable.tagId, tagIdNum));
    tagFilterIds = rows.map((r) => r.articleId);
    if (tagFilterIds.length === 0) {
      res.json({ articles: [], total: 0 });
      return;
    }
  }

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

  // Always exclude log entries from the regular article list
  const conditions = [ne(articlesTable.isLogEntry, true)];
  if (search && typeof search === "string") {
    conditions.push(
      or(
        ilike(articlesTable.title, `%${search}%`),
        ilike(articlesTable.content, `%${search}%`),
      )!,
    );
  }
  if (tagFilterIds !== null) {
    conditions.push(inArray(articlesTable.id, tagFilterIds));
  }
  query = query.where(and(...conditions));

  const sortCol = sort === "updated_at" ? articlesTable.updatedAt : sort === "created_at" ? articlesTable.createdAt : articlesTable.title;
  query = query.orderBy(order === "desc" ? desc(sortCol) : asc(sortCol));
  query = query.limit(Number(limit)).offset(Number(offset));

  const articles = await query;

  const allGroups = await db.select().from(articleGroupsTable);
  const groupDetails = await db.select().from(groupsTable);
  const groupMap = new Map(groupDetails.map((g) => [g.id, g]));

  const allArticleTags = await db.select().from(articleTagsTable);
  const allTagDetails = await db.select().from(tagsTable);
  const tagMap = new Map(allTagDetails.map((t) => [t.id, t]));

  let totalQuery = db.select({ count: count() }).from(articlesTable).$dynamic();
  totalQuery = totalQuery.where(and(...conditions));
  const total = await totalQuery;

  const result = articles.map((a) => {
    const articleGroupIds = allGroups.filter((ag) => ag.articleId === a.id).map((ag) => ag.groupId);
    const isRestricted = articleGroupIds.length > 0;
    const canAccess = canAccessArticle(articleGroupIds, userGroupIds, userRole);
    const groups = articleGroupIds
      .map((gid) => groupMap.get(gid))
      .filter(Boolean)
      .map((g) => ({ id: g!.id, name: g!.name, description: g!.description }));
    const tags = allArticleTags
      .filter((at) => at.articleId === a.id)
      .map((at) => tagMap.get(at.tagId))
      .filter(Boolean)
      .map((t) => ({ id: t!.id, name: t!.name, color: t!.color, createdAt: t!.createdAt, articleCount: 0 }));
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
      tags,
    };
  });

  res.json({ articles: result, total: Number(total[0].count) });
});

router.get("/articles/stats", requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const userRole = req.session.userRole;
  const userGroupIds = await getUserGroupIds(userId);

  // Exclude log entries from all stats
  const notLogEntry = ne(articlesTable.isLogEntry, true);

  const [[totalArticlesRow], [totalUsersRow], [totalGroupsRow], restrictedIds] = await Promise.all([
    db.select({ count: count() }).from(articlesTable).where(notLogEntry),
    db.select({ count: count() }).from(usersTable),
    db.select({ count: count() }).from(groupsTable),
    db.select({ articleId: articleGroupsTable.articleId }).from(articleGroupsTable).groupBy(articleGroupsTable.articleId),
  ]);

  // Fetch more rows than needed so group filtering still yields 5 results
  const fetchAndFilter = async (orderFn: typeof desc) => {
    const rows = await db
      .select({ id: articlesTable.id, slug: articlesTable.slug, title: articlesTable.title, updatedAt: articlesTable.updatedAt, createdAt: articlesTable.createdAt, updatedByName: usersTable.name })
      .from(articlesTable)
      .leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id))
      .where(notLogEntry)
      .orderBy(orderFn(articlesTable.updatedAt))
      .limit(30);

    if (rows.length === 0) return [];

    const groupRows = await db
      .select()
      .from(articleGroupsTable)
      .where(inArray(articleGroupsTable.articleId, rows.map((r) => r.id)));

    return rows
      .filter((a) => {
        const articleGroupIds = groupRows.filter((ag) => ag.articleId === a.id).map((ag) => ag.groupId);
        return canAccessArticle(articleGroupIds, userGroupIds, userRole);
      })
      .slice(0, 5)
      .map((a) => ({
        id: a.id, slug: a.slug, title: a.title, updatedAt: a.updatedAt, createdAt: a.createdAt,
        updatedByName: a.updatedByName ?? null, isRestricted: false, canAccess: true, groups: [],
      }));
  };

  const [recentlyUpdated, oldestUpdated] = await Promise.all([
    fetchAndFilter(desc),
    fetchAndFilter(asc),
  ]);

  res.json({
    totalArticles: Number(totalArticlesRow.count),
    restrictedArticles: restrictedIds.length,
    totalGroups: Number(totalGroupsRow.count),
    totalUsers: Number(totalUsersRow.count),
    recentlyUpdated,
    oldestUpdated,
  });
});

router.post("/articles", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  const { title, content, groupIds, tagIds, isLogEntry } = req.body;
  if (!title) {
    res.status(400).json({ error: "Title required" });
    return;
  }
  let slug = slugify(title);
  const existing = await db.select({ id: articlesTable.id }).from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (existing.length > 0) {
    slug = `${slug}-${Date.now()}`;
  }

  if (isLogEntry && !(await isLogEntriesEnabled())) {
    res.status(403).json({ error: "Log entries feature is not enabled" });
    return;
  }

  const sanitizedContent = sanitizeArticleHtml(content ?? "");
  const [article] = await db
    .insert(articlesTable)
    .values({ slug, title, content: sanitizedContent, isLogEntry: Boolean(isLogEntry), createdById: req.session.userId ?? null, updatedById: req.session.userId ?? null })
    .returning();

  if (groupIds && Array.isArray(groupIds) && groupIds.length > 0) {
    await db.insert(articleGroupsTable).values(groupIds.map((gid: number) => ({ articleId: article.id, groupId: gid })));
  }

  if (tagIds && Array.isArray(tagIds) && tagIds.length > 0) {
    await db.insert(articleTagsTable).values(tagIds.map((tid: number) => ({ articleId: article.id, tagId: tid }))).onConflictDoNothing();
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

  // Snapshot initial version
  await db.insert(articleVersionsTable).values({
    articleId: article.id,
    versionNumber: 1,
    title: article.title,
    content: article.content,
    createdById: req.session.userId ?? null,
  });

  const groups = await getArticleGroups(article.id);
  const tags = await getArticleTags(article.id);
  res.status(201).json({ id: article.id, slug: article.slug, title: article.title, content: article.content, updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: req.session.userName ?? null, isRestricted: groups.length > 0, canAccess: true, groups, tags, backlinks: [] });
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

  const tags = await getArticleTags(article.id);

  if (!canAccess) {
    res.json({ id: article.id, slug: article.slug, title: article.title, content: "", updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: article.updatedByName ?? null, isRestricted, canAccess: false, groups, tags, backlinks: [] });
    return;
  }

  const backlinkRows = await db
    .select({ fromArticleId: articleLinksTable.fromArticleId })
    .from(articleLinksTable)
    .where(eq(articleLinksTable.toSlug, slug));
  let backlinks: { id: number; slug: string; title: string; updatedAt: Date; createdAt: Date; updatedByName: string | null; isRestricted: boolean; canAccess: boolean; groups: { id: number; name: string; description: string | null }[]; tags: { id: number; name: string; color: string; createdAt: Date; articleCount: number }[] }[] = [];
  if (backlinkRows.length > 0) {
    const fromIds = [...new Set(backlinkRows.map((b) => b.fromArticleId))];
    const fromArticles = await db.select({ id: articlesTable.id, slug: articlesTable.slug, title: articlesTable.title, updatedAt: articlesTable.updatedAt, createdAt: articlesTable.createdAt, updatedByName: usersTable.name }).from(articlesTable).leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id)).where(inArray(articlesTable.id, fromIds));
    backlinks = await Promise.all(fromArticles.map(async (a) => {
      const bGroups = await getArticleGroups(a.id);
      const bGroupIds = bGroups.map((g) => g.id);
      const bIsRestricted = bGroupIds.length > 0;
      const bCanAccess = canAccessArticle(bGroupIds, userGroupIds, userRole);
      const bTags = await getArticleTags(a.id);
      return { id: a.id, slug: a.slug, title: a.title, updatedAt: a.updatedAt, createdAt: a.createdAt, updatedByName: a.updatedByName ?? null, isRestricted: bIsRestricted, canAccess: bCanAccess, groups: bCanAccess ? bGroups : [], tags: bTags };
    }));
  }

  res.json({ id: article.id, slug: article.slug, title: article.title, content: article.content, updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: article.updatedByName ?? null, isRestricted, canAccess: true, groups, tags, backlinks });
});

router.patch("/articles/:slug", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  const slug = String(req.params.slug);
  const { title, content, groupIds, tagIds } = req.body;
  const [existing] = await db.select().from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  // Log entries can only be edited by their creator or an admin
  if (existing.isLogEntry && req.session.userRole !== "admin" && existing.createdById !== req.session.userId) {
    res.status(403).json({ error: "You can only edit your own log entries" });
    return;
  }

  // Editors must be members of at least one group the article belongs to (admins bypass)
  const articleGroups = await getArticleGroups(existing.id);
  const articleGroupIds = articleGroups.map((g) => g.id);
  const userGroupIds = await getUserGroupIds(req.session.userId);
  if (!canAccessArticle(articleGroupIds, userGroupIds, req.session.userRole)) {
    res.status(403).json({ error: "You do not have permission to edit this article" });
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

  if (tagIds !== undefined && Array.isArray(tagIds)) {
    await setArticleTags(article.id, tagIds);
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

  // Snapshot new version
  const [versionCount] = await db
    .select({ c: count() })
    .from(articleVersionsTable)
    .where(eq(articleVersionsTable.articleId, article.id));
  const nextVersionNumber = Number(versionCount?.c ?? 0) + 1;
  await db.insert(articleVersionsTable).values({
    articleId: article.id,
    versionNumber: nextVersionNumber,
    title: article.title,
    content: article.content,
    createdById: req.session.userId ?? null,
  });

  const groups = await getArticleGroups(article.id);
  const tags = await getArticleTags(article.id);
  res.json({ id: article.id, slug: article.slug, title: article.title, content: article.content, updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: req.session.userName ?? null, isRestricted: groups.length > 0, canAccess: true, groups, tags, backlinks: [] });
});

// ─── Log Entries ─────────────────────────────────────────────────────────────

async function isLogEntriesEnabled(): Promise<boolean> {
  const [row] = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.key, "log_entries_enabled"))
    .limit(1);
  return row?.value !== "false";
}

router.get("/log", requireAuth, async (req, res) => {
  if (!(await isLogEntriesEnabled())) {
    res.status(403).json({ error: "Log entries feature is not enabled" });
    return;
  }

  const userId = req.session.userId;
  const userRole = req.session.userRole;
  const userGroupIds = await getUserGroupIds(userId);

  const entries = await db
    .select({
      id: articlesTable.id,
      slug: articlesTable.slug,
      title: articlesTable.title,
      createdAt: articlesTable.createdAt,
      updatedAt: articlesTable.updatedAt,
      updatedByName: usersTable.name,
    })
    .from(articlesTable)
    .leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id))
    .where(and(eq(articlesTable.isLogEntry, true), eq(articlesTable.createdById, userId!)))
    .orderBy(desc(articlesTable.createdAt))
    .limit(500);

  if (entries.length === 0) {
    res.json({ entries: [], total: 0 });
    return;
  }

  // Apply the same group-access model as the regular article list
  const entryIds = entries.map((e) => e.id);
  const allGroups = await db
    .select()
    .from(articleGroupsTable)
    .where(inArray(articleGroupsTable.articleId, entryIds));

  const result = entries
    .map((e) => {
      const entryGroupIds = allGroups
        .filter((ag) => ag.articleId === e.id)
        .map((ag) => ag.groupId);
      if (!canAccessArticle(entryGroupIds, userGroupIds, userRole)) return null;
      return {
        id: e.id,
        slug: e.slug,
        title: e.title,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        updatedByName: e.updatedByName ?? null,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  res.json({ entries: result, total: result.length });
});

// ─── Unified Search ───────────────────────────────────────────────────────────

router.get("/search", requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || typeof q !== "string" || q.trim().length < 2) {
    res.json({ articles: [], logEntries: [], tasks: [], cards: [] });
    return;
  }
  const term = q.trim();
  const userId = req.session.userId;
  const userRole = req.session.userRole;
  const userGroupIds = await getUserGroupIds(userId);

  const searchCond = or(
    ilike(articlesTable.title, `%${term}%`),
    ilike(articlesTable.content, `%${term}%`),
  );

  // ── Articles ──
  const rawArticles = await db
    .select({
      id: articlesTable.id,
      slug: articlesTable.slug,
      title: articlesTable.title,
      updatedAt: articlesTable.updatedAt,
      updatedByName: usersTable.name,
    })
    .from(articlesTable)
    .leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id))
    .where(and(ne(articlesTable.isLogEntry, true), searchCond!))
    .orderBy(desc(articlesTable.updatedAt))
    .limit(20);

  const articleIds = rawArticles.map((a) => a.id);
  const articleGroups =
    articleIds.length > 0
      ? await db
          .select()
          .from(articleGroupsTable)
          .where(inArray(articleGroupsTable.articleId, articleIds))
      : [];

  const articles = rawArticles
    .filter((a) => {
      const gids = articleGroups.filter((g) => g.articleId === a.id).map((g) => g.groupId);
      return canAccessArticle(gids, userGroupIds, userRole);
    })
    .slice(0, 8)
    .map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      updatedAt: a.updatedAt,
      updatedByName: a.updatedByName ?? null,
    }));

  // ── Log entries (only if feature enabled) ──
  let logEntries: typeof articles = [];
  if (await isLogEntriesEnabled()) {
    const rawLogs = await db
      .select({
        id: articlesTable.id,
        slug: articlesTable.slug,
        title: articlesTable.title,
        updatedAt: articlesTable.updatedAt,
        updatedByName: usersTable.name,
      })
      .from(articlesTable)
      .leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id))
      .where(
        and(
          eq(articlesTable.isLogEntry, true),
          eq(articlesTable.createdById, userId!),
          searchCond!,
        ),
      )
      .orderBy(desc(articlesTable.createdAt))
      .limit(10);

    const logIds = rawLogs.map((e) => e.id);
    const logGroups =
      logIds.length > 0
        ? await db
            .select()
            .from(articleGroupsTable)
            .where(inArray(articleGroupsTable.articleId, logIds))
        : [];

    logEntries = rawLogs
      .filter((e) => {
        const gids = logGroups.filter((g) => g.articleId === e.id).map((g) => g.groupId);
        return canAccessArticle(gids, userGroupIds, userRole);
      })
      .slice(0, 5)
      .map((e) => ({
        id: e.id,
        slug: e.slug,
        title: e.title,
        updatedAt: e.updatedAt,
        updatedByName: e.updatedByName ?? null,
      }));
  }

  // ── Tasks (user-scoped) ──
  const rawTasks = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      updatedAt: tasksTable.updatedAt,
      listId: tasksTable.listId,
      listName: taskListsTable.name,
    })
    .from(tasksTable)
    .leftJoin(taskListsTable, eq(tasksTable.listId, taskListsTable.id))
    .where(
      and(
        eq(taskListsTable.userId, userId!),
        ilike(tasksTable.title, `%${term}%`),
      ),
    )
    .orderBy(desc(tasksTable.updatedAt))
    .limit(8);

  const tasks = rawTasks.map((t) => ({
    id: t.id,
    title: t.title,
    updatedAt: t.updatedAt,
    listName: t.listName ?? null,
  }));

  // ── Board cards (restricted to projects the user can access) ──
  let accessibleProjectIds: number[];
  if (userRole === "admin") {
    const allProjects = await db.select({ id: projectsTable.id }).from(projectsTable);
    accessibleProjectIds = allProjects.map((p) => p.id);
  } else {
    const ownProjects = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.createdById, userId!));
    let groupProjectIds: number[] = [];
    if (userGroupIds.length > 0) {
      const pgRows = await db
        .select({ projectId: projectGroupsTable.projectId })
        .from(projectGroupsTable)
        .where(inArray(projectGroupsTable.groupId, userGroupIds));
      groupProjectIds = pgRows.map((r) => r.projectId);
    }
    accessibleProjectIds = [...new Set([...ownProjects.map((p) => p.id), ...groupProjectIds])];
  }

  let cards: { id: number; title: string; updatedAt: Date; projectId: number; boardId: number; boardName: string | null; projectName: string | null }[] = [];
  if (accessibleProjectIds.length > 0) {
    const rawCards = await db
      .select({
        id: boardCardsTable.id,
        title: boardCardsTable.title,
        updatedAt: boardCardsTable.updatedAt,
        projectId: boardsTable.projectId,
        boardId: boardsTable.id,
        boardName: boardsTable.name,
        projectName: projectsTable.name,
      })
      .from(boardCardsTable)
      .innerJoin(boardColumnsTable, eq(boardCardsTable.columnId, boardColumnsTable.id))
      .innerJoin(boardsTable, eq(boardColumnsTable.boardId, boardsTable.id))
      .innerJoin(projectsTable, eq(boardsTable.projectId, projectsTable.id))
      .where(
        and(
          inArray(boardsTable.projectId, accessibleProjectIds),
          or(
            ilike(boardCardsTable.title, `%${term}%`),
            ilike(boardCardsTable.description, `%${term}%`),
          )!,
        ),
      )
      .orderBy(desc(boardCardsTable.updatedAt))
      .limit(8);

    cards = rawCards.map((c) => ({
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      projectId: c.projectId,
      boardId: c.boardId,
      boardName: c.boardName ?? null,
      projectName: c.projectName ?? null,
    }));
  }

  res.json({ articles, logEntries, tasks, cards });
});
// ─── Edit Locks ──────────────────────────────────────────────────────────────

const LOCK_TTL_MS = 2 * 60 * 1000; // 2 minutes

async function getActiveLock(articleId: number) {
  const [lock] = await db
    .select({
      userId: editLocksTable.userId,
      lockedAt: editLocksTable.lockedAt,
      userName: usersTable.name,
    })
    .from(editLocksTable)
    .leftJoin(usersTable, eq(editLocksTable.userId, usersTable.id))
    .where(eq(editLocksTable.articleId, articleId))
    .limit(1);
  if (!lock) return null;
  if (Date.now() - lock.lockedAt.getTime() > LOCK_TTL_MS) {
    // Expired — clean it up
    await db.delete(editLocksTable).where(eq(editLocksTable.articleId, articleId));
    return null;
  }
  return lock;
}

router.get("/articles/:slug/lock", requireAuth, async (req, res) => {
  const slug = String(req.params.slug);
  const [article] = await db.select({ id: articlesTable.id }).from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  const lock = await getActiveLock(article.id);
  res.json({
    articleId: article.id,
    lockedBy: lock ? { userId: lock.userId, userName: lock.userName ?? "Unknown", lockedAt: lock.lockedAt } : null,
  });
});

router.put("/articles/:slug/lock", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  const slug = String(req.params.slug);
  const userId = req.session.userId!;
  const [article] = await db.select({ id: articlesTable.id }).from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  const existing = await getActiveLock(article.id);
  if (existing && existing.userId !== userId) {
    // Locked by someone else
    res.status(409).json({
      articleId: article.id,
      lockedBy: { userId: existing.userId, userName: existing.userName ?? "Unknown", lockedAt: existing.lockedAt },
    });
    return;
  }

  // Acquire or refresh (upsert)
  const now = new Date();
  await db
    .insert(editLocksTable)
    .values({ articleId: article.id, userId, lockedAt: now })
    .onConflictDoUpdate({
      target: editLocksTable.articleId,
      set: { userId, lockedAt: now },
    });

  res.json({
    articleId: article.id,
    lockedBy: { userId, userName: req.session.userName ?? "Unknown", lockedAt: now },
  });
});

router.delete("/articles/:slug/lock", requireAuth, async (req, res) => {
  const slug = String(req.params.slug);
  const userId = req.session.userId!;
  const userRole = req.session.userRole;
  const [article] = await db.select({ id: articlesTable.id }).from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  const lock = await getActiveLock(article.id);
  if (!lock) {
    res.json({ message: "No active lock" });
    return;
  }

  if (lock.userId !== userId && userRole !== "admin") {
    res.status(403).json({ error: "Cannot release another user's lock" });
    return;
  }

  await db.delete(editLocksTable).where(eq(editLocksTable.articleId, article.id));
  res.json({ message: "Lock released" });
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

  // Extract infoboxes (new <div data-type="infobox"> and legacy <table class="infobox">)
  // before handing HTML to turndown so they don't get mangled into plain Markdown tables.
  const pdfInfoboxes: PdfInfoboxData[] = [];
  const rawHtml = article.content || "";

  const cleanedHtml = rawHtml
    .replace(/<div[^>]*data-type=["']infobox["'][^>]*>[\s\S]*?<\/div>/gi, (match) => {
      const id = pdfInfoboxes.length;
      pdfInfoboxes.push(parsePdfInfobox(match));
      return `<img data-pdf-infobox="${id}" src="" alt="">`;
    })
    .replace(/<table[^>]*class=["'][^"']*infobox[^"']*["'][^>]*>[\s\S]*?<\/table>/gi, (match) => {
      const id = pdfInfoboxes.length;
      pdfInfoboxes.push(parsePdfInfobox(match));
      return `<img data-pdf-infobox="${id}" src="" alt="">`;
    });

  // Split content into text, image and infobox segments
  type Segment =
    | { type: "text"; html: string }
    | { type: "image"; src: string; widthPx?: number }
    | { type: "infobox"; data: PdfInfoboxData };

  /** Parse an explicit pixel width from a width attribute or inline style (e.g. style="width:200px"). */
  function parseImgWidth(imgTag: string): number | undefined {
    const wAttr = imgTag.match(/\bwidth=["']?(\d+)["']?/i);
    if (wAttr) return parseInt(wAttr[1]);
    const wStyle = imgTag.match(/style=["'][^"']*width\s*:\s*(\d+(?:\.\d+)?)px/i);
    if (wStyle) return Math.round(parseFloat(wStyle[1]));
    return undefined;
  }

  const segments: Segment[] = [];
  const imgRegex = /<img[^>]+>/gi;
  let lastIndex = 0;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgRegex.exec(cleanedHtml)) !== null) {
    if (imgMatch.index > lastIndex) {
      segments.push({ type: "text", html: cleanedHtml.slice(lastIndex, imgMatch.index) });
    }
    const infoboxIdMatch = imgMatch[0].match(/data-pdf-infobox=["'](\d+)["']/);
    if (infoboxIdMatch) {
      segments.push({ type: "infobox", data: pdfInfoboxes[parseInt(infoboxIdMatch[1])] });
    } else {
      const srcMatch = imgMatch[0].match(/src=["']([^"']+)["']/);
      if (srcMatch) {
        segments.push({ type: "image", src: srcMatch[1], widthPx: parseImgWidth(imgMatch[0]) });
      }
    }
    lastIndex = imgMatch.index + imgMatch[0].length;
  }
  if (lastIndex < cleanedHtml.length) segments.push({ type: "text", html: cleanedHtml.slice(lastIndex) });

  const PAGE_LEFT = 60;
  const USABLE_WIDTH = 475; // A4 (595.28pt) minus 60pt margins on each side

  for (const seg of segments) {
    if (seg.type === "text") {
      const md = turndown.turndown(seg.html);
      if (md.trim()) {
        doc.fontSize(11).font("Helvetica").fillColor("#333333").text(md, { align: "left", lineGap: 4 });
        doc.moveDown(0.5);
      }
    } else if (seg.type === "infobox") {
      // Resolve infobox image from DB or data URL
      let ibImgBuffer: Buffer | null = null;
      let ibMimeType = "";
      if (seg.data.image) {
        const ibLocalMatch = seg.data.image.match(/\/api\/articles\/images\/(\d+)/);
        if (ibLocalMatch) {
          const ibImageId = parseInt(ibLocalMatch[1]);
          const [ibRow] = await db
            .select({ data: articleImagesTable.data, mimeType: articleImagesTable.mimeType })
            .from(articleImagesTable)
            .where(eq(articleImagesTable.id, ibImageId))
            .limit(1);
          if (ibRow) {
            ibImgBuffer = Buffer.from(ibRow.data, "base64");
            ibMimeType = ibRow.mimeType;
          }
        } else if (seg.data.image.startsWith("data:")) {
          const commaIdx = seg.data.image.indexOf(",");
          if (commaIdx !== -1) {
            ibMimeType = seg.data.image.slice(5, commaIdx).split(";")[0];
            ibImgBuffer = Buffer.from(seg.data.image.slice(commaIdx + 1), "base64");
          }
        }
      }
      drawPdfInfobox(doc, seg.data, PAGE_LEFT, USABLE_WIDTH, ibImgBuffer, ibMimeType || undefined);
    } else {
      // Resolve image buffer from DB or data URL
      let imgBuffer: Buffer | null = null;
      let mimeType = "";

      const localMatch = seg.src.match(/\/api\/articles\/images\/(\d+)/);
      if (localMatch) {
        const imageId = parseInt(localMatch[1]);
        const [imgRow] = await db
          .select({ data: articleImagesTable.data, mimeType: articleImagesTable.mimeType })
          .from(articleImagesTable)
          .where(eq(articleImagesTable.id, imageId))
          .limit(1);
        if (imgRow) {
          imgBuffer = Buffer.from(imgRow.data, "base64");
          mimeType = imgRow.mimeType;
        }
      } else if (seg.src.startsWith("data:")) {
        const commaIdx = seg.src.indexOf(",");
        if (commaIdx !== -1) {
          const header = seg.src.slice(5, commaIdx); // e.g. "image/png;base64"
          mimeType = header.split(";")[0];
          imgBuffer = Buffer.from(seg.src.slice(commaIdx + 1), "base64");
        }
      }

      // PDFKit natively supports JPEG and PNG; skip other formats gracefully
      if (imgBuffer && (mimeType === "image/jpeg" || mimeType === "image/png")) {
        try {
          // Respect the image's authored width when smaller than the page;
          // otherwise fit to the full usable width.
          const dims = readImageDimensions(imgBuffer, mimeType);
          const naturalW = dims?.w ?? USABLE_WIDTH;
          // Use the smaller of: authored width attr, natural pixel width, usable page width
          const targetW = Math.min(seg.widthPx ?? naturalW, naturalW, USABLE_WIDTH);
          const targetH = dims ? Math.round((targetW / naturalW) * dims.h) : 400;
          doc.image(imgBuffer, PAGE_LEFT, doc.y, { width: targetW, height: targetH });
          doc.moveDown(0.5);
        } catch {
          // Silently skip unembeddable images
        }
      }
    }
  }

  doc.moveDown(3);
  doc
    .fontSize(9)
    .fillColor("#888888")
    .text(`Exported from Knowledge Base — ${new Date().toLocaleDateString()}`, { align: "right" });

  doc.end();
});

// ─── Version history ─────────────────────────────────────────────────────────

router.get("/articles/:slug/versions", requireAuth, async (req, res) => {
  const slug = String(req.params.slug);
  const [article] = await db
    .select({ id: articlesTable.id })
    .from(articlesTable)
    .where(eq(articlesTable.slug, slug))
    .limit(1);
  if (!article) { res.status(404).json({ error: "Article not found" }); return; }

  // Access check
  const userId = req.session.userId;
  const userRole = req.session.userRole;
  const userGroupIds = await getUserGroupIds(userId);
  const groups = await getArticleGroups(article.id);
  if (!canAccessArticle(groups.map((g) => g.id), userGroupIds, userRole)) {
    res.status(403).json({ error: "Access denied" }); return;
  }

  const versions = await db
    .select({
      id: articleVersionsTable.id,
      versionNumber: articleVersionsTable.versionNumber,
      title: articleVersionsTable.title,
      createdAt: articleVersionsTable.createdAt,
      createdByName: usersTable.name,
    })
    .from(articleVersionsTable)
    .leftJoin(usersTable, eq(articleVersionsTable.createdById, usersTable.id))
    .where(eq(articleVersionsTable.articleId, article.id))
    .orderBy(desc(articleVersionsTable.versionNumber));

  res.json(versions);
});

router.get("/articles/:slug/versions/:versionId", requireAuth, async (req, res) => {
  const slug = String(req.params.slug);
  const versionId = parseInt(String(req.params.versionId), 10);
  if (isNaN(versionId)) { res.status(400).json({ error: "Invalid version id" }); return; }

  const [article] = await db
    .select({ id: articlesTable.id })
    .from(articlesTable)
    .where(eq(articlesTable.slug, slug))
    .limit(1);
  if (!article) { res.status(404).json({ error: "Article not found" }); return; }

  const userId = req.session.userId;
  const userRole = req.session.userRole;
  const userGroupIds = await getUserGroupIds(userId);
  const groups = await getArticleGroups(article.id);
  if (!canAccessArticle(groups.map((g) => g.id), userGroupIds, userRole)) {
    res.status(403).json({ error: "Access denied" }); return;
  }

  const [version] = await db
    .select({
      id: articleVersionsTable.id,
      versionNumber: articleVersionsTable.versionNumber,
      title: articleVersionsTable.title,
      content: articleVersionsTable.content,
      createdAt: articleVersionsTable.createdAt,
      createdByName: usersTable.name,
    })
    .from(articleVersionsTable)
    .leftJoin(usersTable, eq(articleVersionsTable.createdById, usersTable.id))
    .where(and(
      eq(articleVersionsTable.id, versionId),
      eq(articleVersionsTable.articleId, article.id),
    ))
    .limit(1);

  if (!version) { res.status(404).json({ error: "Version not found" }); return; }
  res.json(version);
});

router.post("/articles/:slug/versions/:versionId/restore", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  const slug = String(req.params.slug);
  const versionId = parseInt(String(req.params.versionId), 10);
  if (isNaN(versionId)) { res.status(400).json({ error: "Invalid version id" }); return; }

  const [article] = await db
    .select()
    .from(articlesTable)
    .where(eq(articlesTable.slug, slug))
    .limit(1);
  if (!article) { res.status(404).json({ error: "Article not found" }); return; }

  const [version] = await db
    .select()
    .from(articleVersionsTable)
    .where(and(
      eq(articleVersionsTable.id, versionId),
      eq(articleVersionsTable.articleId, article.id),
    ))
    .limit(1);
  if (!version) { res.status(404).json({ error: "Version not found" }); return; }

  // Apply the old content as an update
  const [updated] = await db
    .update(articlesTable)
    .set({ title: version.title, content: version.content, updatedAt: new Date(), updatedById: req.session.userId ?? null })
    .where(eq(articlesTable.id, article.id))
    .returning();

  // Refresh wikilinks
  await db.delete(articleLinksTable).where(eq(articleLinksTable.fromArticleId, article.id));
  const wikilinks = extractWikilinks(version.content);
  if (wikilinks.length > 0) {
    await db.insert(articleLinksTable)
      .values(wikilinks.map((s) => ({ fromArticleId: article.id, toSlug: slugify(s) })))
      .onConflictDoNothing();
  }

  // Snapshot the restore as a new version
  const [versionCount] = await db
    .select({ c: count() })
    .from(articleVersionsTable)
    .where(eq(articleVersionsTable.articleId, article.id));
  await db.insert(articleVersionsTable).values({
    articleId: article.id,
    versionNumber: Number(versionCount?.c ?? 0) + 1,
    title: updated.title,
    content: updated.content,
    createdById: req.session.userId ?? null,
  });

  res.json({ message: "Restored", slug: updated.slug });
});

export default router;
