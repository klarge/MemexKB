import { Router } from "express";
import { db } from "@workspace/db";
import { articlesTable, articleGroupsTable, groupsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { createRequire } from "node:module";
import multer from "multer";
const require = createRequire(import.meta.url);
const archiver = require("archiver") as typeof import("archiver");
import { requireAuth, requireRole } from "../lib/auth";
import { slugify, extractWikilinks } from "../lib/slugify";
import TurndownService from "turndown";
import { articleLinksTable } from "@workspace/db";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
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

router.post("/admin/import", requireAuth, requireRole("admin"), upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded", imported: 0, skipped: 0, errors: [] });
    return;
  }
  const overwrite = req.body.overwrite === "true";

  const unzipper = await import("unzipper");
  const directory = await unzipper.Open.buffer(req.file.buffer);

  // Pre-load all group names for metadata group restore
  const allGroups = await db.select({ id: groupsTable.id, name: groupsTable.name }).from(groupsTable);
  const groupsByName = new Map(allGroups.map((g) => [g.name.toLowerCase(), g.id]));

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  const metaFiles = directory.files.filter((f) => f.path.endsWith(".json") && f.path.includes("articles/") && f.path !== "manifest.json");

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
      const metaGroupNames: string[] = Array.isArray(meta.groups) ? meta.groups.filter((g) => typeof g === "string") : [];

      const mdPath = file.path.replace(".json", ".md");
      const mdFile = directory.files.find((f) => f.path === mdPath);
      let articleContent = "";
      if (mdFile) {
        const rawMd = (await mdFile.buffer()).toString("utf-8");
        articleContent = rawMd.replace(/^# .+\n\n/, "");
      }

      const [existing] = await db.select({ id: articlesTable.id }).from(articlesTable).where(eq(articlesTable.slug, slug)).limit(1);

      let articleId: number;

      if (existing) {
        if (!overwrite) {
          skipped++;
          continue;
        }
        await db.update(articlesTable).set({ title, content: articleContent, updatedAt: new Date() }).where(eq(articlesTable.slug, slug));
        articleId = existing.id;
      } else {
        const [article] = await db.insert(articlesTable).values({ slug, title, content: articleContent }).returning();
        articleId = article.id;
        const wikilinks = extractWikilinks(articleContent);
        if (wikilinks.length > 0) {
          await db.insert(articleLinksTable).values(wikilinks.map((s) => ({ fromArticleId: articleId, toSlug: slugify(s) }))).onConflictDoNothing();
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

      imported++;
    } catch (err) {
      errors.push(`Failed to import ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  res.json({ imported, skipped, errors });
});

export default router;
