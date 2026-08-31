import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import {
  articleImagesTable,
  articleGroupsTable,
  articlesTable,
  groupMembersTable,
  projectGroupsTable,
  projectsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

router.post("/articles/images", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const { originalname, mimetype, buffer } = req.file;

  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimetype)) {
    res.status(400).json({ error: "Only JPEG, PNG, GIF, and WebP images are allowed" });
    return;
  }

  const data = buffer.toString("base64");
  const [image] = await db
    .insert(articleImagesTable)
    .values({ filename: originalname, mimeType: mimetype, data, uploadedById: req.session.userId })
    .returning();
  const url = `/api/articles/images/${image.id}`;
  res.status(201).json({ url });
});

router.get("/articles/images/:id", requireAuth, async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid image id" });
    return;
  }

  const [image] = await db
    .select()
    .from(articleImagesTable)
    .where(eq(articleImagesTable.id, id))
    .limit(1);

  if (!image) {
    res.status(404).json({ error: "Image not found" });
    return;
  }

  const userId = req.session.userId!;
  const userRole = req.session.userRole;

  // Before an upload is attached to an article, only its uploader or an
  // administrator may preview it.
  if (!image.articleId && userRole !== "admin" && image.uploadedById !== userId) {
    res.status(404).json({ error: "Image not found" });
    return;
  }

  if (image.articleId) {
    const [article] = await db
      .select({
        id: articlesTable.id,
        visibility: articlesTable.visibility,
        createdById: articlesTable.createdById,
        isLogEntry: articlesTable.isLogEntry,
        projectId: articlesTable.projectId,
      })
      .from(articlesTable)
      .where(eq(articlesTable.id, image.articleId))
      .limit(1);
    if (!article) {
      res.status(404).json({ error: "Image not found" });
      return;
    }

    let canAccess = userRole === "admin" || article.createdById === userId;
    if (!canAccess && article.isLogEntry) {
      canAccess = false;
    } else if (!canAccess && article.projectId !== null) {
      const [project] = await db
        .select({ createdById: projectsTable.createdById })
        .from(projectsTable)
        .where(eq(projectsTable.id, article.projectId))
        .limit(1);
      if (project?.createdById === userId) {
        canAccess = true;
      } else {
        const userGroups = await db
          .select({ groupId: groupMembersTable.groupId })
          .from(groupMembersTable)
          .where(eq(groupMembersTable.userId, userId));
        if (userGroups.length > 0) {
          const shared = await db
            .select({ projectId: projectGroupsTable.projectId })
            .from(projectGroupsTable)
            .where(and(
              eq(projectGroupsTable.projectId, article.projectId),
              inArray(projectGroupsTable.groupId, userGroups.map((group) => group.groupId)),
            ))
            .limit(1);
          canAccess = shared.length > 0;
        }
      }
    } else if (!canAccess && article.visibility === "public") {
      canAccess = true;
    } else if (!canAccess && article.visibility === "group") {
    const articleGroups = await db
      .select({ groupId: articleGroupsTable.groupId })
      .from(articleGroupsTable)
      .where(eq(articleGroupsTable.articleId, image.articleId));
      const userGroups = await db
        .select({ groupId: groupMembersTable.groupId })
        .from(groupMembersTable)
        .where(eq(groupMembersTable.userId, userId));
      const userGroupIds = new Set(userGroups.map((group) => group.groupId));
      canAccess = articleGroups.some((group) => userGroupIds.has(group.groupId));
    }

    if (!canAccess) {
      res.status(404).json({ error: "Image not found" });
      return;
    }
  }

  const safeType = ALLOWED_IMAGE_MIME_TYPES.has(image.mimeType) ? image.mimeType : "application/octet-stream";
  const buf = Buffer.from(image.data, "base64");
  res.setHeader("Content-Type", safeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Cookie, Authorization");
  res.send(buf);
});

export default router;
