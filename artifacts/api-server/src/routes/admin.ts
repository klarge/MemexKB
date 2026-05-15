import { Router } from "express";
import { db } from "@workspace/db";
import { articlesTable, articleGroupsTable, groupsTable } from "@workspace/db";
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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

type ImportResult = "imported" | "skipped";

async function importMarkdownBuffer(
  rawMd: string,
  fileName: string,
  overwrite: boolean,
): Promise<ImportResult> {
  const slug = fileName
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const h1 = extractH1(rawMd);
  const title = h1 ?? titleFromSlug(slug);
  const bodyMd = rawMd.replace(/^# .+\n\n?/, "");
  const wikilinksFromMd = extractWikilinks(bodyMd);
  const parsedHtml = await marked.parse(bodyMd);
  const articleContent = sanitizeArticleHtml(parsedHtml);

  const [existing] = await db
    .select({ id: articlesTable.id })
    .from(articlesTable)
    .where(eq(articlesTable.slug, slug))
    .limit(1);

  if (existing) {
    if (!overwrite) return "skipped";
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
    return "imported";
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
  return "imported";
}
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

router.get("/admin/export", requireAuth, requireRole("admin"), async (_req, res) => {
  const articles = await db.select().from(articlesTable);
  const allGroups = await db.select().from(articleGroupsTable);
  const groups = await db.select().from(groupsTable);
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="knowledge-base-export.zip"');

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res);

  for (const article of articles) {
    const articleGroupIds = allGroups.filter((ag) => ag.articleId === article.id).map((ag) => ag.groupId);
    const articleGroups = articleGroupIds.map((gid) => groupMap.get(gid)?.name).filter(Boolean);
    const markdown = `# ${article.title}\n\n${turndown.turndown(article.content)}`;
    archive.append(markdown, { name: `articles/${article.slug}.md` });

    const meta = {
      slug: article.slug,
      title: article.title,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      groups: articleGroups,
    };
    archive.append(JSON.stringify(meta, null, 2), { name: `articles/${article.slug}.json` });
  }

  const manifest = { exportedAt: new Date(), articleCount: articles.length };
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  await archive.finalize();
});

/** Derive a human-readable title from a markdown filename (slug). */
function titleFromSlug(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extract the first H1 heading from raw markdown, if present. */
function extractH1(md: string): string | null {
  const match = /^# (.+)$/m.exec(md);
  return match ? match[1].trim() : null;
}

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

  // --- Multi-file .md folder import ---
  if (!zipFile && mdFiles.length > 0) {
    for (const f of mdFiles) {
      try {
        const result = await importMarkdownBuffer(f.buffer.toString("utf-8"), f.originalname, overwrite);
        if (result === "imported") imported++;
        else skipped++;
      } catch (err) {
        errors.push(`Failed to import ${f.originalname}: ${err instanceof Error ? err.message : String(err)}`);
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

  // Pre-load all group names for metadata group restore
  const allGroups = await db.select({ id: groupsTable.id, name: groupsTable.name }).from(groupsTable);
  const groupsByName = new Map(allGroups.map((g) => [g.name.toLowerCase(), g.id]));

  // --- Pass 1: process JSON+MD pairs (full metadata, including group assignments) ---
  const metaFiles = directory.files.filter(
    (f) => f.path.endsWith(".json") && f.path.includes("articles/") && f.path !== "manifest.json"
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
        const bodyMd = rawMd.replace(/^# .+\n\n/, "");
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
        // Refresh backlinks for overwritten article
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

      // Restore group assignments from metadata
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

  // --- Pass 2: process markdown-only files that have no companion JSON ---
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
      const bodyMd = rawMd.replace(/^# .+\n\n?/, "");
      const wikilinksPass2 = extractWikilinks(bodyMd);
      const articleContent = sanitizeArticleHtml(await marked.parse(bodyMd));

      const [existing] = await db
        .select({ id: articlesTable.id })
        .from(articlesTable)
        .where(eq(articlesTable.slug, slug))
        .limit(1);

      if (existing) {
        if (!overwrite) {
          skipped++;
          continue;
        }
        await db
          .update(articlesTable)
          .set({ title, content: articleContent, updatedAt: new Date() })
          .where(eq(articlesTable.slug, slug));
        // Refresh backlinks for overwritten article
        await db.delete(articleLinksTable).where(eq(articleLinksTable.fromArticleId, existing.id));
        if (wikilinksPass2.length > 0) {
          await db
            .insert(articleLinksTable)
            .values(wikilinksPass2.map((s) => ({ fromArticleId: existing.id, toSlug: slugify(s) })))
            .onConflictDoNothing();
        }
      } else {
        const [article] = await db
          .insert(articlesTable)
          .values({ slug, title, content: articleContent })
          .returning();
        if (wikilinksPass2.length > 0) {
          await db
            .insert(articleLinksTable)
            .values(wikilinksPass2.map((s) => ({ fromArticleId: article.id, toSlug: slugify(s) })))
            .onConflictDoNothing();
        }
      }

      imported++;
    } catch (err) {
      errors.push(`Failed to import ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  res.json({ imported, skipped, errors });
});

export default router;
