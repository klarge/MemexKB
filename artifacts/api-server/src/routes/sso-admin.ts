import { Router } from "express";
import { db } from "@workspace/db";
import { ssoConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../lib/auth";

const router = Router();

// List all SSO configs (admin)
router.get("/admin/sso", requireRole("admin"), async (_req, res) => {
  const configs = await db
    .select()
    .from(ssoConfigsTable)
    .orderBy(ssoConfigsTable.id);
  // Redact secrets before returning
  const safe = configs.map((c) => ({
    ...c,
    config: redactSecrets(c.provider, c.config as Record<string, string>),
  }));
  res.json(safe);
});

// Create SSO config (admin)
router.post("/admin/sso", requireRole("admin"), async (req, res) => {
  const { provider, name, enabled, config } = req.body;
  if (!provider || !name || !config) {
    res.status(400).json({ error: "provider, name, and config are required" });
    return;
  }
  if (provider !== "saml" && provider !== "oidc") {
    res.status(400).json({ error: "provider must be 'saml' or 'oidc'" });
    return;
  }
  const validationError = validateConfig(provider, config);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  const [row] = await db
    .insert(ssoConfigsTable)
    .values({ provider, name, enabled: !!enabled, config })
    .returning();
  res.status(201).json({
    ...row,
    config: redactSecrets(row.provider, row.config as Record<string, string>),
  });
});

// Update SSO config (admin)
router.patch("/admin/sso/:id", requireRole("admin"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const { name, enabled, config } = req.body;

  const [existing] = await db
    .select()
    .from(ssoConfigsTable)
    .where(eq(ssoConfigsTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "SSO config not found" });
    return;
  }

  const mergedConfig = config
    ? mergeConfig(existing.provider, existing.config as Record<string, string>, config)
    : (existing.config as Record<string, string>);

  if (config) {
    const validationError = validateConfig(existing.provider, mergedConfig);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (enabled !== undefined) updates.enabled = !!enabled;
  if (config !== undefined) updates.config = mergedConfig;

  const [row] = await db
    .update(ssoConfigsTable)
    .set(updates)
    .where(eq(ssoConfigsTable.id, id))
    .returning();

  res.json({
    ...row,
    config: redactSecrets(row.provider, row.config as Record<string, string>),
  });
});

// Delete SSO config (admin)
router.delete("/admin/sso/:id", requireRole("admin"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  const deleted = await db
    .delete(ssoConfigsTable)
    .where(eq(ssoConfigsTable.id, id))
    .returning();
  if (!deleted.length) {
    res.status(404).json({ error: "SSO config not found" });
    return;
  }
  res.json({ message: "SSO config deleted" });
});

// Public: list enabled providers for login page
router.get("/auth/providers", async (_req, res) => {
  const configs = await db
    .select({
      id: ssoConfigsTable.id,
      name: ssoConfigsTable.name,
      provider: ssoConfigsTable.provider,
    })
    .from(ssoConfigsTable)
    .where(eq(ssoConfigsTable.enabled, true))
    .orderBy(ssoConfigsTable.id);
  res.json(configs);
});

// ── helpers ──────────────────────────────────────────────────────────────────

const SAML_REQUIRED = ["entryPoint", "idpCert", "issuer"];
const OIDC_REQUIRED = ["issuerUrl", "clientId", "clientSecret"];

function validateConfig(provider: string, config: Record<string, string>): string | null {
  const required = provider === "saml" ? SAML_REQUIRED : OIDC_REQUIRED;
  for (const key of required) {
    if (!config[key]) return `${key} is required for ${provider}`;
  }
  return null;
}

const SECRET_KEYS = new Set(["idpCert", "clientSecret"]);
const PLACEHOLDER = "••••••••";

function redactSecrets(
  _provider: string,
  config: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] = SECRET_KEYS.has(k) && v ? PLACEHOLDER : v;
  }
  return out;
}

/** Merge incoming partial config, keeping existing secret values when
 *  the client sends back the placeholder (i.e. the admin didn't change them). */
function mergeConfig(
  _provider: string,
  existing: Record<string, string>,
  incoming: Record<string, string>
): Record<string, string> {
  const merged = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (SECRET_KEYS.has(k) && v === PLACEHOLDER) continue; // keep existing
    merged[k] = v;
  }
  return merged;
}

export default router;
