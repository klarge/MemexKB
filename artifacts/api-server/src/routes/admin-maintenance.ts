import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "@workspace/db";
import { requireAuth, requireRole } from "../lib/auth";
import {
  ListAdminMediaQueryParams, ListAdminMediaResponse, PreviewAdminMediaCleanupResponse,
  CleanupAdminMediaBody, CleanupAdminMediaResponse,
} from "@workspace/api-zod";
import {
  inspectMedia, fingerprintImages, cleanupMedia, MediaMaintenanceBusy, type MediaCleanupCandidate,
} from "../lib/media-maintenance";
import { MEDIA_GRACE_DAYS } from "../lib/media-usage";

declare module "express-session" {
  interface SessionData {
    mediaCleanupPreview?: {
      id: string; actorId: number; expiresAt: number; previewedAt: string;
      candidates: MediaCleanupCandidate[];
    };
  }
}

const router = Router();
router.use("/admin/media", requireAuth, requireRole("admin"));
router.use("/admin/media", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

router.get("/admin/media", async (req, res): Promise<void> => {
  const parsed = ListAdminMediaQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid media filters" }); return; }
  const { status = "all", search = "", offset = 0, limit = 20 } = parsed.data;
  const { images, summary } = await db.transaction(tx => inspectMedia(tx), { isolationLevel: "repeatable read" });
  const filtered = images.filter(image => (status === "all" || image.status === status) &&
    image.filename.toLowerCase().includes(search.toLowerCase().trim()));
  res.json(ListAdminMediaResponse.parse({ images: filtered.slice(offset, offset + limit), total: filtered.length, summary }));
});

router.post("/admin/media/cleanup-preview", async (req, res): Promise<void> => {
  const previewedAt = new Date();
  const preview = await db.transaction(async tx => {
    const { images, summary } = await inspectMedia(tx, previewedAt);
    const eligible = images.filter(image => image.status === "unused");
    if (eligible.length > 10_000) return null;
    return { candidates: await fingerprintImages(tx, eligible), reclaimableBytes: summary.unusedBytes };
  }, { isolationLevel: "repeatable read" });
  if (!preview) { res.status(409).json({ error: "Too many unused images for one cleanup preview (maximum 10,000)." }); return; }
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const previewId = randomUUID();
  req.session.mediaCleanupPreview = {
    id: previewId, actorId: req.session.userId!, expiresAt, previewedAt: previewedAt.toISOString(),
    candidates: preview.candidates,
  };
  await new Promise<void>((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
  res.json(PreviewAdminMediaCleanupResponse.parse({
    previewId, count: preview.candidates.length, reclaimableBytes: preview.reclaimableBytes,
    expiresAt: new Date(expiresAt).toISOString(), gracePeriodDays: MEDIA_GRACE_DAYS,
  }));
});

router.post("/admin/media/cleanup", async (req, res): Promise<void> => {
  const parsed = CleanupAdminMediaBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Confirm with "DELETE UNUSED MEDIA" and a valid previewId.' }); return; }
  const preview = req.session.mediaCleanupPreview;
  if (!preview || preview.id !== parsed.data.previewId || preview.actorId !== req.session.userId || preview.expiresAt <= Date.now()) {
    res.status(409).json({ error: "Cleanup preview expired or unavailable. Preview again before deleting." }); return;
  }
  // Persist consumption first: a session-store failure must not follow a deletion.
  delete req.session.mediaCleanupPreview;
  await new Promise<void>((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
  try {
    const result = await cleanupMedia(preview.candidates, new Date(preview.previewedAt));
    res.json(CleanupAdminMediaResponse.parse(result));
  } catch (error) {
    // Drizzle wraps the PostgreSQL lock error in cause.
    const code = (error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
    if (error instanceof MediaMaintenanceBusy || code === "55P03" || code === "40P01") {
      res.status(409).json({ error: "Content is being updated. Nothing was deleted; preview again and retry." }); return;
    }
    throw error;
  }
});

export default router;
