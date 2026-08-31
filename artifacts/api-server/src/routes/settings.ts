import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { siteSettingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireRole } from "../lib/auth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// SVG is intentionally excluded: inline scripts in SVG execute when the file is
// served with its own content type, making it an XSS vector.
const ALLOWED_LOGO_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const ALLOWED_FAVICON_TYPES = new Set([
  "image/png",
  "image/gif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "application/ico",
]);

/**
 * Validate image magic bytes to confirm the file content matches its declared
 * MIME type.  Rejects files that claim to be images but are not.
 */
function validateImageMagicBytes(buf: Buffer, mimetype: string): boolean {
  if (buf.length < 12) return false;
  switch (mimetype) {
    case "image/jpeg":
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "image/png":
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    case "image/gif":
      return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
    case "image/webp":
      // RIFF....WEBP
      return (
        buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
      );
    default:
      return false;
  }
}

function validateFaviconMagicBytes(buf: Buffer, mimetype: string): boolean {
  if (mimetype === "image/png") {
    return buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
  }
  if (mimetype === "image/gif") {
    return buf.length >= 6 && buf.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/) !== null;
  }
  if (mimetype === "image/x-icon" || mimetype === "image/vnd.microsoft.icon" || mimetype === "application/ico") {
    return buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00;
  }
  return false;
}

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

// ── Public: basic branding info (name, logo, nav links) ──────────────────────

function parseNavLinks(raw: string | undefined): { id: string; label: string; url: string }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }
  return [];
}

router.get("/settings", async (_req, res) => {
  const rows = await db
    .select()
    .from(siteSettingsTable)
    .where(inArray(siteSettingsTable.key, ["site_name", "logo_mime_type", "favicon_mime_type", "favicon_version", "nav_links", "log_entries_enabled", "tasks_enabled", "projects_enabled"]));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  res.json({
    siteName: map.get("site_name") ?? "Memex",
    hasLogo: map.has("logo_mime_type"),
    hasFavicon: map.has("favicon_mime_type"),
    faviconMimeType: map.get("favicon_mime_type") ?? null,
    faviconVersion: map.get("favicon_version") ?? null,
    navLinks: parseNavLinks(map.get("nav_links")),
    logEntriesEnabled: map.get("log_entries_enabled") !== "false",
    tasksEnabled: map.get("tasks_enabled") !== "false",
    projectsEnabled: map.get("projects_enabled") !== "false",
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
    .where(inArray(siteSettingsTable.key, ["site_name", "logo_mime_type", "favicon_mime_type", "favicon_version", "nav_links", "log_entries_enabled", "tasks_enabled", "projects_enabled"]));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  res.json({
    siteName: map.get("site_name") ?? "Memex",
    hasLogo: map.has("logo_mime_type"),
    hasFavicon: map.has("favicon_mime_type"),
    faviconMimeType: map.get("favicon_mime_type") ?? null,
    faviconVersion: map.get("favicon_version") ?? null,
    navLinks: parseNavLinks(map.get("nav_links")),
    logEntriesEnabled: map.get("log_entries_enabled") !== "false",
    tasksEnabled: map.get("tasks_enabled") !== "false",
    projectsEnabled: map.get("projects_enabled") !== "false",
  });
});

// ── Admin: update settings ────────────────────────────────────────────────────

router.patch("/admin/settings", requireRole("admin"), async (req, res) => {
  const { siteName, logEntriesEnabled, tasksEnabled, projectsEnabled } = req.body as {
    siteName?: string;
    logEntriesEnabled?: boolean;
    tasksEnabled?: boolean;
    projectsEnabled?: boolean;
  };

  if (siteName !== undefined) {
    if (typeof siteName !== "string" || !siteName.trim()) {
      res.status(400).json({ error: "siteName must be a non-empty string" });
      return;
    }
    await setSetting("site_name", siteName.trim().slice(0, 100));
  }

  if (logEntriesEnabled !== undefined) {
    await setSetting("log_entries_enabled", String(Boolean(logEntriesEnabled)));
  }

  if (tasksEnabled !== undefined) {
    await setSetting("tasks_enabled", String(Boolean(tasksEnabled)));
  }

  if (projectsEnabled !== undefined) {
    await setSetting("projects_enabled", String(Boolean(projectsEnabled)));
  }

  res.json({ ok: true });
});

// ── Admin: upload logo ────────────────────────────────────────────────────────

router.post("/admin/settings/logo", requireRole("admin"), upload.single("logo"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const { mimetype, buffer } = req.file;
  if (!ALLOWED_LOGO_TYPES.has(mimetype)) {
    res.status(400).json({ error: "Unsupported file type. Use JPEG, PNG, GIF, or WebP." });
    return;
  }
  if (!validateImageMagicBytes(buffer, mimetype)) {
    res.status(400).json({ error: "File content does not match the declared image type." });
    return;
  }
  await Promise.all([
    setSetting("logo_data", buffer.toString("base64")),
    setSetting("logo_mime_type", mimetype),
  ]);
  res.json({ hasLogo: true });
});

// ── Admin: save nav links ─────────────────────────────────────────────────────

router.put("/admin/settings/nav-links", requireRole("admin"), async (req, res) => {
  const { links } = req.body as { links?: unknown };
  if (!Array.isArray(links)) {
    res.status(400).json({ error: "links must be an array" });
    return;
  }
  const validated = links
    .filter((l): l is { id: string; label: string; url: string } =>
      l !== null &&
      typeof l === "object" &&
      typeof (l as Record<string, unknown>).id === "string" &&
      typeof (l as Record<string, unknown>).label === "string" &&
      typeof (l as Record<string, unknown>).url === "string",
    )
    .map((l) => ({
      id: l.id.trim(),
      label: l.label.trim().slice(0, 100),
      url: l.url.trim().slice(0, 500),
    }))
    .filter((l) => l.label && l.url);

  await setSetting("nav_links", JSON.stringify(validated));
  res.json({ navLinks: validated });
});

// ── Admin: remove logo ────────────────────────────────────────────────────────

router.delete("/admin/settings/logo", requireRole("admin"), async (_req, res) => {
  await Promise.all([
    deleteSetting("logo_data"),
    deleteSetting("logo_mime_type"),
  ]);
  res.json({ hasLogo: false });
});

// ── Favicon ────────────────────────────────────────────────────────────────────

router.get("/settings/favicon", async (_req, res) => {
  const [dataRow, mimeRow] = await Promise.all([
    getSetting("favicon_data"),
    getSetting("favicon_mime_type"),
  ]);
  if (!dataRow || !mimeRow || !ALLOWED_FAVICON_TYPES.has(mimeRow)) {
    res.status(404).json({ error: "No favicon configured" });
    return;
  }
  const buf = Buffer.from(dataRow, "base64");
  res.setHeader("Content-Type", mimeRow);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(buf);
});

router.post("/admin/settings/favicon", requireRole("admin"), upload.single("favicon"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No favicon uploaded" });
    return;
  }
  const { mimetype, buffer } = req.file;
  if (!ALLOWED_FAVICON_TYPES.has(mimetype)) {
    res.status(400).json({ error: "Unsupported favicon type. Use PNG, GIF, or ICO." });
    return;
  }
  if (buffer.length > 1024 * 1024) {
    res.status(400).json({ error: "Favicon must be 1 MB or smaller." });
    return;
  }
  if (!validateFaviconMagicBytes(buffer, mimetype)) {
    res.status(400).json({ error: "File content does not match the declared favicon type." });
    return;
  }
  await Promise.all([
    setSetting("favicon_data", buffer.toString("base64")),
    setSetting("favicon_mime_type", mimetype),
    setSetting("favicon_version", `${Date.now()}`),
  ]);
  res.json({ hasFavicon: true });
});

router.delete("/admin/settings/favicon", requireRole("admin"), async (_req, res) => {
  await Promise.all([
    deleteSetting("favicon_data"),
    deleteSetting("favicon_mime_type"),
    deleteSetting("favicon_version"),
  ]);
  res.json({ hasFavicon: false });
});

export default router;
