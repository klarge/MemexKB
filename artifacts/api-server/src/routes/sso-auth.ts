import { Router } from "express";
import { accessibleProjectIds, enqueueNotification } from "../lib/notification-events";
import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { ssoConfigsTable, usersTable, groupMembersTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { SSO_ONLY_PASSWORD_HASH } from "../lib/login-mode";
import { frontendUrl } from "../lib/frontend-url";
import { pendingMobile, tokenHash, validToken, mobileSamlCache, completeMobile, establishSsoSession, MOBILE_CALLBACK } from "../lib/mobile-sso";
import type { MobileSso } from "@workspace/db";
import type { Response } from "express";
import { ValidateInResponseTo } from "@node-saml/node-saml";

const router = Router();

function mobileError(res: Response, pending: MobileSso | null) {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  if (pending) res.redirect(`${MOBILE_CALLBACK}?error=sso_failed&state=${pending.state}`);
  else res.status(400).send("Sign-in expired or cancelled. Return to Memex and try again.");
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function getEnabledConfig(id: number) {
  const [row] = await db
    .select()
    .from(ssoConfigsTable)
    .where(and(eq(ssoConfigsTable.id, id), eq(ssoConfigsTable.enabled, true)))
    .limit(1);
  return row ?? null;
}

/** Find user by email or create them (JIT provisioning). */
export async function provisionUser(email: string, name: string, ssoProvider: string, ssoId: string) {
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  if (existing) {
    // Update SSO linkage if not set
    if (!existing.ssoProvider) {
      await db
        .update(usersTable)
        .set({ ssoProvider, ssoId, updatedAt: new Date() })
        .where(eq(usersTable.id, existing.id));
    }
    return existing;
  }

  // New SSO identities are explicitly restricted; existing choices above are preserved.
  const [created] = await db
    .insert(usersTable)
    .values({
      email: email.toLowerCase(),
      name: name || email.split("@")[0],
      passwordHash: SSO_ONLY_PASSWORD_HASH,
      ssoOnly: true,
      role: "user",
      ssoProvider,
      ssoId,
    })
    .returning();
  return created;
}

/**
 * Sync a SAML user's group memberships.
 * Only the groups referenced in groupMappings are touched; all other group
 * memberships are left alone. On each login the memberships are reconciled:
 * - added if the IdP now asserts the attribute value
 * - removed if the IdP no longer asserts it
 */
async function syncSamlGroups(
  userId: number,
  samlValues: string[],
  groupMappings: Record<string, string>,
) {
  // Resolve which Memex group IDs the user should be in
  const targetIds = new Set<number>();
  for (const val of samlValues) {
    const raw = groupMappings[val];
    if (raw) {
      const n = parseInt(raw, 10);
      if (!isNaN(n)) targetIds.add(n);
    }
  }

  // All group IDs referenced by the mapping (the ones we manage)
  const managedIds = Object.values(groupMappings)
    .map((v) => parseInt(v, 10))
    .filter((n) => !isNaN(n));

  if (managedIds.length === 0) return;

  // Current memberships within the managed set
  const currentRows = await db
    .select({ groupId: groupMembersTable.groupId })
    .from(groupMembersTable)
    .where(
      and(
        eq(groupMembersTable.userId, userId),
        inArray(groupMembersTable.groupId, managedIds),
      ),
    );

  const currentIds = new Set(currentRows.map((r) => r.groupId));

  // Add new memberships
  const toAdd = [...targetIds].filter((id) => !currentIds.has(id));
  const previousProjects = toAdd.length ? new Set(await accessibleProjectIds(userId)) : new Set<number>();
  if (toAdd.length > 0) {
    await db
      .insert(groupMembersTable)
      .values(toAdd.map((groupId) => ({ groupId, userId })))
      .onConflictDoNothing();
  }

  // Remove stale memberships (IdP no longer asserts this group)
  const toRemove = [...currentIds].filter((id) => !targetIds.has(id));
  if (toRemove.length > 0) {
    await db
      .delete(groupMembersTable)
      .where(
        and(
          eq(groupMembersTable.userId, userId),
          inArray(groupMembersTable.groupId, toRemove),
        ),
      );
  }
  if (toAdd.length) for (const projectId of await accessibleProjectIds(userId)) {
    if (!previousProjects.has(projectId)) await enqueueNotification("projectAdded", userId, projectId);
  }
}

// ── SAML ─────────────────────────────────────────────────────────────────────

/** Public SAML SP metadata endpoint — paste this URL into your IdP. */
router.get("/auth/saml/:id/metadata", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  // Metadata is useful even before the provider is enabled, so query without the enabled filter
  const [row] = await db
    .select()
    .from(ssoConfigsTable)
    .where(and(eq(ssoConfigsTable.id, id), eq(ssoConfigsTable.provider, "saml")))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "SAML provider not found" });
    return;
  }

  try {
    const cfg = row.config as Record<string, string>;
    const { SAML } = await import("@node-saml/node-saml");
    const saml = new SAML({
      entryPoint: cfg.entryPoint || "https://placeholder.example.com",
      issuer: cfg.issuer ?? frontendUrl(req),
      idpCert: cfg.idpCert || "placeholder",
      callbackUrl: `${frontendUrl(req)}/api/auth/saml/${id}/callback`,
    });
    const xml = saml.generateServiceProviderMetadata(null, null);
    res.set("Content-Type", "application/xml; charset=utf-8");
    res.send(xml);
  } catch (err) {
    console.error("SAML metadata error", err);
    res.status(500).json({ error: "Failed to generate metadata" });
  }
});

router.get("/auth/saml/:id/login", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = await getEnabledConfig(id);
  if (!row || row.provider !== "saml") {
    res.status(404).json({ error: "SSO provider not found" });
    return;
  }

  const mobile = req.query.mobile;
  const pending = validToken(mobile) ? await pendingMobile(tokenHash(mobile), id) : null;
  if (mobile !== undefined && !pending) { mobileError(res, null); return; }
  try {
    const cfg = row.config as Record<string, string>;
    const { SAML } = await import("@node-saml/node-saml");
    const saml = new SAML({
      entryPoint: cfg.entryPoint,
      issuer: cfg.issuer ?? frontendUrl(req),
      idpCert: cfg.idpCert,
      callbackUrl: `${frontendUrl(req)}/api/auth/saml/${id}/callback`,
      ...(pending ? { validateInResponseTo: ValidateInResponseTo.always, cacheProvider: mobileSamlCache(pending), forceAuthn: true } : {}),
    });
    const url = await saml.getAuthorizeUrlAsync(pending ? `memex.${mobile}` : "", req.headers.host ?? "", {});
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    res.redirect(url);
  } catch (err) {
    console.error("SAML login error", err);
    if (mobile !== undefined) { mobileError(res, pending); return; }
    res.redirect(`/login?error=saml_config`);
  }
});

router.post("/auth/saml/:id/callback", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = await getEnabledConfig(id);
  if (!row || row.provider !== "saml") {
    res.status(404).json({ error: "SSO provider not found" });
    return;
  }

  const relay = req.body?.RelayState;
  const mobile = typeof relay === "string" && relay.startsWith("memex.") ? relay.slice(6) : undefined;
  const pending = validToken(mobile) ? await pendingMobile(tokenHash(mobile), id) : null;
  if (mobile !== undefined && !pending) { mobileError(res, null); return; }
  try {
    const cfg = row.config as Record<string, string>;
    const { SAML } = await import("@node-saml/node-saml");
    const saml = new SAML({
      entryPoint: cfg.entryPoint,
      issuer: cfg.issuer ?? frontendUrl(req),
      idpCert: cfg.idpCert,
      callbackUrl: `${frontendUrl(req)}/api/auth/saml/${id}/callback`,
      ...(pending ? { validateInResponseTo: ValidateInResponseTo.always, cacheProvider: mobileSamlCache(pending) } : {}),
    });
    const { profile } = await saml.validatePostResponseAsync(req.body);

    const email =
      (profile as Record<string, unknown>)["email"] as string ||
      (profile as Record<string, unknown>)["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] as string ||
      profile?.nameID as string;
    const name =
      (profile as Record<string, unknown>)["displayName"] as string ||
      (profile as Record<string, unknown>)["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] as string ||
      email;

    if (!email) {
      if (pending) { mobileError(res, pending); return; }
      res.redirect(`/login?error=saml_no_email`);
      return;
    }

    const user = await provisionUser(email, name, "saml", profile?.nameID as string ?? email);

    // Sync SAML group memberships
    if (cfg.groupAttributeName && cfg.groupMappings) {
      try {
        const mappings = JSON.parse(cfg.groupMappings) as Record<string, string>;
        const rawAttr = (profile as Record<string, unknown>)[cfg.groupAttributeName];
        const attrValues = Array.isArray(rawAttr)
          ? rawAttr.map(String)
          : rawAttr
            ? [String(rawAttr)]
            : [];
        await syncSamlGroups(user.id, attrValues, mappings);
      } catch (e) {
        console.error("SAML group sync error", e);
      }
    }

    if (pending) { await completeMobile(pending, user.id, res); return; }
    await establishSsoSession(req, user);
    res.redirect("/");
  } catch (err) {
    console.error("SAML callback error", err);
    if (mobile !== undefined) { mobileError(res, pending); return; }
    res.redirect(`/login?error=saml_failed`);
  }
});

// ── OIDC ─────────────────────────────────────────────────────────────────────

router.get("/auth/oidc/:id/login", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = await getEnabledConfig(id);
  if (!row || row.provider !== "oidc") {
    res.status(404).json({ error: "SSO provider not found" });
    return;
  }

  const mobile = req.query.mobile;
  const pending = validToken(mobile) ? await pendingMobile(tokenHash(mobile), id) : null;
  if (mobile !== undefined && !pending) { mobileError(res, null); return; }
  try {
    const cfg = row.config as Record<string, string>;
    const redirectUri = `${frontendUrl(req)}/api/auth/oidc/${id}/callback`;

    const { Issuer, generators } = await import("openid-client");
    const issuer = await Issuer.discover(cfg.issuerUrl);
    const client = new issuer.Client({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uris: [redirectUri],
      response_types: ["code"],
    });

    const state = generators.state();
    const nonce = generators.nonce();
    const scope = cfg.scope || "openid email profile";

    req.session.oidcPending = { state, nonce, providerId: id, ...(pending ? { mobileTicketHash: pending.ticketHash } : {}) };
    await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));

    const url = client.authorizationUrl({ scope, state, nonce, redirect_uri: redirectUri, ...(pending ? { prompt: "select_account" } : {}) });
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    res.redirect(url);
  } catch (err) {
    console.error("OIDC login error", err);
    if (mobile !== undefined) { mobileError(res, pending); return; }
    res.redirect(`/login?error=oidc_config`);
  }
});

router.get("/auth/oidc/:id/callback", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = await getEnabledConfig(id);
  if (!row || row.provider !== "oidc") {
    res.status(404).json({ error: "SSO provider not found" });
    return;
  }

  const pending = req.session.oidcPending;
  if (!pending || pending.providerId !== id) {
    res.redirect(`/login?error=oidc_state`);
    return;
  }

  const native = pending.mobileTicketHash ? await pendingMobile(pending.mobileTicketHash, id) : null;
  if (pending.mobileTicketHash && !native) { delete req.session.oidcPending; mobileError(res, null); return; }
  try {
    const cfg = row.config as Record<string, string>;
    const redirectUri = `${frontendUrl(req)}/api/auth/oidc/${id}/callback`;

    const { Issuer } = await import("openid-client");
    const issuer = await Issuer.discover(cfg.issuerUrl);
    const client = new issuer.Client({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uris: [redirectUri],
      response_types: ["code"],
    });

    const params = client.callbackParams(req as unknown as Parameters<typeof client.callbackParams>[0]);
    const tokenSet = await client.callback(redirectUri, params, {
      state: pending.state,
      nonce: pending.nonce,
    });

    delete req.session.oidcPending;

    const claims = tokenSet.claims();
    let email = claims.email as string | undefined;
    let name = (claims.name ?? claims.given_name ?? email?.split("@")[0] ?? "User") as string;

    // Fall back to userinfo endpoint if email not in ID token
    if (!email && tokenSet.access_token) {
      try {
        const userinfo = await client.userinfo(tokenSet.access_token);
        email = userinfo.email as string | undefined;
        name = (userinfo.name ?? userinfo.given_name ?? email?.split("@")[0] ?? "User") as string;
      } catch {}
    }

    if (!email) {
      if (native) { mobileError(res, native); return; }
      res.redirect(`/login?error=oidc_no_email`);
      return;
    }

    const sub = claims.sub;
    const ssoId = createHash("sha256").update(`${cfg.issuerUrl}:${sub}`).digest("hex");
    const user = await provisionUser(email, name, "oidc", ssoId);
    if (native) { await completeMobile(native, user.id, res); return; }
    await establishSsoSession(req, user);
    res.redirect("/");
  } catch (err) {
    console.error("OIDC callback error", err);
    delete req.session.oidcPending;
    if (native) { mobileError(res, native); return; }
    res.redirect(`/login?error=oidc_failed`);
  }
});

export default router;
