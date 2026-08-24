import { Router } from "express";
import { db } from "@workspace/db";
import {
  articlesTable,
  articleGroupsTable,
  articleImagesTable,
  groupsTable,
  tagsTable,
  articleTagsTable,
  usersTable,
  taskListsTable,
  tasksTable,
  projectsTable,
  boardsTable,
  boardColumnsTable,
  boardCardsTable,
  boardCardMembersTable,
  projectGroupsTable,
} from "@workspace/db";
import { eq, and, inArray, asc, desc, ne, count } from "drizzle-orm";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import multer from "multer";
const _require = createRequire(import.meta.url);
const { ZipArchive } = _require("archiver") as typeof import("archiver");
import { requireAuth, requireRole } from "../lib/auth";
import { sanitizeArticleHtml } from "../lib/sanitize";
import { slugify, extractWikilinks } from "../lib/slugify";
import { marked } from "marked";
import TurndownService from "turndown";
import { articleLinksTable } from "@workspace/db";

const router = Router();
// 20 MB compressed per-file cap; 50-file count cap prevents multipart abuse.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 50 } });

// Import safety limits
// Entry cap: EXPORT_ARTICLE_LIMIT articles × 3 files each (html+md+json)
// + up to EXPORT_ARTICLE_LIMIT images + metadata headroom.
const EXPORT_ARTICLE_LIMIT   = 5000;
const MAX_ZIP_ENTRIES        = EXPORT_ARTICLE_LIMIT * 4 + 50; // 20,050
const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024; // 200 MB aggregate (all entries)
const MAX_ENTRY_BYTES        = 10 * 1024 * 1024;   // 10 MB per individual entry
const MAX_RESTORE_RECORDS    = 10_000;

type ZipEntry = { stream: () => NodeJS.ReadableStream; uncompressedSize?: number };

/**
 * Read a ZIP entry as a Buffer while enforcing per-entry AND aggregate byte
 * ceilings.  Protects against ZIP bombs even when central-directory metadata
 * is forged or missing:
 *  1. Pre-flights the declared uncompressedSize (if available) against both caps.
 *  2. Streams decompressed output and aborts early if actual bytes exceed either cap.
 *  3. Updates agg.bytesRead only on a successful read (so a failed read does not
 *     eat into the aggregate budget).
 * Returns null when either cap is exceeded.
 */
function readEntryBounded(
  file: ZipEntry,
  maxEntryBytes: number,
  agg: { bytesRead: number; limit: number },
): Promise<Buffer | null> {
  const declared = file.uncompressedSize ?? 0;
  if (declared > maxEntryBytes) return Promise.resolve(null);
  if (agg.bytesRead + declared > agg.limit) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const stream = file.stream();
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const abort = () => {
      settled = true;
      (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
      resolve(null);
    };

    stream.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      // Charge bytes to the aggregate as they arrive — including for entries that
      // ultimately fail.  This is the critical invariant: the aggregate ceiling
      // limits total decompression work even when entries are aborted mid-stream
      // (e.g. forged/absent declared sizes cannot bypass the budget).
      agg.bytesRead += chunk.length;
      if (total > maxEntryBytes || agg.bytesRead > agg.limit) { abort(); return; }
      chunks.push(chunk);
    });
    stream.on("end", () => {
      if (!settled) { settled = true; resolve(Buffer.concat(chunks)); }
    });
    stream.on("close", () => {
      if (!settled) { settled = true; resolve(null); }
    });
    stream.on("error", (err) => {
      if (!settled) { settled = true; reject(err); }
    });
  });
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Derive a human-readable title from a markdown filename (slug). */
function titleFromSlug(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extract the first H1 heading from raw markdown, if present. */
function extractH1(md: string): string | null {
  const match = /^# (.+)$/m.exec(md);
  return match ? match[1].trim() : null;
}

/** Derive a MIME type from a file extension. */
function mimeFromExt(filename: string): string {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Return the set of image DB IDs referenced in raw HTML content. */
function extractImageIds(html: string): number[] {
  const ids: number[] = [];
  const re = /\/api\/articles\/images\/(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) ids.push(parseInt(m[1]));
  return [...new Set(ids)];
}

/**
 * Rewrite exported `../images/{path}` references in markdown back to
 * `/api/articles/images/{newId}` using the supplied map.
 */
function rewriteImageRefs(md: string, imagePathMap: Map<string, number>): string {
  let result = md;
  result = result.replace(/\(\.\.\/images\/([^)\s]+)\)/g, (full, path: string) => {
    const newId = imagePathMap.get(path);
    return newId !== undefined ? `(/api/articles/images/${newId})` : full;
  });
  result = result.replace(/src="\.\.\/images\/([^"]+)"/g, (full, path: string) => {
    const newId = imagePathMap.get(path);
    return newId !== undefined ? `src="/api/articles/images/${newId}"` : full;
  });
  return result;
}

/** Sanitise a filename for use inside a ZIP archive. */
function safeImageName(id: number, filename: string): string {
  const clean = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${id}-${clean}`;
}

type ImportResult = "imported" | "skipped";

/**
 * Import a single markdown buffer.  Optionally rewrites image URLs using the
 * provided imagePathMap (ZIP import) before parsing.
 * Returns the new/updated article ID so the caller can link images.
 */
async function importMarkdownBuffer(
  rawMd: string,
  fileName: string,
  overwrite: boolean,
  imagePathMap: Map<string, number> = new Map(),
): Promise<{ result: ImportResult; articleId: number | null }> {
  const slug = fileName
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const h1 = extractH1(rawMd);
  const title = h1 ?? titleFromSlug(slug);
  const bodyMd = rewriteImageRefs(rawMd.replace(/^# .+\n\n?/, ""), imagePathMap);
  const wikilinksFromMd = extractWikilinks(bodyMd);
  const parsedHtml = await marked.parse(bodyMd);
  const articleContent = sanitizeArticleHtml(parsedHtml);

  const [existing] = await db
    .select({ id: articlesTable.id })
    .from(articlesTable)
    .where(eq(articlesTable.slug, slug))
    .limit(1);

  if (existing) {
    if (!overwrite) return { result: "skipped", articleId: null };
    await db
      .update(articlesTable)
      .set({ title, content: articleContent, updatedAt: new Date() })
      .where(eq(articlesTable.slug, slug));
    await db.delete(articleLinksTable).where(eq(articleLinksTable.fromArticleId, existing.id));
    if (wikilinksFromMd.length > 0) {
      await db
        .insert(articleLinksTable)
        .values(wikilinksFromMd.map((s) => ({ fromArticleId: existing.id, toSlug: slugify(s) })))
        .onConflictDoNothing();
    }
    return { result: "imported", articleId: existing.id };
  }

  const [article] = await db
    .insert(articlesTable)
    .values({ slug, title, content: articleContent })
    .returning();
  if (wikilinksFromMd.length > 0) {
    await db
      .insert(articleLinksTable)
      .values(wikilinksFromMd.map((s) => ({ fromArticleId: article.id, toSlug: slugify(s) })))
      .onConflictDoNothing();
  }
  return { result: "imported", articleId: article.id };
}

/** After upserting an article, link any images used in its content to it. */
async function linkImagesToArticle(articleContent: string, articleId: number): Promise<void> {
  const usedIds = extractImageIds(articleContent);
  if (usedIds.length > 0) {
    await db
      .update(articleImagesTable)
      .set({ articleId })
      .where(inArray(articleImagesTable.id, usedIds));
  }
}

// ─── TurndownService ─────────────────────────────────────────────────────────

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

// ─── Export ──────────────────────────────────────────────────────────────────

router.get("/admin/export", requireAuth, requireRole("admin"), async (_req, res) => {
  // Guard against loading unbounded data into memory on large instances.
  const [{ articleCount }] = await db.select({ articleCount: count() }).from(articlesTable);
  if (Number(articleCount) > EXPORT_ARTICLE_LIMIT) {
    res.status(413).json({
      error: `Export contains ${articleCount} articles which exceeds the ${EXPORT_ARTICLE_LIMIT}-article limit. Use a direct database backup instead.`,
    });
    return;
  }

  const articles = await db.select().from(articlesTable);
  const allGroups = await db.select().from(articleGroupsTable);
  const groups = await db.select().from(groupsTable);
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  // Fetch all tags and article-tag assignments
  const allTags = await db.select().from(tagsTable);
  const allArticleTags = await db.select().from(articleTagsTable);
  const tagMap = new Map(allTags.map((t) => [t.id, t]));
  // Build articleId → tag names[]
  const articleTagNamesMap = new Map<number, string[]>();
  for (const at of allArticleTags) {
    const tag = tagMap.get(at.tagId);
    if (!tag) continue;
    const existing = articleTagNamesMap.get(at.articleId) ?? [];
    existing.push(tag.name);
    articleTagNamesMap.set(at.articleId, existing);
  }

  // Collect all image IDs referenced across every article
  const allImageIds = new Set<number>();
  for (const article of articles) {
    for (const id of extractImageIds(article.content)) allImageIds.add(id);
  }

  // Batch-fetch images and build id → record map
  const imageMap = new Map<number, { id: number; filename: string; mimeType: string; data: string }>();
  if (allImageIds.size > 0) {
    const images = await db
      .select()
      .from(articleImagesTable)
      .where(inArray(articleImagesTable.id, [...allImageIds]));
    for (const img of images) imageMap.set(img.id, img);
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="knowledge-base-export.zip"');

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.pipe(res);

  // Add tags definitions file
  const tagsExport = allTags.map((t) => ({ id: t.id, name: t.name, color: t.color }));
  archive.append(JSON.stringify(tagsExport, null, 2), { name: "tags.json" });

  // Add image files to the archive under images/
  for (const [imgId, img] of imageMap) {
    const name = safeImageName(imgId, img.filename);
    archive.append(Buffer.from(img.data, "base64"), { name: `images/${name}` });
  }

  // Add articles
  for (const article of articles) {
    const articleGroupIds = allGroups
      .filter((ag) => ag.articleId === article.id)
      .map((ag) => ag.groupId);
    const articleGroups = articleGroupIds
      .map((gid) => groupMap.get(gid)?.name)
      .filter(Boolean);

    // Rewrite absolute image URLs to relative paths for both formats
    const usedImageIds = extractImageIds(article.content);
    const imageUrlMap: Array<[string, string]> = usedImageIds
      .map((id) => {
        const img = imageMap.get(id);
        return img ? [`/api/articles/images/${id}`, `../images/${safeImageName(id, img.filename)}`] : null;
      })
      .filter((e): e is [string, string] => e !== null);

    // Raw HTML — lossless, used for backup/restore (preserves infoboxes,
    // table formatting, and any other custom TipTap nodes exactly)
    let rawHtml = article.content;
    for (const [from, to] of imageUrlMap) rawHtml = rawHtml.replaceAll(from, to);
    archive.append(rawHtml, { name: `articles/${article.slug}.html` });

    // Markdown — human-readable, portable to other tools
    let md = `# ${article.title}\n\n${turndown.turndown(article.content)}`;
    for (const [from, to] of imageUrlMap) md = md.replaceAll(from, to);
    archive.append(md, { name: `articles/${article.slug}.md` });

    const meta = {
      slug: article.slug,
      title: article.title,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      groups: articleGroups,
      tags: articleTagNamesMap.get(article.id) ?? [],
      images: usedImageIds.map((id) => {
        const img = imageMap.get(id);
        return img ? { exportPath: `images/${safeImageName(id, img.filename)}` } : null;
      }).filter(Boolean),
    };
    archive.append(JSON.stringify(meta, null, 2), { name: `articles/${article.slug}.json` });
  }

  const manifest = {
    exportedAt: new Date(),
    articleCount: articles.length,
    imageCount: imageMap.size,
    tagCount: allTags.length,
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  await archive.finalize();
});

// ─── Import ──────────────────────────────────────────────────────────────────

router.post("/admin/import", requireAuth, requireRole("admin"), upload.any(), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    res.status(400).json({ error: "No file uploaded", imported: 0, skipped: 0, errors: [] });
    return;
  }
  const overwrite = req.body.overwrite === "true";
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  const isMd = (f: Express.Multer.File) => f.originalname.toLowerCase().endsWith(".md");
  const isZip = (f: Express.Multer.File) =>
    f.originalname.toLowerCase().endsWith(".zip") ||
    f.mimetype === "application/zip" ||
    f.mimetype === "application/x-zip-compressed";

  const zipFile = files.find(isZip);
  const mdFiles = files.filter(isMd);

  // --- Multi-file .md folder import (no image support, images stay as broken refs) ---
  if (!zipFile && mdFiles.length > 0) {
    for (const f of mdFiles) {
      try {
        const { result, articleId } = await importMarkdownBuffer(
          f.buffer.toString("utf-8"),
          f.originalname,
          overwrite,
        );
        if (result === "imported") {
          imported++;
        } else {
          skipped++;
        }
        void articleId;
      } catch (err) {
        errors.push(
          `Failed to import ${f.originalname}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    res.json({ imported, skipped, errors });
    return;
  }

  if (!zipFile) {
    res.status(400).json({ error: "No ZIP or .md file found in upload", imported: 0, skipped: 0, errors: [] });
    return;
  }

  // --- ZIP archive import ---
  const unzipper = await import("unzipper");
  const directory = await unzipper.Open.buffer(zipFile.buffer);

  // ── Entry-count guard (quick; does not trust decompressed-size metadata) ─
  if (directory.files.length > MAX_ZIP_ENTRIES) {
    res.status(413).json({
      error: `Archive contains ${directory.files.length} entries (limit: ${MAX_ZIP_ENTRIES})`,
      imported: 0,
      skipped: 0,
      errors: [],
    });
    return;
  }

  // Shared aggregate byte counter — enforced while streaming every entry so
  // forged/absent central-directory metadata cannot bypass the 200 MB cap.
  const agg = { bytesRead: 0, limit: MAX_DECOMPRESSED_BYTES };

  // ── Pass 0: import images ────────────────────────────────────────────────
  // Build a map from exported path (e.g. "42-photo.jpg") → new DB id
  const imagePathMap = new Map<string, number>();
  const imageZipFiles = directory.files.filter(
    (f) => f.path.startsWith("images/") && !f.path.endsWith("/"),
  );

  for (const file of imageZipFiles) {
    try {
      const filename = file.path.replace(/^images\//, "");
      if (!filename) continue;
      const originalFilename = filename.replace(/^\d+-/, "") || filename;
      const mimeType = mimeFromExt(filename);
      const buf = await readEntryBounded(file as ZipEntry, MAX_ENTRY_BYTES, agg);
      if (buf === null) {
        errors.push(`Skipped oversized image ${file.path} (limit: ${MAX_ENTRY_BYTES / 1024 / 1024} MB or aggregate 200 MB exceeded)`);
        continue;
      }
      const data = buf.toString("base64");
      const [inserted] = await db
        .insert(articleImagesTable)
        .values({ filename: originalFilename, mimeType, data })
        .returning({ id: articleImagesTable.id });
      imagePathMap.set(filename, inserted.id);
    } catch (err) {
      errors.push(
        `Failed to import image ${file.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Pre-load group names ─────────────────────────────────────────────────
  const allGroups = await db.select({ id: groupsTable.id, name: groupsTable.name }).from(groupsTable);
  const groupsByName = new Map(allGroups.map((g) => [g.name.toLowerCase(), g.id]));

  // ── Pre-load / create tags ───────────────────────────────────────────────
  // Load existing tags, then upsert any tags found in tags.json
  const existingTags = await db.select({ id: tagsTable.id, name: tagsTable.name, color: tagsTable.color }).from(tagsTable);
  const tagsByName = new Map(existingTags.map((t) => [t.name.toLowerCase(), t.id]));

  const tagsJsonFile = directory.files.find((f) => f.path === "tags.json");
  if (tagsJsonFile) {
    try {
      const tagsJsonBuf = await readEntryBounded(tagsJsonFile as ZipEntry, MAX_ENTRY_BYTES, agg);
      if (!tagsJsonBuf) {
        errors.push("Skipped tags.json: entry too large or aggregate limit exceeded");
      } else {
      const tagsJson = JSON.parse(tagsJsonBuf.toString("utf-8")) as Array<{
        name: string;
        color?: string;
      }>;
      for (const tagDef of tagsJson) {
        if (!tagDef.name || typeof tagDef.name !== "string") continue;
        const key = tagDef.name.toLowerCase();
        if (!tagsByName.has(key)) {
          const [inserted] = await db
            .insert(tagsTable)
            .values({ name: tagDef.name, color: tagDef.color ?? "#6366f1" })
            .onConflictDoNothing()
            .returning({ id: tagsTable.id });
          if (inserted) tagsByName.set(key, inserted.id);
        }
      }
      } // end if tagsJsonBuf
    } catch (err) {
      errors.push(`Failed to process tags.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Pass 1: JSON + MD pairs (full metadata, group assignments) ───────────
  const metaFiles = directory.files.filter(
    (f) => f.path.endsWith(".json") && f.path.includes("articles/") && f.path !== "manifest.json",
  );
  const processedSlugs = new Set<string>();

  for (const file of metaFiles) {
    try {
      const metaBuf = await readEntryBounded(file as ZipEntry, MAX_ENTRY_BYTES, agg);
      if (!metaBuf) {
        errors.push(`Skipped ${file.path}: entry too large or aggregate limit exceeded`);
        continue;
      }
      const meta = JSON.parse(metaBuf.toString("utf-8")) as {
        slug: string;
        title: string;
        groups?: string[];
        tags?: string[];
      };
      const slug = meta.slug;
      const title = meta.title;
      const metaGroupNames: string[] = Array.isArray(meta.groups)
        ? meta.groups.filter((g) => typeof g === "string")
        : [];
      const metaTagNames: string[] = Array.isArray(meta.tags)
        ? meta.tags.filter((t) => typeof t === "string")
        : [];

      const mdPath = file.path.replace(".json", ".md");
      const mdFile = directory.files.find((f) => f.path === mdPath);
      let articleContent = "";
      let wikilinksPass1: string[] = [];

      const htmlPath = file.path.replace(".json", ".html");
      const htmlFile = directory.files.find((f) => f.path === htmlPath);

      if (htmlFile) {
        // Lossless restore: raw HTML preserves infoboxes, custom tables, etc.
        const htmlBuf = await readEntryBounded(htmlFile as ZipEntry, MAX_ENTRY_BYTES, agg);
        if (!htmlBuf) {
          errors.push(`Skipped ${htmlFile.path}: entry too large or aggregate limit exceeded`);
          continue;
        }
        const rewrittenHtml = rewriteImageRefs(htmlBuf.toString("utf-8"), imagePathMap);
        articleContent = sanitizeArticleHtml(rewrittenHtml);
        wikilinksPass1 = extractWikilinks(rewrittenHtml);
      } else if (mdFile) {
        // Fallback: Markdown round-trip (third-party imports or older exports)
        const mdBuf = await readEntryBounded(mdFile as ZipEntry, MAX_ENTRY_BYTES, agg);
        if (!mdBuf) {
          errors.push(`Skipped ${mdFile.path}: entry too large or aggregate limit exceeded`);
          continue;
        }
        const bodyMd = rewriteImageRefs(mdBuf.toString("utf-8").replace(/^# .+\n\n/, ""), imagePathMap);
        wikilinksPass1 = extractWikilinks(bodyMd);
        articleContent = sanitizeArticleHtml(await marked.parse(bodyMd));
      }

      const [existing] = await db
        .select({ id: articlesTable.id })
        .from(articlesTable)
        .where(eq(articlesTable.slug, slug))
        .limit(1);

      let articleId: number;

      if (existing) {
        if (!overwrite) {
          skipped++;
          processedSlugs.add(slug);
          continue;
        }
        await db
          .update(articlesTable)
          .set({ title, content: articleContent, updatedAt: new Date() })
          .where(eq(articlesTable.slug, slug));
        articleId = existing.id;
        await db.delete(articleLinksTable).where(eq(articleLinksTable.fromArticleId, articleId));
        if (wikilinksPass1.length > 0) {
          await db
            .insert(articleLinksTable)
            .values(wikilinksPass1.map((s) => ({ fromArticleId: articleId, toSlug: slugify(s) })))
            .onConflictDoNothing();
        }
      } else {
        const [article] = await db
          .insert(articlesTable)
          .values({ slug, title, content: articleContent })
          .returning();
        articleId = article.id;
        if (wikilinksPass1.length > 0) {
          await db
            .insert(articleLinksTable)
            .values(wikilinksPass1.map((s) => ({ fromArticleId: articleId, toSlug: slugify(s) })))
            .onConflictDoNothing();
        }
      }

      // Link images to this article
      await linkImagesToArticle(articleContent, articleId);

      // Restore group assignments
      if (metaGroupNames.length > 0) {
        const resolvedGroupIds = metaGroupNames
          .map((name) => groupsByName.get(name.toLowerCase()))
          .filter((id): id is number => id !== undefined);
        if (resolvedGroupIds.length > 0) {
          await db.delete(articleGroupsTable).where(eq(articleGroupsTable.articleId, articleId));
          await db
            .insert(articleGroupsTable)
            .values(resolvedGroupIds.map((groupId) => ({ articleId, groupId })))
            .onConflictDoNothing();
        }
      }

      // Restore tag assignments
      if (metaTagNames.length > 0) {
        // Create any tags that don't exist yet (may not be in tags.json for older exports)
        for (const tagName of metaTagNames) {
          const key = tagName.toLowerCase();
          if (!tagsByName.has(key)) {
            const [inserted] = await db
              .insert(tagsTable)
              .values({ name: tagName })
              .onConflictDoNothing()
              .returning({ id: tagsTable.id });
            if (inserted) tagsByName.set(key, inserted.id);
          }
        }
        const resolvedTagIds = metaTagNames
          .map((name) => tagsByName.get(name.toLowerCase()))
          .filter((id): id is number => id !== undefined);
        if (resolvedTagIds.length > 0) {
          await db.delete(articleTagsTable).where(eq(articleTagsTable.articleId, articleId));
          await db
            .insert(articleTagsTable)
            .values(resolvedTagIds.map((tagId) => ({ articleId, tagId })))
            .onConflictDoNothing();
        }
      }

      processedSlugs.add(slug);
      imported++;
    } catch (err) {
      errors.push(`Failed to import ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Pass 2: markdown-only files with no companion JSON ───────────────────
  const mdOnlyFiles = directory.files.filter((f) => {
    if (!f.path.endsWith(".md")) return false;
    if (!f.path.includes("articles/")) return false;
    const slug = f.path.replace(/^articles\//, "").replace(/\.md$/, "");
    return !processedSlugs.has(slug);
  });

  for (const file of mdOnlyFiles) {
    try {
      const slug = file.path.replace(/^articles\//, "").replace(/\.md$/, "");

      // Prefer raw HTML companion for lossless restore
      const htmlCompanion = directory.files.find(
        (f) => f.path === `articles/${slug}.html`,
      );

      let articleContent: string;
      let wikilinksPass2: string[];
      let title: string;

      if (htmlCompanion) {
        const htmlBuf = await readEntryBounded(htmlCompanion as ZipEntry, MAX_ENTRY_BYTES, agg);
        if (!htmlBuf) {
          errors.push(`Skipped ${htmlCompanion.path}: entry too large or aggregate limit exceeded`);
          continue;
        }
        const rewrittenHtml = rewriteImageRefs(htmlBuf.toString("utf-8"), imagePathMap);
        articleContent = sanitizeArticleHtml(rewrittenHtml);
        wikilinksPass2 = extractWikilinks(rewrittenHtml);
        title = titleFromSlug(slug);
      } else {
        const mdBuf = await readEntryBounded(file as ZipEntry, MAX_ENTRY_BYTES, agg);
        if (!mdBuf) {
          errors.push(`Skipped ${file.path}: entry too large or aggregate limit exceeded`);
          continue;
        }
        const rawMd = mdBuf.toString("utf-8");
        const h1 = extractH1(rawMd);
        title = h1 ?? titleFromSlug(slug);
        const bodyMd = rewriteImageRefs(rawMd.replace(/^# .+\n\n?/, ""), imagePathMap);
        wikilinksPass2 = extractWikilinks(bodyMd);
        articleContent = sanitizeArticleHtml(await marked.parse(bodyMd));
      }

      const [existing] = await db
        .select({ id: articlesTable.id })
        .from(articlesTable)
        .where(eq(articlesTable.slug, slug))
        .limit(1);

      let articleId: number;

      if (existing) {
        if (!overwrite) {
          skipped++;
          continue;
        }
        await db
          .update(articlesTable)
          .set({ title, content: articleContent, updatedAt: new Date() })
          .where(eq(articlesTable.slug, slug));
        articleId = existing.id;
        await db.delete(articleLinksTable).where(eq(articleLinksTable.fromArticleId, articleId));
        if (wikilinksPass2.length > 0) {
          await db
            .insert(articleLinksTable)
            .values(wikilinksPass2.map((s) => ({ fromArticleId: articleId, toSlug: slugify(s) })))
            .onConflictDoNothing();
        }
      } else {
        const [article] = await db
          .insert(articlesTable)
          .values({ slug, title, content: articleContent })
          .returning();
        articleId = article.id;
        if (wikilinksPass2.length > 0) {
          await db
            .insert(articleLinksTable)
            .values(wikilinksPass2.map((s) => ({ fromArticleId: articleId, toSlug: slugify(s) })))
            .onConflictDoNothing();
        }
      }

      // Link images to this article
      await linkImagesToArticle(articleContent, articleId);

      imported++;
    } catch (err) {
      errors.push(`Failed to import ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  res.json({ imported, skipped, errors });
});

// ─── Restore Logs, Tasks, and Projects ────────────────────────────────────────

type RestoreKind = "logs" | "tasks" | "projects";
type RestoreOwner = { key: string; label: string };
type RestoreLog = {
  title: string; content: string; slug?: string; logSlug?: string;
  createdAt?: Date; updatedAt?: Date; owner: RestoreOwner | null;
};
type RestoreTask = {
  title: string; position: number; completedAt: Date | null; createdAt?: Date; updatedAt?: Date;
};
type RestoreTaskList = { name: string; owner: RestoreOwner | null; createdAt?: Date; tasks: RestoreTask[] };
type RestoreCard = {
  title: string; description: string; dueDate: Date | null; position: number; createdAt?: Date; updatedAt?: Date;
  members: RestoreOwner[];
};
type RestoreColumn = { name: string; position: number; createdAt?: Date; cards: RestoreCard[] };
type RestoreBoard = { name: string; position: number; archivedAt: Date | null; createdAt?: Date; columns: RestoreColumn[] };
type RestoreProject = {
  name: string; description: string; owner: RestoreOwner | null; archivedAt: Date | null; createdAt?: Date; updatedAt?: Date;
  groupNames: string[]; boards: RestoreBoard[];
};
type RestoreBackup =
  | { kind: "logs"; logs: RestoreLog[]; owners: RestoreOwner[]; warnings: string[] }
  | { kind: "tasks"; lists: RestoreTaskList[]; owners: RestoreOwner[]; warnings: string[] }
  | { kind: "projects"; projects: RestoreProject[]; owners: RestoreOwner[]; warnings: string[] };

function restoreRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${context} must be an object`);
  return value as Record<string, unknown>;
}

function restoreString(value: unknown, context: string, required = true): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${context} is required`);
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) throw new Error(`${context} must be a non-empty string`);
  return value.trim();
}

function restoreDate(value: unknown, context: string, nullable = false): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && nullable) return null;
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`${context} must be a date`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${context} is not a valid date`);
  return date;
}

function restorePosition(value: unknown, fallback: number, context: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context} must be a non-negative integer`);
  }
  return value;
}

function restoreOwner(value: unknown, context: string): RestoreOwner | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const label = restoreString(value, context)!;
    return { key: `name:${label.toLocaleLowerCase()}`, label };
  }
  const record = restoreRecord(value, context);
  const email = restoreString(record.email, `${context}.email`, false)?.toLocaleLowerCase();
  const name = restoreString(record.name, `${context}.name`, false);
  const sourceId = record.id;
  if (!email && !name && !(typeof sourceId === "number" && Number.isSafeInteger(sourceId))) {
    throw new Error(`${context} must include a name, email, or ID`);
  }
  const label = name ?? email ?? `Source user ${sourceId}`;
  return {
    // Source IDs are not safe cross-instance identities; email is stable when it is available.
    key: email ? `email:${email}` : typeof sourceId === "number" ? `source:${sourceId}:${label.toLocaleLowerCase()}` : `name:${label.toLocaleLowerCase()}`,
    label,
  };
}

function uniqueRestoreOwners(owners: Array<RestoreOwner | null>): RestoreOwner[] {
  return [...new Map(owners.filter((owner): owner is RestoreOwner => owner !== null).map((owner) => [owner.key, owner])).values()];
}

function restoreArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  if (value.length > MAX_RESTORE_RECORDS) throw new Error(`${context} exceeds the ${MAX_RESTORE_RECORDS}-record limit`);
  return value;
}

function parseRestoreBackup(value: unknown): RestoreBackup {
  const payload = restoreRecord(value, "Backup");
  const hasLogs = Array.isArray(payload.entries);
  const hasTasks = Array.isArray(payload.lists);
  const hasProjects = Array.isArray(payload.projects);
  if (Number(hasLogs) + Number(hasTasks) + Number(hasProjects) !== 1) {
    throw new Error("Backup must contain exactly one of entries, lists, or projects");
  }

  if (hasLogs) {
    const logs = restoreArray(payload.entries, "entries").map((raw, index): RestoreLog => {
      const entry = restoreRecord(raw, `entries[${index}]`);
      const owner = restoreOwner(entry.ownerRef ?? entry.owner ?? entry.createdBy ?? entry.createdByName, `entries[${index}].owner`);
      return {
        title: restoreString(entry.title, `entries[${index}].title`)!,
        content: restoreString(entry.content, `entries[${index}].content`, false) ?? "",
        slug: restoreString(entry.slug, `entries[${index}].slug`, false),
        logSlug: restoreString(entry.logSlug, `entries[${index}].logSlug`, false),
        createdAt: restoreDate(entry.createdAt, `entries[${index}].createdAt`) as Date | undefined,
        updatedAt: restoreDate(entry.updatedAt, `entries[${index}].updatedAt`) as Date | undefined,
        owner,
      };
    });
    const owners = uniqueRestoreOwners(logs.map((log) => log.owner));
    const warnings = logs.some((log) => !log.owner)
      ? ["Logs without an owner cannot be restored because private logs must always belong to an account."]
      : [];
    return { kind: "logs", logs, owners, warnings };
  }

  if (hasTasks) {
    const lists = restoreArray(payload.lists, "lists").map((raw, listIndex): RestoreTaskList => {
      const list = restoreRecord(raw, `lists[${listIndex}]`);
      const tasks = restoreArray(list.tasks ?? [], `lists[${listIndex}].tasks`).map((taskRaw, taskIndex): RestoreTask => {
        const task = restoreRecord(taskRaw, `lists[${listIndex}].tasks[${taskIndex}]`);
        const completedAt = restoreDate(task.completedAt, `lists[${listIndex}].tasks[${taskIndex}].completedAt`, true);
        if (completedAt === undefined && task.completed === true) {
          throw new Error(`lists[${listIndex}].tasks[${taskIndex}] is marked complete but has no completedAt date`);
        }
        return {
          title: restoreString(task.title, `lists[${listIndex}].tasks[${taskIndex}].title`)!,
          position: restorePosition(task.position, taskIndex, `lists[${listIndex}].tasks[${taskIndex}].position`),
          completedAt: (completedAt ?? null) as Date | null,
          createdAt: restoreDate(task.createdAt, `lists[${listIndex}].tasks[${taskIndex}].createdAt`) as Date | undefined,
          updatedAt: restoreDate(task.updatedAt, `lists[${listIndex}].tasks[${taskIndex}].updatedAt`) as Date | undefined,
        };
      });
      return {
        name: restoreString(list.name, `lists[${listIndex}].name`)!,
        owner: restoreOwner(list.ownerRef ?? list.owner, `lists[${listIndex}].owner`),
        createdAt: restoreDate(list.createdAt, `lists[${listIndex}].createdAt`) as Date | undefined,
        tasks,
      };
    });
    const owners = uniqueRestoreOwners(lists.map((list) => list.owner));
    const warnings = lists.some((list) => !list.owner)
      ? ["Task lists without an owner cannot be restored because every task list belongs to an account."]
      : [];
    return { kind: "tasks", lists, owners, warnings };
  }

  const projects = restoreArray(payload.projects, "projects").map((raw, projectIndex): RestoreProject => {
    const project = restoreRecord(raw, `projects[${projectIndex}]`);
    const boards = restoreArray(project.boards ?? [], `projects[${projectIndex}].boards`).map((boardRaw, boardIndex): RestoreBoard => {
      const board = restoreRecord(boardRaw, `projects[${projectIndex}].boards[${boardIndex}]`);
      const columns = restoreArray(board.columns ?? [], `projects[${projectIndex}].boards[${boardIndex}].columns`).map((columnRaw, columnIndex): RestoreColumn => {
        const column = restoreRecord(columnRaw, `projects[${projectIndex}].boards[${boardIndex}].columns[${columnIndex}]`);
        const cards = restoreArray(column.cards ?? [], `projects[${projectIndex}].boards[${boardIndex}].columns[${columnIndex}].cards`).map((cardRaw, cardIndex): RestoreCard => {
          const card = restoreRecord(cardRaw, `projects[${projectIndex}].boards[${boardIndex}].columns[${columnIndex}].cards[${cardIndex}]`);
          const memberValues = card.assigneeRefs ?? card.assignedTo ?? [];
          const members = restoreArray(memberValues, `projects[${projectIndex}].boards[${boardIndex}].columns[${columnIndex}].cards[${cardIndex}].assignedTo`)
            .map((member, memberIndex) => restoreOwner(member, `card assignee ${memberIndex}`))
            .filter((member): member is RestoreOwner => member !== null);
          return {
            title: restoreString(card.title, `projects[${projectIndex}].boards[${boardIndex}].columns[${columnIndex}].cards[${cardIndex}].title`)!,
            description: restoreString(card.description, "card.description", false) ?? "",
            dueDate: (restoreDate(card.dueDate, "card.dueDate", true) ?? null) as Date | null,
            position: restorePosition(card.position, cardIndex, "card.position"),
            createdAt: restoreDate(card.createdAt, "card.createdAt") as Date | undefined,
            updatedAt: restoreDate(card.updatedAt, "card.updatedAt") as Date | undefined,
            members,
          };
        });
        return {
          name: restoreString(column.name, "column.name")!,
          position: restorePosition(column.position, columnIndex, "column.position"),
          createdAt: restoreDate(column.createdAt, "column.createdAt") as Date | undefined,
          cards,
        };
      });
      return {
        name: restoreString(board.name, "board.name")!,
        position: restorePosition(board.position, boardIndex, "board.position"),
        archivedAt: (restoreDate(board.archivedAt, "board.archivedAt", true) ?? null) as Date | null,
        createdAt: restoreDate(board.createdAt, "board.createdAt") as Date | undefined,
        columns,
      };
    });
    const groups = Array.isArray(project.projectGroups) ? project.projectGroups : [];
    const groupNames = groups.map((group, index) => {
      if (typeof group === "string") return restoreString(group, `projectGroups[${index}]`)!;
      return restoreString(restoreRecord(group, `projectGroups[${index}]`).name, `projectGroups[${index}].name`)!;
    });
    return {
      name: restoreString(project.name, `projects[${projectIndex}].name`)!,
      description: restoreString(project.description, `projects[${projectIndex}].description`, false) ?? "",
      owner: restoreOwner(project.createdByRef ?? project.createdBy, `projects[${projectIndex}].createdBy`),
      archivedAt: (restoreDate(project.archivedAt, `projects[${projectIndex}].archivedAt`, true) ?? null) as Date | null,
      createdAt: restoreDate(project.createdAt, `projects[${projectIndex}].createdAt`) as Date | undefined,
      updatedAt: restoreDate(project.updatedAt, `projects[${projectIndex}].updatedAt`) as Date | undefined,
      groupNames,
      boards,
    };
  });
  const owners = uniqueRestoreOwners(projects.flatMap((project) => [
    project.owner,
    ...project.boards.flatMap((board) => board.columns.flatMap((column) => column.cards.flatMap((card) => card.members))),
  ]));
  return { kind: "projects", projects, owners, warnings: [] };
}

function parseRestoreFile(file: Express.Multer.File | undefined): RestoreBackup {
  if (!file) throw new Error("Choose a JSON backup file");
  if (file.buffer.length === 0) throw new Error("The backup file is empty");
  try {
    return parseRestoreBackup(JSON.parse(file.buffer.toString("utf-8")) as unknown);
  } catch (error) {
    throw new Error(`Invalid backup: ${error instanceof Error ? error.message : String(error)}`);
  }
}

router.post("/admin/restore/preview", requireAuth, requireRole("admin"), upload.single("file"), async (req, res) => {
  try {
    const backup = parseRestoreFile(req.file);
    const users = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable).orderBy(asc(usersTable.name));
    const usersByEmail = new Map(users.map((user) => [user.email.toLocaleLowerCase(), user.id]));
    const total = backup.kind === "logs" ? backup.logs.length : backup.kind === "tasks"
      ? backup.lists.length + backup.lists.reduce((sum, list) => sum + list.tasks.length, 0)
      : backup.projects.length;
    res.json({
      kind: backup.kind,
      total,
      owners: backup.owners.map((owner) => ({
        ...owner,
        suggestedUserId: owner.key.startsWith("email:") ? usersByEmail.get(owner.key.slice(6)) ?? null : null,
      })),
      warnings: backup.warnings,
      users,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid backup file" });
  }
});

router.post("/admin/restore", requireAuth, requireRole("admin"), upload.single("file"), async (req, res) => {
  try {
    const backup = parseRestoreFile(req.file);
    const suppliedMappings = JSON.parse(typeof req.body.ownerMappings === "string" ? req.body.ownerMappings : "{}") as Record<string, unknown>;
    const allUsers = await db.select({ id: usersTable.id }).from(usersTable);
    const validUserIds = new Set(allUsers.map((user) => user.id));
    const ownerIds = new Map<string, number>();
    for (const owner of backup.owners) {
      const mappedId = suppliedMappings[owner.key];
      if (typeof mappedId !== "number" || !Number.isSafeInteger(mappedId) || !validUserIds.has(mappedId)) {
        throw new Error(`Choose a valid local account for ${owner.label}`);
      }
      ownerIds.set(owner.key, mappedId);
    }
    if (backup.warnings.length > 0) throw new Error(backup.warnings[0]);

    const result = {
      kind: backup.kind,
      imported: { logs: 0, taskLists: 0, tasks: 0, projects: 0, boards: 0, columns: 0, cards: 0 },
      skipped: 0,
      warnings: [] as string[],
    };
    const mappedOwnerId = (owner: RestoreOwner | null): number | null => owner ? ownerIds.get(owner.key) ?? null : null;

    await db.transaction(async (tx) => {
      if (backup.kind === "logs") {
        for (const entry of backup.logs) {
          const ownerId = mappedOwnerId(entry.owner);
          if (!ownerId) throw new Error(`Log "${entry.title}" has no owner mapping`);
          const logSlug = slugify(entry.logSlug ?? entry.slug ?? entry.title);
          if (!logSlug) throw new Error(`Log "${entry.title}" does not have a usable URL segment`);
          const [existing] = await tx.select({ id: articlesTable.id }).from(articlesTable)
            .where(and(eq(articlesTable.createdById, ownerId), eq(articlesTable.logSlug, logSlug))).limit(1);
          if (existing) { result.skipped++; continue; }
          await tx.insert(articlesTable).values({
            slug: `private-log-import-${randomUUID()}`,
            logSlug,
            title: entry.title,
            content: sanitizeArticleHtml(entry.content),
            isLogEntry: true,
            createdById: ownerId,
            updatedById: ownerId,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
          });
          result.imported.logs++;
        }
        return;
      }

      if (backup.kind === "tasks") {
        for (const list of backup.lists) {
          const ownerId = mappedOwnerId(list.owner);
          if (!ownerId) throw new Error(`Task list "${list.name}" has no owner mapping`);
          const [existing] = await tx.select({ id: taskListsTable.id }).from(taskListsTable)
            .where(and(eq(taskListsTable.userId, ownerId), eq(taskListsTable.name, list.name))).limit(1);
          if (existing) { result.skipped += 1 + list.tasks.length; continue; }
          const [insertedList] = await tx.insert(taskListsTable).values({ userId: ownerId, name: list.name, createdAt: list.createdAt }).returning({ id: taskListsTable.id });
          result.imported.taskLists++;
          for (const task of list.tasks) {
            await tx.insert(tasksTable).values({
              listId: insertedList.id, title: task.title, position: task.position, completedAt: task.completedAt,
              createdAt: task.createdAt, updatedAt: task.updatedAt,
            });
            result.imported.tasks++;
          }
        }
        return;
      }

      const groups = await tx.select({ id: groupsTable.id, name: groupsTable.name }).from(groupsTable);
      const groupsByName = new Map(groups.map((group) => [group.name.toLocaleLowerCase(), group.id]));
      for (const project of backup.projects) {
        const [existing] = await tx.select({ id: projectsTable.id }).from(projectsTable)
          .where(eq(projectsTable.name, project.name)).limit(1);
        if (existing) { result.skipped++; continue; }
        const projectOwnerId = mappedOwnerId(project.owner);
        const [insertedProject] = await tx.insert(projectsTable).values({
          name: project.name, description: project.description, createdById: projectOwnerId,
          archivedAt: project.archivedAt, createdAt: project.createdAt, updatedAt: project.updatedAt,
        }).returning({ id: projectsTable.id });
        result.imported.projects++;
        for (const groupName of project.groupNames) {
          const groupId = groupsByName.get(groupName.toLocaleLowerCase());
          if (groupId) await tx.insert(projectGroupsTable).values({ projectId: insertedProject.id, groupId }).onConflictDoNothing();
          else result.warnings.push(`Project "${project.name}" was restored without missing group "${groupName}".`);
        }
        for (const board of project.boards) {
          const [insertedBoard] = await tx.insert(boardsTable).values({
            projectId: insertedProject.id, name: board.name, position: board.position, archivedAt: board.archivedAt, createdAt: board.createdAt,
          }).returning({ id: boardsTable.id });
          result.imported.boards++;
          for (const column of board.columns) {
            const [insertedColumn] = await tx.insert(boardColumnsTable).values({
              boardId: insertedBoard.id, name: column.name, position: column.position, createdAt: column.createdAt,
            }).returning({ id: boardColumnsTable.id });
            result.imported.columns++;
            for (const card of column.cards) {
              const [insertedCard] = await tx.insert(boardCardsTable).values({
                columnId: insertedColumn.id, title: card.title, description: card.description, dueDate: card.dueDate,
                position: card.position, createdById: projectOwnerId, createdAt: card.createdAt, updatedAt: card.updatedAt,
              }).returning({ id: boardCardsTable.id });
              for (const member of card.members) {
                const memberId = mappedOwnerId(member);
                if (!memberId) throw new Error(`Card "${card.title}" has an unresolved assignee`);
                await tx.insert(boardCardMembersTable).values({ cardId: insertedCard.id, userId: memberId }).onConflictDoNothing();
              }
              result.imported.cards++;
            }
          }
        }
      }
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Restore failed" });
  }
});

// ─── Additional Exports ───────────────────────────────────────────────────────

router.get("/admin/export/logs", requireAuth, requireRole("admin"), async (_req, res) => {
  const entries = await db
    .select({
      id: articlesTable.id,
      slug: articlesTable.slug,
      logSlug: articlesTable.logSlug,
      title: articlesTable.title,
      content: articlesTable.content,
      createdAt: articlesTable.createdAt,
      updatedAt: articlesTable.updatedAt,
      createdById: articlesTable.createdById,
      createdByName: usersTable.name,
      createdByEmail: usersTable.email,
    })
    .from(articlesTable)
    .leftJoin(usersTable, eq(articlesTable.createdById, usersTable.id))
    .where(eq(articlesTable.isLogEntry, true))
    .orderBy(desc(articlesTable.createdAt));

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", 'attachment; filename="logs-export.json"');
  res.json({
    format: "memex-backup",
    version: 1,
    kind: "logs",
    exportedAt: new Date(),
    entryCount: entries.length,
    entries: entries.map((e) => ({
      id: e.id,
      slug: e.slug,
      logSlug: e.logSlug,
      title: e.title,
      content: e.content,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      createdByName: e.createdByName ?? null,
      ownerRef: e.createdById === null ? null : {
        id: e.createdById,
        name: e.createdByName ?? null,
        email: e.createdByEmail ?? null,
      },
    })),
  });
});

router.get("/admin/export/tasks", requireAuth, requireRole("admin"), async (_req, res) => {
  const [lists, tasks, users] = await Promise.all([
    db.select().from(taskListsTable).orderBy(asc(taskListsTable.createdAt)),
    db.select().from(tasksTable).orderBy(asc(tasksTable.listId), asc(tasksTable.position), asc(tasksTable.createdAt)),
    db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", 'attachment; filename="tasks-export.json"');
  res.json({
    format: "memex-backup",
    version: 1,
    kind: "tasks",
    exportedAt: new Date(),
    listCount: lists.length,
    taskCount: tasks.length,
    lists: lists.map((list) => ({
      id: list.id,
      name: list.name,
      owner: userMap.get(list.userId)?.name ?? null,
      ownerRef: userMap.get(list.userId) ? {
        id: list.userId,
        name: userMap.get(list.userId)!.name,
        email: userMap.get(list.userId)!.email,
      } : null,
      createdAt: list.createdAt,
      tasks: tasks
        .filter((t) => t.listId === list.id)
        .map((t) => ({
          id: t.id,
          title: t.title,
          position: t.position,
          completed: t.completedAt !== null,
          completedAt: t.completedAt ?? null,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
    })),
  });
});

router.get("/admin/export/projects", requireAuth, requireRole("admin"), async (_req, res) => {
  const [projects, boards, columns, cards, members, users, projectGroups, groups] = await Promise.all([
    db.select().from(projectsTable).orderBy(asc(projectsTable.createdAt)),
    db.select().from(boardsTable).orderBy(asc(boardsTable.position)),
    db.select().from(boardColumnsTable).orderBy(asc(boardColumnsTable.position)),
    db.select().from(boardCardsTable).orderBy(asc(boardCardsTable.position)),
    db.select().from(boardCardMembersTable),
    db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email }).from(usersTable),
    db.select().from(projectGroupsTable),
    db.select({ id: groupsTable.id, name: groupsTable.name }).from(groupsTable),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const groupMap = new Map(groups.map((group) => [group.id, group]));

  const cardMembersMap = new Map<number, Array<{ id: number; name: string; email: string }>>();
  for (const m of members) {
    const memberUsers = cardMembersMap.get(m.cardId) ?? [];
    const user = userMap.get(m.userId);
    if (user) memberUsers.push(user);
    cardMembersMap.set(m.cardId, memberUsers);
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", 'attachment; filename="projects-export.json"');
  res.json({
    format: "memex-backup",
    version: 1,
    kind: "projects",
    exportedAt: new Date(),
    projectCount: projects.length,
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description || null,
      createdBy: userMap.get(project.createdById ?? -1)?.name ?? null,
      createdByRef: project.createdById !== null && userMap.get(project.createdById) ? {
        id: project.createdById,
        name: userMap.get(project.createdById)!.name,
        email: userMap.get(project.createdById)!.email,
      } : null,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      archivedAt: project.archivedAt,
      projectGroups: projectGroups
        .filter((entry) => entry.projectId === project.id)
        .map((entry) => groupMap.get(entry.groupId))
        .filter((group): group is { id: number; name: string } => Boolean(group)),
      boards: boards
        .filter((b) => b.projectId === project.id)
        .map((board) => ({
          id: board.id,
          name: board.name,
          position: board.position,
          archivedAt: board.archivedAt,
          createdAt: board.createdAt,
          columns: columns
            .filter((c) => c.boardId === board.id)
            .map((col) => ({
              id: col.id,
              name: col.name,
              position: col.position,
              createdAt: col.createdAt,
              cards: cards
                .filter((c) => c.columnId === col.id)
                .map((card) => ({
                  id: card.id,
                  title: card.title,
                  description: card.description || null,
                  dueDate: card.dueDate ?? null,
                  position: card.position,
                  assignedTo: (cardMembersMap.get(card.id) ?? []).map((user) => user.name),
                  assigneeRefs: cardMembersMap.get(card.id) ?? [],
                  createdAt: card.createdAt,
                  updatedAt: card.updatedAt,
                })),
            })),
        })),
    })),
  });
});

export default router;
