import { Router } from "express";
import { db } from "@workspace/db";
import {
  articlesTable,
  articleGroupsTable,
  articleImagesTable,
  groupsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { createRequire } from "node:module";
import multer from "multer";
const require = createRequire(import.meta.url);
const archiver = require("archiver") as typeof import("archiver");
import { requireAuth, requireRole } from "../lib/auth";
import { sanitizeArticleHtml } from "../lib/sanitize";
import { slugify, extractWikilinks } from "../lib/slugify";
import { marked } from "marked";
import TurndownService from "turndown";
import { articleLinksTable } from "@workspace/db";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

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
  const articles = await db.select().from(articlesTable);
  const allGroups = await db.select().from(articleGroupsTable);
  const groups = await db.select().from(groupsTable);
  const groupMap = new Map(groups.map((g) => [g.id, g]));

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

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res);

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

    // Convert HTML → markdown, then rewrite image URLs to relative paths
    let md = `# ${article.title}\n\n${turndown.turndown(article.content)}`;
    for (const imgId of extractImageIds(article.content)) {
      const img = imageMap.get(imgId);
      if (img) {
        const name = safeImageName(imgId, img.filename);
        md = md.replaceAll(`/api/articles/images/${imgId}`, `../images/${name}`);
      }
    }
    archive.append(md, { name: `articles/${article.slug}.md` });

    const usedImageIds = extractImageIds(article.content);
    const meta = {
      slug: article.slug,
      title: article.title,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      groups: articleGroups,
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
      const buf = await file.buffer();
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

  // ── Pass 1: JSON + MD pairs (full metadata, group assignments) ───────────
  const metaFiles = directory.files.filter(
    (f) => f.path.endsWith(".json") && f.path.includes("articles/") && f.path !== "manifest.json",
  );
  const processedSlugs = new Set<string>();

  for (const file of metaFiles) {
    try {
      const content = await file.buffer();
      const meta = JSON.parse(content.toString("utf-8")) as {
        slug: string;
        title: string;
        groups?: string[];
      };
      const slug = meta.slug;
      const title = meta.title;
      const metaGroupNames: string[] = Array.isArray(meta.groups)
        ? meta.groups.filter((g) => typeof g === "string")
        : [];

      const mdPath = file.path.replace(".json", ".md");
      const mdFile = directory.files.find((f) => f.path === mdPath);
      let articleContent = "";
      let wikilinksPass1: string[] = [];

      if (mdFile) {
        const rawMd = (await mdFile.buffer()).toString("utf-8");
        const bodyMd = rewriteImageRefs(rawMd.replace(/^# .+\n\n/, ""), imagePathMap);
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
      const rawMd = (await file.buffer()).toString("utf-8");
      const slug = file.path.replace(/^articles\//, "").replace(/\.md$/, "");
      const h1 = extractH1(rawMd);
      const title = h1 ?? titleFromSlug(slug);
      const bodyMd = rewriteImageRefs(rawMd.replace(/^# .+\n\n?/, ""), imagePathMap);
      const wikilinksPass2 = extractWikilinks(bodyMd);
      const articleContent = sanitizeArticleHtml(await marked.parse(bodyMd));

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

export default router;
