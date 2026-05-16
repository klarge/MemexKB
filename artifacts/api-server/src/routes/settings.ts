import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { siteSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireRole } from "../lib/auth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const ALLOWED_LOGO_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"]);

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.key, key))
    .limit(1);
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(siteSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: siteSettingsTable.key, set: { value } });
}

async function deleteSetting(key: string): Promise<void> {
  await db.delete(siteSettingsTable).where(eq(siteSettingsTable.key, key));
}

// ── Public: basic branding info (name + whether a logo exists) ────────────────

router.get("/settings", async (_req, res) => {
  const rows = await db
    .select()
    .from(siteSettingsTable)
    .where(inArray(siteSettingsTable.key, ["site_name", "logo_mime_type"]));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  res.json({
    siteName: map.get("site_name") ?? "Lexikon",
    hasLogo: map.has("logo_mime_type"),
  });
});

// ── Public: serve the logo image ──────────────────────────────────────────────

router.get("/settings/logo", async (_req, res) => {
  const [dataRow, mimeRow] = await Promise.all([
    getSetting("logo_data"),
    getSetting("logo_mime_type"),
  ]);
  if (!dataRow || !mimeRow) {
    res.status(404).json({ error: "No logo configured" });
    return;
  }
  const buf = Buffer.from(dataRow, "base64");
  res.setHeader("Content-Type", mimeRow);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(buf);
});

// ── Admin: read full settings ──────────────────────────────────────────────────

router.get("/admin/settings", requireRole("admin"), async (_req, res) => {
  const rows = await db
    .select()
    .from(siteSettingsTable)
    .where(inArray(siteSettingsTable.key, ["site_name", "logo_mime_type"]));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  res.json({
    siteName: map.get("site_name") ?? "Lexikon",
    hasLogo: map.has("logo_mime_type"),
  });
});

// ── Admin: update site name ───────────────────────────────────────────────────

router.patch("/admin/settings", requireRole("admin"), async (req, res) => {
  const { siteName } = req.body as { siteName?: string };
  if (typeof siteName !== "string" || !siteName.trim()) {
    res.status(400).json({ error: "siteName is required and must be a non-empty string" });
    return;
  }
  const trimmed = siteName.trim().slice(0, 100);
  await setSetting("site_name", trimmed);
  res.json({ siteName: trimmed });
});

// ── Admin: upload logo ────────────────────────────────────────────────────────

router.post("/admin/settings/logo", requireRole("admin"), upload.single("logo"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const { mimetype, buffer } = req.file;
  if (!ALLOWED_LOGO_TYPES.has(mimetype)) {
    res.status(400).json({ error: "Unsupported file type. Use JPEG, PNG, GIF, WebP, or SVG." });
    return;
  }
  await Promise.all([
    setSetting("logo_data", buffer.toString("base64")),
    setSetting("logo_mime_type", mimetype),
  ]);
  res.json({ hasLogo: true });
});

// ── Admin: remove logo ────────────────────────────────────────────────────────

router.delete("/admin/settings/logo", requireRole("admin"), async (_req, res) => {
  await Promise.all([
    deleteSetting("logo_data"),
    deleteSetting("logo_mime_type"),
  ]);
  res.json({ hasLogo: false });
});

export default router;
