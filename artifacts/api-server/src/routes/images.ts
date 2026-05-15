import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { articleImagesTable, articleGroupsTable, groupMembersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, optionalAuth } from "../lib/auth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post("/articles/images", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const { originalname, mimetype, buffer } = req.file;
  const data = buffer.toString("base64");
  const [image] = await db
    .insert(articleImagesTable)
    .values({ filename: originalname, mimeType: mimetype, data })
    .returning();
  const url = `/api/articles/images/${image.id}`;
  res.status(201).json({ url });
});

router.get("/articles/images/:id", optionalAuth, async (req, res) => {
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

  // Enforce group-level access when image is linked to an article
  if (image.articleId) {
    const articleGroups = await db
      .select({ groupId: articleGroupsTable.groupId })
      .from(articleGroupsTable)
      .where(eq(articleGroupsTable.articleId, image.articleId));

    if (articleGroups.length > 0) {
      const articleGroupIds = articleGroups.map((ag) => ag.groupId);
      const userId = req.session.userId;
      const userRole = req.session.userRole;
      const isPrivileged = userRole === "admin" || userRole === "editor";

      if (!isPrivileged) {
        const userGroupIds = userId
          ? (
              await db
                .select({ groupId: groupMembersTable.groupId })
                .from(groupMembersTable)
                .where(eq(groupMembersTable.userId, userId))
            ).map((r) => r.groupId)
          : [];

        const canAccess = articleGroupIds.some((gid) => userGroupIds.includes(gid));
        if (!canAccess) {
          res.status(403).json({ error: "Access denied" });
          return;
        }
      }
    }
  }

  const buf = Buffer.from(image.data, "base64");
  res.setHeader("Content-Type", image.mimeType);
  res.setHeader("Cache-Control", "public, max-age=31536000");
  res.send(buf);
});

export default router;
