import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { articleImagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

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

router.get("/articles/images/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [image] = await db.select().from(articleImagesTable).where(eq(articleImagesTable.id, id)).limit(1);
  if (!image) {
    res.status(404).json({ error: "Image not found" });
    return;
  }
  const buffer = Buffer.from(image.data, "base64");
  res.setHeader("Content-Type", image.mimeType);
  res.setHeader("Cache-Control", "public, max-age=31536000");
  res.send(buffer);
});

export default router;
