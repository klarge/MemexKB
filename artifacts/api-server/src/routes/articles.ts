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
import { eq, ilike, inArray, asc, desc, count, sql, and, or, ne, isNull } from "drizzle-orm";
import { requireAuth, requireRole, optionalAuth } from "../lib/auth";
import { sanitizeArticleHtml } from "../lib/sanitize";
import { slugify, extractWikilinks, rewriteWikilinksForSlug } from "../lib/slugify";
import TurndownService from "turndown";

const _require = createRequire(import.meta.url);
const PDFDocument = _require("pdfkit") as typeof import("pdfkit");

const router = Router();
const WIKILINK_MUTATION_LOCK = 824199;

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

function canAccessPrivateLog(
  article: { isLogEntry: boolean; createdById: number | null },
  userId: number | undefined,
  userRole: string | undefined,
): boolean {
  return !article.isLogEntry || userRole === "admin" || (userId !== undefined && article.createdById === userId);
}

async function canAccessProject(
  projectId: number,
  userId: number | undefined,
  userRole: string | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const [project] = await db
    .select({ createdById: projectsTable.createdById })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) return false;
  if (userRole === "admin" || project.createdById === userId) return true;
  const groupIds = await getUserGroupIds(userId);
  if (groupIds.length === 0) return false;
  const shared = await db
    .select({ projectId: projectGroupsTable.projectId })
    .from(projectGroupsTable)
    .where(and(eq(projectGroupsTable.projectId, projectId), inArray(projectGroupsTable.groupId, groupIds)))
    .limit(1);
  return shared.length > 0;
}

async function canAccessArticleRecord(
  article: { id: number; isLogEntry: boolean; createdById: number | null; projectId?: number | null },
  userId: number | undefined,
  userRole: string | undefined,
): Promise<boolean> {
  if (article.projectId !== null && article.projectId !== undefined) {
    return canAccessProject(article.projectId, userId, userRole);
  }
  if (!canAccessPrivateLog(article, userId, userRole)) return false;
  const articleGroupIds = (await getArticleGroups(article.id)).map((group) => group.id);
  const userGroupIds = await getUserGroupIds(userId);
  return canAccessArticle(articleGroupIds, userGroupIds, userRole);
}

async function canEditProjectDocument(
  projectId: number,
  userId: number | undefined,
  userRole: string | undefined,
): Promise<boolean> {
  if (!(await canAccessProject(projectId, userId, userRole))) return false;
  if (userRole === "admin") return true;
  if (userRole === "editor") return true;
  const [project] = await db
    .select({ createdById: projectsTable.createdById })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  return project?.createdById === userId;
}

function logUrlFields(article: { isLogEntry: boolean; logSlug: string | null; createdById: number | null }) {
  return {
    logSlug: article.isLogEntry ? article.logSlug : null,
    logOwnerId: article.isLogEntry ? article.createdById : null,
  };
}

let logSlugColumnSupport: { value: boolean; checkedAt: number } | undefined;
const LOG_SCHEMA_RECHECK_MS = 5_000;

/**
 * Older deployments can briefly run application code that expects log_slug before
 * their database migration has completed. Legacy log slugs were global, but are
 * still safe as a public segment when paired with their verified owner ID.
 */
function hasLogSlugColumn(): Promise<boolean> {
  const now = Date.now();
  if (logSlugColumnSupport?.value || (logSlugColumnSupport && now - logSlugColumnSupport.checkedAt < LOG_SCHEMA_RECHECK_MS)) {
    return Promise.resolve(logSlugColumnSupport.value);
  }
  return (async () => {
    const result = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'articles'
          AND column_name = 'log_slug'
      ) AS "exists"
    `);
    const value = (result.rows[0] as { exists?: boolean } | undefined)?.exists === true;
    logSlugColumnSupport = { value, checkedAt: Date.now() };
    return value;
  })();
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

  // Project documents are navigated through their project and must never surface
  // in the global Knowledge index or search filters.
  const conditions = [ne(articlesTable.isLogEntry, true), isNull(articlesTable.projectId)];
  const searchTerm = typeof search === "string" && search.trim() ? search.trim() : null;
  if (searchTerm) {
    const searchPattern = `%${searchTerm}%`;
    conditions.push(
      or(
        ilike(articlesTable.title, searchPattern),
        ilike(articlesTable.content, searchPattern),
      )!,
    );
  }
  if (tagFilterIds !== null) {
    conditions.push(inArray(articlesTable.id, tagFilterIds));
  }
  query = query.where(and(...conditions));

  const sortCol = sort === "updated_at" ? articlesTable.updatedAt : sort === "created_at" ? articlesTable.createdAt : articlesTable.title;
  if (searchTerm) {
    const searchPattern = `%${searchTerm}%`;
    // Keep substring search compatibility while ranking a title match above a
    // content-only match. The requested sort remains the tie-breaker.
    const relevance = sql<number>`
      CASE WHEN ${articlesTable.title} ILIKE ${searchPattern} THEN 2 ELSE 0 END
      + CASE WHEN ${articlesTable.content} ILIKE ${searchPattern} THEN 1 ELSE 0 END
    `;
    query = query.orderBy(
      desc(relevance),
      order === "desc" ? desc(sortCol) : asc(sortCol),
    );
  } else {
    query = query.orderBy(order === "desc" ? desc(sortCol) : asc(sortCol));
  }
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

  // Project documents belong to project metrics, not global Knowledge metrics.
  const notLogEntry = and(ne(articlesTable.isLogEntry, true), isNull(articlesTable.projectId))!;

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

  if (isLogEntry && !(await hasLogSlugColumn())) {
    res.status(503).json({
      error: "Log storage is updating. Existing logs are available, but new entries can be added after the database migration completes.",
    });
    return;
  }

  if (isLogEntry && groupIds && Array.isArray(groupIds) && groupIds.length > 0) {
    res.status(400).json({ error: "Personal log entries cannot be shared with groups" });
    return;
  }

  // Validate groupIds before creating the article so we don't leave orphaned records.
  if (groupIds && Array.isArray(groupIds) && groupIds.length > 0) {
    const existingGroups = await db.select({ id: groupsTable.id }).from(groupsTable).where(inArray(groupsTable.id, groupIds));
    const existingGroupIdSet = new Set(existingGroups.map((g) => g.id));
    if (groupIds.some((gid: number) => !existingGroupIdSet.has(gid))) {
      res.status(400).json({ error: "One or more group IDs do not exist" });
      return;
    }
    // Non-admins can only assign articles to groups they belong to.
    if (req.session.userRole !== "admin") {
      const userGroupIds = await getUserGroupIds(req.session.userId);
      const userGroupIdSet = new Set(userGroupIds);
      if (groupIds.some((gid: number) => !userGroupIdSet.has(gid))) {
        res.status(403).json({ error: "You can only assign articles to groups you are a member of" });
        return;
      }
    }
  }

  const titleSlug = slugify(title);
  if (!titleSlug) {
    res.status(400).json({ error: "Title must contain at least one letter or number" });
    return;
  }
  const logSlug = isLogEntry ? titleSlug : null;
  // Public log URLs use (owner ID, logSlug). The global article slug remains
  // internal for logs, so a timestamp plus the shared mutation lock avoids
  // collisions with ordinary article URLs.
  const slug = isLogEntry ? `private-log-${req.session.userId}-${Date.now()}` : titleSlug;
  const existing = isLogEntry
    ? await db.select({ id: articlesTable.id }).from(articlesTable).where(and(
        eq(articlesTable.isLogEntry, true),
        eq(articlesTable.createdById, req.session.userId!),
        eq(articlesTable.logSlug, logSlug!),
      )).limit(1)
    : await db.select({ id: articlesTable.id }).from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: isLogEntry ? "You already have a log entry with this URL." : "An article already uses this URL. Choose a more specific title." });
    return;
  }

  if (isLogEntry && !(await isLogEntriesEnabled())) {
    res.status(403).json({ error: "Log entries feature is not enabled" });
    return;
  }

  const sanitizedContent = sanitizeArticleHtml(content ?? "");
  const article = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${WIKILINK_MUTATION_LOCK})`);
    const [slugConflict] = await tx.select({ id: articlesTable.id }).from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
    if (slugConflict) throw new Error("INTERNAL_LOG_SLUG_CONFLICT");
    const [createdArticle] = await tx
      .insert(articlesTable)
      .values({ slug, logSlug, title, content: sanitizedContent, isLogEntry: Boolean(isLogEntry), createdById: req.session.userId ?? null, updatedById: req.session.userId ?? null })
      .returning();

    const wikilinks = extractWikilinks(content ?? "");
    if (wikilinks.length > 0) {
      await tx
        .insert(articleLinksTable)
        .values(wikilinks.map((target) => ({ fromArticleId: createdArticle.id, toSlug: slugify(target) })))
        .onConflictDoNothing();
    }

    const imgIds = [...(content ?? "").matchAll(/\/api\/articles\/images\/(\d+)/g)].map((m) => parseInt(m[1])).filter((n) => !isNaN(n));
    if (imgIds.length > 0) {
      await tx.update(articleImagesTable).set({ articleId: createdArticle.id }).where(inArray(articleImagesTable.id, imgIds));
    }

    await tx.insert(articleVersionsTable).values({
      articleId: createdArticle.id,
      versionNumber: 1,
      title: createdArticle.title,
      content: createdArticle.content,
      createdById: req.session.userId ?? null,
    });
    return createdArticle;
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "INTERNAL_LOG_SLUG_CONFLICT") {
      return null;
    }
    throw error;
  });
  if (!article) {
    res.status(409).json({ error: "Could not reserve a unique log URL. Please try again." });
    return;
  }

  if (groupIds && Array.isArray(groupIds) && groupIds.length > 0) {
    await db.insert(articleGroupsTable).values(groupIds.map((gid: number) => ({ articleId: article.id, groupId: gid })));
  }

  if (tagIds && Array.isArray(tagIds) && tagIds.length > 0) {
    await db.insert(articleTagsTable).values(tagIds.map((tid: number) => ({ articleId: article.id, tagId: tid }))).onConflictDoNothing();
  }

  const groups = await getArticleGroups(article.id);
  const tags = await getArticleTags(article.id);
  res.status(201).json({ id: article.id, slug: article.slug, title: article.title, content: article.content, updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: req.session.userName ?? null, isRestricted: groups.length > 0, canAccess: true, groups, tags, backlinks: [], ...logUrlFields(article) });
});

router.get("/logs/:userId/:logSlug", requireAuth, async (req, res) => {
  const userId = Number(req.params.userId);
  const logSlug = String(req.params.logSlug);
  if (!Number.isSafeInteger(userId) || userId <= 0 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(logSlug)) {
    res.status(404).json({ error: "Log entry not found" });
    return;
  }
  if (req.session.userRole !== "admin" && req.session.userId !== userId) {
    res.status(404).json({ error: "Log entry not found" });
    return;
  }
  const supportsLogSlug = await hasLogSlugColumn();
  const [article] = await db
    .select({
      id: articlesTable.id, slug: articlesTable.slug,
      title: articlesTable.title, content: articlesTable.content, isLogEntry: articlesTable.isLogEntry,
      createdById: articlesTable.createdById, updatedAt: articlesTable.updatedAt, createdAt: articlesTable.createdAt,
      updatedByName: usersTable.name,
    })
    .from(articlesTable)
    .leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id))
    .where(and(
      eq(articlesTable.isLogEntry, true),
      eq(articlesTable.createdById, userId),
      supportsLogSlug ? eq(articlesTable.logSlug, logSlug) : eq(articlesTable.slug, logSlug),
    ))
    .limit(1);
  if (!article) {
    res.status(404).json({ error: "Log entry not found" });
    return;
  }
  const tags = await getArticleTags(article.id);
  res.json({
    id: article.id, slug: article.slug, title: article.title, content: article.content,
    updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: article.updatedByName ?? null,
    isRestricted: false, canAccess: true, groups: [], tags, backlinks: [],
    logSlug, logOwnerId: article.createdById,
  });
});

router.get("/articles/:slug", optionalAuth, async (req, res) => {
  const slug = String(req.params.slug);
  const supportsLogSlug = await hasLogSlugColumn();
  if (!supportsLogSlug) {
    const [legacyArticle] = await db
      .select({
        id: articlesTable.id,
        slug: articlesTable.slug,
        title: articlesTable.title,
        content: articlesTable.content,
        isLogEntry: articlesTable.isLogEntry,
        projectId: articlesTable.projectId,
        createdById: articlesTable.createdById,
        updatedAt: articlesTable.updatedAt,
        createdAt: articlesTable.createdAt,
        updatedByName: usersTable.name,
      })
      .from(articlesTable)
      .leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id))
      .where(eq(articlesTable.slug, slug))
      .limit(1);
    if (!legacyArticle) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    const userId = req.session.userId;
    const userRole = req.session.userRole;
    if (!(await canAccessArticleRecord(legacyArticle, userId, userRole))) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    const userGroupIds = await getUserGroupIds(userId);
    const groups = await getArticleGroups(legacyArticle.id);
    const articleGroupIds = groups.map((g) => g.id);
    const isRestricted = articleGroupIds.length > 0;
    const canAccess = legacyArticle.projectId
      ? await canAccessProject(legacyArticle.projectId, userId, userRole)
      : (userId ? canAccessArticle(articleGroupIds, userGroupIds, userRole) : false);
    const tags = await getArticleTags(legacyArticle.id);
    res.json({
      id: legacyArticle.id,
      slug: legacyArticle.slug,
      title: legacyArticle.title,
      content: canAccess ? legacyArticle.content : "",
      updatedAt: legacyArticle.updatedAt,
      createdAt: legacyArticle.createdAt,
      updatedByName: legacyArticle.updatedByName ?? null,
        isRestricted: legacyArticle.projectId !== null || isRestricted,
      canAccess,
      groups: canAccess ? groups : [],
      tags,
      backlinks: [],
      logSlug: legacyArticle.isLogEntry ? legacyArticle.slug : null,
      logOwnerId: legacyArticle.isLogEntry ? legacyArticle.createdById : null,
    });
    return;
  }
  const [article] = await db
    .select({ id: articlesTable.id, slug: articlesTable.slug, logSlug: articlesTable.logSlug, title: articlesTable.title, content: articlesTable.content, isLogEntry: articlesTable.isLogEntry, projectId: articlesTable.projectId, createdById: articlesTable.createdById, updatedAt: articlesTable.updatedAt, createdAt: articlesTable.createdAt, updatedById: articlesTable.updatedById, updatedByName: usersTable.name })
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
  if (!(await canAccessArticleRecord(article, userId, userRole))) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  const userGroupIds = await getUserGroupIds(userId);
  const groups = await getArticleGroups(article.id);
  const articleGroupIds = groups.map((g) => g.id);
  const isRestricted = articleGroupIds.length > 0;
  // Unauthenticated users cannot read article content regardless of group restrictions
  const canAccess = article.projectId
    ? await canAccessProject(article.projectId, userId, userRole)
    : (userId ? canAccessArticle(articleGroupIds, userGroupIds, userRole) : false);

  const tags = await getArticleTags(article.id);

  if (!canAccess) {
    res.json({ id: article.id, slug: article.slug, projectId: article.projectId, title: article.title, content: "", updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: article.updatedByName ?? null, isRestricted: article.projectId !== null || isRestricted, canAccess: false, groups, tags, backlinks: [], ...logUrlFields(article) });
    return;
  }

  const backlinkRows = await db
    .select({ fromArticleId: articleLinksTable.fromArticleId })
    .from(articleLinksTable)
    .where(eq(articleLinksTable.toSlug, slug));
  let backlinks: { id: number; slug: string; title: string; updatedAt: Date; createdAt: Date; updatedByName: string | null; isRestricted: boolean; canAccess: boolean; groups: { id: number; name: string; description: string | null }[]; tags: { id: number; name: string; color: string; createdAt: Date; articleCount: number }[]; logSlug: string | null; logOwnerId: number | null }[] = [];
  if (backlinkRows.length > 0) {
    const fromIds = [...new Set(backlinkRows.map((b) => b.fromArticleId))];
    const fromArticles = await db.select({ id: articlesTable.id, slug: articlesTable.slug, logSlug: articlesTable.logSlug, isLogEntry: articlesTable.isLogEntry, projectId: articlesTable.projectId, createdById: articlesTable.createdById, title: articlesTable.title, updatedAt: articlesTable.updatedAt, createdAt: articlesTable.createdAt, updatedByName: usersTable.name }).from(articlesTable).leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id)).where(inArray(articlesTable.id, fromIds));
    backlinks = (await Promise.all(fromArticles.map(async (a) => {
      if (!(await canAccessArticleRecord(a, userId, userRole))) return null;
      const bGroups = await getArticleGroups(a.id);
      const bGroupIds = bGroups.map((g) => g.id);
      const bIsRestricted = a.projectId !== null || bGroupIds.length > 0;
      const bCanAccess = a.projectId !== null
        ? await canAccessProject(a.projectId, userId, userRole)
        : canAccessArticle(bGroupIds, userGroupIds, userRole);
      const bTags = await getArticleTags(a.id);
      return { id: a.id, slug: a.slug, title: a.title, updatedAt: a.updatedAt, createdAt: a.createdAt, updatedByName: a.updatedByName ?? null, isRestricted: bIsRestricted, canAccess: bCanAccess, groups: bCanAccess ? bGroups : [], tags: bTags, ...logUrlFields(a) };
    }))).filter((article): article is NonNullable<typeof article> => article !== null);
  }

  res.json({ id: article.id, slug: article.slug, projectId: article.projectId, title: article.title, content: article.content, updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: article.updatedByName ?? null, isRestricted: article.projectId !== null || isRestricted, canAccess: true, canEdit: article.projectId ? await canEditProjectDocument(article.projectId, userId, userRole) : undefined, groups, tags, backlinks, ...logUrlFields(article) });
});

router.patch("/articles/:slug/slug", requireAuth, requireRole("admin"), async (req, res) => {
  const currentSlug = String(req.params.slug);
  const nextSlug = typeof req.body?.slug === "string" ? req.body.slug.trim() : "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(nextSlug) || nextSlug.length > 100) {
    res.status(400).json({ error: "URL must use lowercase letters, numbers, and single hyphens only" });
    return;
  }

  if (!(await hasLogSlugColumn())) {
    const [legacyArticle] = await db
      .select({ isLogEntry: articlesTable.isLogEntry })
      .from(articlesTable)
      .where(eq(articlesTable.slug, currentSlug))
      .limit(1);
    if (legacyArticle?.isLogEntry) {
      res.status(503).json({
        error: "Log storage is updating. Log URLs can be managed after the database migration completes.",
      });
      return;
    }
  }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${WIKILINK_MUTATION_LOCK})`);
      const [existing] = await tx
        .select()
        .from(articlesTable)
        .where(eq(articlesTable.slug, currentSlug))
        .limit(1)
        .for("update");
      if (!existing) return { status: "not_found" as const };
      if (existing.isLogEntry) return { status: "log_entry" as const };
      if (currentSlug === nextSlug) return { status: "unchanged" as const };

      const [conflictingArticle] = await tx
        .select({ id: articlesTable.id })
        .from(articlesTable)
        .where(eq(articlesTable.slug, nextSlug))
        .limit(1)
        .for("update");
      if (conflictingArticle) return { status: "conflict" as const };

      const inboundRows = await tx
        .select({ fromArticleId: articleLinksTable.fromArticleId })
        .from(articleLinksTable)
        .where(eq(articleLinksTable.toSlug, currentSlug));
      const inboundIds = [...new Set(inboundRows.map((row) => row.fromArticleId))];
      const inboundArticles = inboundIds.length > 0
        ? await tx.select().from(articlesTable).where(inArray(articlesTable.id, inboundIds)).for("update")
        : [];

      const rewrittenContent = new Map<number, string>();
      for (const article of inboundArticles) {
        const content = rewriteWikilinksForSlug(article.content, currentSlug, nextSlug);
        if (content !== article.content) rewrittenContent.set(article.id, content);
      }

      const targetContent = rewrittenContent.get(existing.id) ?? existing.content;
      const [renamedArticle] = await tx
        .update(articlesTable)
        .set({
          slug: nextSlug,
          content: targetContent,
          updatedAt: new Date(),
          updatedById: req.session.userId ?? null,
        })
        .where(eq(articlesTable.id, existing.id))
        .returning();

      for (const article of inboundArticles) {
        if (article.id === existing.id) continue;
        const content = rewrittenContent.get(article.id);
        if (!content) continue;
        await tx
          .update(articlesTable)
          .set({ content, updatedAt: new Date(), updatedById: req.session.userId ?? null })
          .where(eq(articlesTable.id, article.id));
      }

      const rewrittenIds = [...rewrittenContent.keys()];
      if (rewrittenIds.length > 0) {
        await tx.delete(articleLinksTable).where(inArray(articleLinksTable.fromArticleId, rewrittenIds));
        const refreshedLinks = [...rewrittenContent.entries()].flatMap(([fromArticleId, content]) =>
          extractWikilinks(content).map((target) => ({ fromArticleId, toSlug: slugify(target) })),
        );
        if (refreshedLinks.length > 0) {
          await tx.insert(articleLinksTable).values(refreshedLinks).onConflictDoNothing();
        }
      }

      const versionArticles = [
        renamedArticle,
        ...inboundArticles
          .filter((article) => article.id !== existing.id && rewrittenContent.has(article.id))
          .map((article) => ({ ...article, content: rewrittenContent.get(article.id)! })),
      ];
      for (const article of versionArticles) {
        const [versionCount] = await tx
          .select({ c: count() })
          .from(articleVersionsTable)
          .where(eq(articleVersionsTable.articleId, article.id));
        await tx.insert(articleVersionsTable).values({
          articleId: article.id,
          versionNumber: Number(versionCount?.c ?? 0) + 1,
          title: article.title,
          content: article.content,
          createdById: req.session.userId ?? null,
        });
      }

      return { status: "updated" as const, rewrittenArticles: rewrittenContent.size };
    });
    if (result.status === "not_found") {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    if (result.status === "conflict") {
      res.status(409).json({ error: "An article already uses this URL" });
      return;
    }
    if (result.status === "log_entry") {
      res.status(400).json({ error: "Personal log URLs cannot be changed" });
      return;
    }
    if (result.status === "unchanged") {
      res.json({ slug: currentSlug, rewrittenArticles: 0 });
      return;
    }
    res.json({ slug: nextSlug, rewrittenArticles: result.rewrittenArticles });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      res.status(409).json({ error: "An article already uses this URL" });
      return;
    }
    throw error;
  }
});

router.patch("/articles/:slug", requireAuth, async (req, res) => {
  const slug = String(req.params.slug);
  const { title, content, groupIds, tagIds } = req.body;
  if (!(await hasLogSlugColumn())) {
    const [legacyArticle] = await db
      .select({ isLogEntry: articlesTable.isLogEntry })
      .from(articlesTable)
      .where(eq(articlesTable.slug, slug))
      .limit(1);
    if (legacyArticle?.isLogEntry) {
      res.status(503).json({
        error: "Log storage is updating. Editing log entries will be available after the database migration completes.",
      });
      return;
    }
  }
  const [existing] = await db.select().from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  if (existing.projectId !== null) {
    if (!(await canEditProjectDocument(existing.projectId, req.session.userId, req.session.userRole))) {
      res.status(403).json({ error: "You do not have permission to edit this document" });
      return;
    }
    if (groupIds !== undefined) {
      res.status(400).json({ error: "Project documents inherit access from their project" });
      return;
    }
  } else if (req.session.userRole !== "admin" && req.session.userRole !== "editor") {
    res.status(403).json({ error: "Editor access required" });
    return;
  }

  // Log entries can only be edited by their creator or an admin
  if (existing.isLogEntry && req.session.userRole !== "admin" && existing.createdById !== req.session.userId) {
    res.status(403).json({ error: "You can only edit your own log entries" });
    return;
  }
  if (existing.isLogEntry && groupIds !== undefined) {
    res.status(400).json({ error: "Personal log entries cannot be shared with groups" });
    return;
  }

  // Editors must be members of at least one group the article belongs to (admins bypass)
  if (existing.projectId === null) {
    const articleGroups = await getArticleGroups(existing.id);
    const articleGroupIds = articleGroups.map((g) => g.id);
    const userGroupIds = await getUserGroupIds(req.session.userId);
    if (!canAccessArticle(articleGroupIds, userGroupIds, req.session.userRole)) {
      res.status(403).json({ error: "You do not have permission to edit this article" });
      return;
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date(), updatedById: req.session.userId ?? null };
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = sanitizeArticleHtml(content);
  let article;
  let versionCreated = false;
  if (content !== undefined) {
    article = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${WIKILINK_MUTATION_LOCK})`);
      const [updatedArticle] = await tx
        .update(articlesTable)
        .set(updates)
        .where(eq(articlesTable.slug, slug))
        .returning();
      if (!updatedArticle) return null;

      await tx.delete(articleLinksTable).where(eq(articleLinksTable.fromArticleId, updatedArticle.id));
      const wikilinks = extractWikilinks(content);
      if (wikilinks.length > 0) {
        await tx
          .insert(articleLinksTable)
          .values(wikilinks.map((target) => ({ fromArticleId: updatedArticle.id, toSlug: slugify(target) })))
          .onConflictDoNothing();
      }

      const imgIds = [...content.matchAll(/\/api\/articles\/images\/(\d+)/g)].map((m) => parseInt(m[1])).filter((n) => !isNaN(n));
      if (imgIds.length > 0) {
        await tx.update(articleImagesTable).set({ articleId: updatedArticle.id }).where(inArray(articleImagesTable.id, imgIds));
      }

      const [versionCount] = await tx
        .select({ c: count() })
        .from(articleVersionsTable)
        .where(eq(articleVersionsTable.articleId, updatedArticle.id));
      await tx.insert(articleVersionsTable).values({
        articleId: updatedArticle.id,
        versionNumber: Number(versionCount?.c ?? 0) + 1,
        title: updatedArticle.title,
        content: updatedArticle.content,
        createdById: req.session.userId ?? null,
      });
      return updatedArticle;
    });
    versionCreated = article !== null;
    if (!article) {
      res.status(409).json({ error: "This article's URL changed while it was being saved. Reload and try again." });
      return;
    }
  } else {
    [article] = await db.update(articlesTable).set(updates).where(eq(articlesTable.slug, slug)).returning();
  }
  if (!article) {
    res.status(409).json({ error: "This article's URL changed while it was being saved. Reload and try again." });
    return;
  }

  if (groupIds !== undefined && Array.isArray(groupIds)) {
    await db.delete(articleGroupsTable).where(eq(articleGroupsTable.articleId, article.id));
    if (groupIds.length > 0) {
      await db.insert(articleGroupsTable).values(groupIds.map((gid: number) => ({ articleId: article.id, groupId: gid })));
    }
  }

  if (tagIds !== undefined && Array.isArray(tagIds)) {
    await setArticleTags(article.id, tagIds);
  }

  // Snapshot new version
  if (!versionCreated) {
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
  }

  const groups = await getArticleGroups(article.id);
  const tags = await getArticleTags(article.id);
  res.json({ id: article.id, slug: article.slug, projectId: article.projectId, title: article.title, content: article.content, updatedAt: article.updatedAt, createdAt: article.createdAt, updatedByName: req.session.userName ?? null, isRestricted: article.projectId !== null || groups.length > 0, canAccess: true, canEdit: article.projectId ? true : undefined, groups, tags, backlinks: [], ...logUrlFields(article) });
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

  const userId = req.session.userId!;

  // Safe integer parsing — rejects non-integers (decimals floored would silently
  // skew pages), values outside the PostgreSQL int4 range, and non-numeric input.
  const PG_INT4_MAX = 2_147_483_647;
  const parsePageInt = (val: unknown, fallback: number, cap = PG_INT4_MAX): number => {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return fallback;
    return Math.min(n, cap);
  };
  const PAGE_SIZE = Math.min(Math.max(1, parsePageInt(req.query.limit, 50)), 100);
  const offset = parsePageInt(req.query.offset, 0);

  const logWhere = and(
    eq(articlesTable.isLogEntry, true),
    eq(articlesTable.createdById, userId),
  );

  const supportsLogSlug = await hasLogSlugColumn();

  // Fetch limit+1 so we can detect hasMore without a separate count query.
  // Ordering by (created_at DESC, id DESC) is deterministic even when timestamps collide.
  const logListFields = {
    id: articlesTable.id,
    slug: articlesTable.slug,
    createdById: articlesTable.createdById,
    title: articlesTable.title,
    createdAt: articlesTable.createdAt,
    updatedAt: articlesTable.updatedAt,
    updatedByName: usersTable.name,
  };
  const logListQuery = db
    .select(supportsLogSlug ? { ...logListFields, logSlug: articlesTable.logSlug } : logListFields)
    .from(articlesTable)
    .leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id))
    .where(logWhere)
    .orderBy(desc(articlesTable.createdAt), desc(articlesTable.id))
    .limit(PAGE_SIZE + 1)
    .offset(offset);
  const fetched = await logListQuery;

  const hasMore = fetched.length > PAGE_SIZE;
  const result = (hasMore ? fetched.slice(0, PAGE_SIZE) : fetched).map((e) => ({
    id: e.id,
    slug: e.slug,
    // Before 0013, slug was the legacy public URL segment. It is paired with
    // the owner ID in every route and never used as an unscoped lookup.
    logSlug: supportsLogSlug
      ? ((e as typeof e & { logSlug?: string | null }).logSlug ?? e.slug)
      : e.slug,
    logOwnerId: e.createdById,
    title: e.title,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    updatedByName: e.updatedByName ?? null,
  }));

  res.json({ entries: result, hasMore, schemaOutOfDate: !supportsLogSlug });
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
    .where(and(ne(articlesTable.isLogEntry, true), isNull(articlesTable.projectId), searchCond!))
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
        logSlug: articlesTable.logSlug,
        createdById: articlesTable.createdById,
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

    logEntries = rawLogs
      .slice(0, 5)
      .map((e) => ({
        id: e.id,
        slug: e.slug,
        logSlug: e.logSlug,
        logOwnerId: e.createdById,
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
  const [article] = await db.select({ id: articlesTable.id, isLogEntry: articlesTable.isLogEntry, projectId: articlesTable.projectId, createdById: articlesTable.createdById }).from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  if (!(await canAccessArticleRecord(article, req.session.userId, req.session.userRole))) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  // Apply the same access check as the article read endpoint — lock holder
  // details should not leak to users who cannot access the article.
  if (article.projectId !== null && !(await canAccessProject(article.projectId, req.session.userId, req.session.userRole))) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const lock = await getActiveLock(article.id);
  res.json({
    articleId: article.id,
    lockedBy: lock ? { userId: lock.userId, userName: lock.userName ?? "Unknown", lockedAt: lock.lockedAt } : null,
  });
});

router.put("/articles/:slug/lock", requireAuth, async (req, res) => {
  const slug = String(req.params.slug);
  const userId = req.session.userId!;
  const [article] = await db.select({ id: articlesTable.id, isLogEntry: articlesTable.isLogEntry, projectId: articlesTable.projectId, createdById: articlesTable.createdById }).from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  if (!(await canAccessArticleRecord(article, req.session.userId, req.session.userRole))) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  if (article.projectId !== null) {
    if (!(await canEditProjectDocument(article.projectId, req.session.userId, req.session.userRole))) {
      res.status(403).json({ error: "You do not have permission to edit this document" });
      return;
    }
  } else if (req.session.userRole !== "admin" && req.session.userRole !== "editor") {
    res.status(403).json({ error: "Editor access required" });
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
  const [article] = await db.select({ id: articlesTable.id, isLogEntry: articlesTable.isLogEntry, projectId: articlesTable.projectId, createdById: articlesTable.createdById }).from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  if (!(await canAccessArticleRecord(article, req.session.userId, userRole))) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  // Only users who can access the article may release its lock.
  if (article.projectId !== null && !(await canAccessProject(article.projectId, req.session.userId, userRole))) {
    res.status(403).json({ error: "Access denied" });
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

router.delete("/articles/:slug", requireAuth, async (req, res) => {
  const slug = String(req.params.slug);
  if (!(await hasLogSlugColumn())) {
    const [legacyArticle] = await db
      .select({ isLogEntry: articlesTable.isLogEntry })
      .from(articlesTable)
      .where(eq(articlesTable.slug, slug))
      .limit(1);
    if (legacyArticle?.isLogEntry) {
      res.status(503).json({
        error: "Log storage is updating. Deleting log entries will be available after the database migration completes.",
      });
      return;
    }
  }
  const [existing] = await db.select().from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  if (existing.projectId !== null) {
    if (!(await canEditProjectDocument(existing.projectId, req.session.userId, req.session.userRole))) {
      res.status(403).json({ error: "You do not have permission to delete this document" });
      return;
    }
  } else if (req.session.userRole !== "admin" && req.session.userRole !== "editor") {
    res.status(403).json({ error: "Editor access required" });
    return;
  }
  // Mirror PATCH's two-level authorization check:
  // 1. Log entries can only be deleted by their creator or an admin.
  if (existing.isLogEntry && req.session.userRole !== "admin" && existing.createdById !== req.session.userId) {
    res.status(403).json({ error: "You can only delete your own log entries" });
    return;
  }
  // 2. Editors must be members of at least one of the article's groups (admins bypass).
  if (existing.projectId === null) {
    const articleGroupIds = (await getArticleGroups(existing.id)).map((g) => g.id);
    const userGroupIds = await getUserGroupIds(req.session.userId);
    if (!canAccessArticle(articleGroupIds, userGroupIds, req.session.userRole)) {
      res.status(403).json({ error: "You do not have permission to delete this article" });
      return;
    }
  }
  await db.delete(articlesTable).where(eq(articlesTable.slug, slug));
  res.json({ message: "Article deleted" });
});

router.get("/articles/:slug/backlinks", optionalAuth, async (req, res) => {
  const slug = String(req.params.slug);
  const supportsLogSlug = await hasLogSlugColumn();
  const [article] = await db.select({ id: articlesTable.id, isLogEntry: articlesTable.isLogEntry, projectId: articlesTable.projectId, createdById: articlesTable.createdById }).from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  if (!(await canAccessArticleRecord(article, req.session.userId, req.session.userRole))) {
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
  const backlinkFields = {
    id: articlesTable.id,
    slug: articlesTable.slug,
    isLogEntry: articlesTable.isLogEntry,
    projectId: articlesTable.projectId,
    createdById: articlesTable.createdById,
    title: articlesTable.title,
    updatedAt: articlesTable.updatedAt,
    createdAt: articlesTable.createdAt,
    updatedByName: usersTable.name,
  };
  const fromArticles = await db
    .select(supportsLogSlug ? { ...backlinkFields, logSlug: articlesTable.logSlug } : backlinkFields)
    .from(articlesTable)
    .leftJoin(usersTable, eq(articlesTable.updatedById, usersTable.id))
    .where(inArray(articlesTable.id, fromIds));

  const userId = req.session.userId;
  const userRole = req.session.userRole;
  const userGroupIds = await getUserGroupIds(userId);

  const backlinkResult = (await Promise.all(fromArticles.map(async (a) => {
    if (!(await canAccessArticleRecord(a, userId, userRole))) return null;
    const bGroups = await getArticleGroups(a.id);
    const bGroupIds = bGroups.map((g) => g.id);
    const bIsRestricted = bGroupIds.length > 0;
    const bCanAccess = canAccessArticle(bGroupIds, userGroupIds, userRole);
    return {
      id: a.id,
      slug: a.slug,
      title: a.title,
      updatedAt: a.updatedAt,
      createdAt: a.createdAt,
      updatedByName: a.updatedByName ?? null,
      isRestricted: bIsRestricted,
      canAccess: bCanAccess,
      groups: bCanAccess ? bGroups : [],
      logSlug: a.isLogEntry
        ? (supportsLogSlug
          ? ((a as typeof a & { logSlug?: string | null }).logSlug ?? a.slug)
          : a.slug)
        : null,
      logOwnerId: a.isLogEntry ? a.createdById : null,
    };
  }))).filter((article): article is NonNullable<typeof article> => article !== null);
  res.json(backlinkResult);
});

router.put("/articles/:slug/groups", requireAuth, requireRole("admin", "editor"), async (req, res) => {
  const { groupIds } = req.body;
  const slug = String(req.params.slug);
  if (!(await hasLogSlugColumn())) {
    const [legacyArticle] = await db
      .select({ isLogEntry: articlesTable.isLogEntry })
      .from(articlesTable)
      .where(eq(articlesTable.slug, slug))
      .limit(1);
    if (legacyArticle?.isLogEntry) {
      res.status(503).json({
        error: "Log storage is updating. Group settings for log entries will be available after the database migration completes.",
      });
      return;
    }
  }
  const [article] = await db.select().from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  if (article.isLogEntry) {
    res.status(400).json({ error: "Personal log entries cannot be shared with groups" });
    return;
  }
  if (article.projectId !== null) {
    res.status(400).json({ error: "Project documents inherit access from their project" });
    return;
  }
  // Only users who can already access this article (or admins) may change its groups.
  const currentGroupIds = (await getArticleGroups(article.id)).map((g) => g.id);
  const userGroupIds = await getUserGroupIds(req.session.userId);
  if (!canAccessArticle(currentGroupIds, userGroupIds, req.session.userRole)) {
    res.status(403).json({ error: "You do not have permission to modify this article's groups" });
    return;
  }
  // Validate that the new groupIds all exist.
  if (Array.isArray(groupIds) && groupIds.length > 0) {
    const existingGroups = await db.select({ id: groupsTable.id }).from(groupsTable).where(inArray(groupsTable.id, groupIds));
    const existingGroupIdSet = new Set(existingGroups.map((g) => g.id));
    if (groupIds.some((gid: number) => !existingGroupIdSet.has(gid))) {
      res.status(400).json({ error: "One or more group IDs do not exist" });
      return;
    }
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
  const [article] = await db
    .select({
      id: articlesTable.id,
      slug: articlesTable.slug,
      title: articlesTable.title,
      content: articlesTable.content,
      isLogEntry: articlesTable.isLogEntry,
      projectId: articlesTable.projectId,
      createdById: articlesTable.createdById,
    })
    .from(articlesTable)
    .where(eq(articlesTable.slug, slug))
    .limit(1);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  if (!(await canAccessArticleRecord(article, userId, userRole))) {
    res.status(404).json({ error: "Article not found" });
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
  const [article] = await db
    .select({
      id: articlesTable.id,
      slug: articlesTable.slug,
      title: articlesTable.title,
      content: articlesTable.content,
      isLogEntry: articlesTable.isLogEntry,
      projectId: articlesTable.projectId,
      createdById: articlesTable.createdById,
    })
    .from(articlesTable)
    .where(eq(articlesTable.slug, slug))
    .limit(1);
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  if (!(await canAccessArticleRecord(article, userId, userRole))) {
    res.status(404).json({ error: "Article not found" });
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
    .select({ id: articlesTable.id, isLogEntry: articlesTable.isLogEntry, projectId: articlesTable.projectId, createdById: articlesTable.createdById })
    .from(articlesTable)
    .where(eq(articlesTable.slug, slug))
    .limit(1);
  if (!article) { res.status(404).json({ error: "Article not found" }); return; }
  if (!(await canAccessArticleRecord(article, req.session.userId, req.session.userRole))) {
    res.status(404).json({ error: "Article not found" }); return;
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
    .select({ id: articlesTable.id, isLogEntry: articlesTable.isLogEntry, projectId: articlesTable.projectId, createdById: articlesTable.createdById })
    .from(articlesTable)
    .where(eq(articlesTable.slug, slug))
    .limit(1);
  if (!article) { res.status(404).json({ error: "Article not found" }); return; }
  if (!(await canAccessArticleRecord(article, req.session.userId, req.session.userRole))) {
    res.status(404).json({ error: "Article not found" }); return;
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

router.post("/articles/:slug/versions/:versionId/restore", requireAuth, async (req, res) => {
  const slug = String(req.params.slug);
  const versionId = parseInt(String(req.params.versionId), 10);
  if (isNaN(versionId)) { res.status(400).json({ error: "Invalid version id" }); return; }

  if (!(await hasLogSlugColumn())) {
    const [legacyArticle] = await db
      .select({ isLogEntry: articlesTable.isLogEntry })
      .from(articlesTable)
      .where(eq(articlesTable.slug, slug))
      .limit(1);
    if (legacyArticle?.isLogEntry) {
      res.status(503).json({
        error: "Log storage is updating. Restoring log history will be available after the database migration completes.",
      });
      return;
    }
  }

  const [article] = await db
    .select()
    .from(articlesTable)
    .where(eq(articlesTable.slug, slug))
    .limit(1);
  if (!article) { res.status(404).json({ error: "Article not found" }); return; }
  if (!(await canAccessArticleRecord(article, req.session.userId, req.session.userRole))) {
    res.status(404).json({ error: "Article not found" }); return;
  }

  if (article.projectId !== null) {
    if (!(await canEditProjectDocument(article.projectId, req.session.userId, req.session.userRole))) {
      res.status(403).json({ error: "You do not have permission to restore this document" }); return;
    }
  } else if (req.session.userRole !== "admin" && req.session.userRole !== "editor") {
    res.status(403).json({ error: "Editor access required" }); return;
  } else {
    const restoreGroups = await getArticleGroups(article.id);
    if (!canAccessArticle(restoreGroups.map((g) => g.id), await getUserGroupIds(req.session.userId), req.session.userRole)) {
      res.status(403).json({ error: "Access denied" }); return;
    }
  }

  const [version] = await db
    .select()
    .from(articleVersionsTable)
    .where(and(
      eq(articleVersionsTable.id, versionId),
      eq(articleVersionsTable.articleId, article.id),
    ))
    .limit(1);
  if (!version) { res.status(404).json({ error: "Version not found" }); return; }

  const restoreResult = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${WIKILINK_MUTATION_LOCK})`);
    const [currentArticle] = await tx
      .select()
      .from(articlesTable)
      .where(eq(articlesTable.slug, slug))
      .limit(1)
      .for("update");
    if (!currentArticle) return { status: "stale" as const };

    const [currentVersion] = await tx
      .select()
      .from(articleVersionsTable)
      .where(and(
        eq(articleVersionsTable.id, versionId),
        eq(articleVersionsTable.articleId, currentArticle.id),
      ))
      .limit(1);
    if (!currentVersion) return { status: "version_missing" as const };

    const [updatedArticle] = await tx
      .update(articlesTable)
      .set({ title: currentVersion.title, content: currentVersion.content, updatedAt: new Date(), updatedById: req.session.userId ?? null })
      .where(and(eq(articlesTable.id, currentArticle.id), eq(articlesTable.slug, slug)))
      .returning();

    await tx.delete(articleLinksTable).where(eq(articleLinksTable.fromArticleId, currentArticle.id));
    const wikilinks = extractWikilinks(currentVersion.content);
    if (wikilinks.length > 0) {
      await tx
        .insert(articleLinksTable)
        .values(wikilinks.map((target) => ({ fromArticleId: currentArticle.id, toSlug: slugify(target) })))
        .onConflictDoNothing();
    }

    const [versionCount] = await tx
      .select({ c: count() })
      .from(articleVersionsTable)
      .where(eq(articleVersionsTable.articleId, currentArticle.id));
    await tx.insert(articleVersionsTable).values({
      articleId: currentArticle.id,
      versionNumber: Number(versionCount?.c ?? 0) + 1,
      title: updatedArticle.title,
      content: updatedArticle.content,
      createdById: req.session.userId ?? null,
    });
    return { status: "updated" as const, article: updatedArticle };
  });
  if (restoreResult.status === "stale") {
    res.status(409).json({ error: "This article's URL changed while the version was being restored. Reload and try again." });
    return;
  }
  if (restoreResult.status === "version_missing") {
    res.status(404).json({ error: "Version not found" });
    return;
  }
  const updated = restoreResult.article;

  res.json({ message: "Restored", slug: updated.slug });
});

export default router;
