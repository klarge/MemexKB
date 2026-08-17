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
    .where(inArray(siteSettingsTable.key, ["site_name", "logo_mime_type", "nav_links", "log_entries_enabled", "tasks_enabled", "projects_enabled"]));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  res.json({
    siteName: map.get("site_name") ?? "Memex",
    hasLogo: map.has("logo_mime_type"),
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
    .where(inArray(siteSettingsTable.key, ["site_name", "logo_mime_type", "nav_links", "log_entries_enabled", "tasks_enabled", "projects_enabled"]));
  const map = new Map(rows.map((r) => [r.key, r.value]));
  res.json({
    siteName: map.get("site_name") ?? "Memex",
    hasLogo: map.has("logo_mime_type"),
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
    res.status(400).json({ error: "Unsupported file type. Use JPEG, PNG, GIF, WebP, or SVG." });
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

export default router;
