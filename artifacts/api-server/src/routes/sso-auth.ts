import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import { ssoConfigsTable, usersTable, groupMembersTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";

const router = Router();

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
async function provisionUser(email: string, name: string, ssoProvider: string, ssoId: string) {
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

  // Create new SSO user with an unguessable password hash (prevents local login)
  const dummyPasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 1);
  const [created] = await db
    .insert(usersTable)
    .values({
      email: email.toLowerCase(),
      name: name || email.split("@")[0],
      passwordHash: dummyPasswordHash,
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
  // Resolve which Lexikon group IDs the user should be in
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
}

function frontendUrl(req: { protocol: string; get: (h: string) => string | undefined }, path = "/") {
  const base = process.env.APP_BASE_URL ?? `${req.protocol}://${req.get("host")}`;
  return base.replace(/\/$/, "") + path;
}

// ── SAML ─────────────────────────────────────────────────────────────────────

router.get("/auth/saml/:id/login", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = await getEnabledConfig(id);
  if (!row || row.provider !== "saml") {
    res.status(404).json({ error: "SSO provider not found" });
    return;
  }

  try {
    const cfg = row.config as Record<string, string>;
    const { SAML } = await import("@node-saml/node-saml");
    const saml = new SAML({
      entryPoint: cfg.entryPoint,
      issuer: cfg.issuer ?? frontendUrl(req),
      idpCert: cfg.idpCert,
      callbackUrl: `${frontendUrl(req)}/api/auth/saml/${id}/callback`,
    });
    const url = await saml.getAuthorizeUrlAsync("", req.headers.host ?? "", {});
    res.redirect(url);
  } catch (err) {
    console.error("SAML login error", err);
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

  try {
    const cfg = row.config as Record<string, string>;
    const { SAML } = await import("@node-saml/node-saml");
    const saml = new SAML({
      entryPoint: cfg.entryPoint,
      issuer: cfg.issuer ?? frontendUrl(req),
      idpCert: cfg.idpCert,
      callbackUrl: `${frontendUrl(req)}/api/auth/saml/${id}/callback`,
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

    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.userEmail = user.email;
    req.session.userName = user.name;
    res.redirect("/");
  } catch (err) {
    console.error("SAML callback error", err);
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

    req.session.oidcPending = { state, nonce, providerId: id };

    const url = client.authorizationUrl({ scope, state, nonce, redirect_uri: redirectUri });
    res.redirect(url);
  } catch (err) {
    console.error("OIDC login error", err);
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
      res.redirect(`/login?error=oidc_no_email`);
      return;
    }

    const sub = claims.sub;
    const ssoId = createHash("sha256").update(`${cfg.issuerUrl}:${sub}`).digest("hex");
    const user = await provisionUser(email, name, "oidc", ssoId);
    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.userEmail = user.email;
    req.session.userName = user.name;
    res.redirect("/");
  } catch (err) {
    console.error("OIDC callback error", err);
    res.redirect(`/login?error=oidc_failed`);
  }
});

export default router;
