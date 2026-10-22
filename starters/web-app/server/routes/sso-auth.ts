import { Router } from "express";
import { createHash } from "node:crypto";
import { db, ssoConfigsTable, usersTable, groupMembersTable, groupsTable, samlRequestsTable } from "@workspace/db";
import { eq, and, inArray, gt } from "drizzle-orm";
import { SAML, ValidateInResponseTo, type CacheProvider } from "@node-saml/node-saml";
import { SSO_ONLY_PASSWORD_HASH } from "../lib/login-mode";
import { frontendUrl } from "../lib/frontend-url";
import { establishSsoSession } from "../lib/sso-session";
const router = Router();

async function configFor(id: number, provider: string) {
  const [row] = await db.select().from(ssoConfigsTable).where(and(
    eq(ssoConfigsTable.id, id), eq(ssoConfigsTable.provider, provider), eq(ssoConfigsTable.enabled, true)));
  return row;
}
// Request IDs survive process restarts and are consumed on validation. Neither
// unsolicited responses nor already-consumed requests establish a session.
export function samlClient(id: number, cfg: Record<string, string>, base: string) {
  const cache: CacheProvider = {
    async saveAsync(key, value) {
      await db.delete(samlRequestsTable).where(eq(samlRequestsTable.requestId, key));
      const createdAt = new Date();
      await db.insert(samlRequestsTable).values({ requestId: key, providerId: id, value, expiresAt: new Date(createdAt.getTime() + 300_000) });
      return { createdAt: createdAt.getTime(), value };
    },
    async getAsync(key) {
      const [r] = await db.select().from(samlRequestsTable).where(and(eq(samlRequestsTable.requestId, key), eq(samlRequestsTable.providerId, id), gt(samlRequestsTable.expiresAt, new Date())));
      return r?.value ?? null;
    },
    async removeAsync(key) {
      if (!key) return null;
      const [r] = await db.delete(samlRequestsTable).where(and(eq(samlRequestsTable.requestId, key), eq(samlRequestsTable.providerId, id))).returning();
      return r?.value ?? null;
    }
  };
  return new SAML({
    entryPoint: cfg.entryPoint, issuer: cfg.issuer, idpCert: cfg.idpCert,
    callbackUrl: `${base}/api/auth/saml/${id}/callback`,
    wantAssertionsSigned: true, wantAuthnResponseSigned: true,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: 300_000, cacheProvider: cache
  });
}
export async function provisionUser(email: string, name: string, provider: string, ssoId: string) {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (existing) {
    if (!existing.ssoProvider) await db.update(usersTable).set({ ssoProvider: provider, ssoId, updatedAt: new Date() }).where(eq(usersTable.id, existing.id));
    return existing;
  }
  const [user] = await db.insert(usersTable).values({
    email: email.toLowerCase(), name: name || email.split("@")[0],
    passwordHash: SSO_ONLY_PASSWORD_HASH, ssoOnly: true, role: "user", ssoProvider: provider, ssoId
  }).returning();
  return user;
}
async function syncGroups(userId: number, values: string[], mappings: Record<string, string>) {
  const managed = Object.values(mappings).map(Number).filter(n => Number.isSafeInteger(n) && n > 0);
  if (!managed.length) return;
  const existing = await db.select().from(groupsTable).where(inArray(groupsTable.id, managed));
  const valid = new Set(existing.map(g => g.id));
  const target = [...new Set(values.map(v => Number(mappings[v])).filter(n => valid.has(n)))];
  await db.transaction(async tx => {
    await tx.delete(groupMembersTable).where(and(eq(groupMembersTable.userId, userId), inArray(groupMembersTable.groupId, managed)));
    if (target.length) await tx.insert(groupMembersTable).values(target.map(groupId => ({ groupId, userId }))).onConflictDoNothing();
  });
}
router.get("/auth/saml/:id/metadata", async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(ssoConfigsTable).where(and(eq(ssoConfigsTable.id, id), eq(ssoConfigsTable.provider, "saml")));
  if (!row) { res.status(404).json({ error: "SAML provider not found" }); return; }
  res.type("application/xml").send(samlClient(id, row.config, frontendUrl(req)).generateServiceProviderMetadata(null, null));
});
router.get("/auth/saml/:id/login", async (req, res) => {
  const id = Number(req.params.id), row = await configFor(id, "saml");
  if (!row) { res.status(404).json({ error: "SSO provider not found" }); return; }
  try {
    const url = await samlClient(id, row.config, frontendUrl(req)).getAuthorizeUrlAsync("", req.get("host") ?? "", {});
    res.set("Cache-Control", "no-store").redirect(url);
  } catch { req.log.warn("SAML login failed"); res.redirect("/login?error=saml_config"); }
});
router.post("/auth/saml/:id/callback", async (req, res) => {
  const id = Number(req.params.id), row = await configFor(id, "saml");
  if (!row) { res.status(404).json({ error: "SSO provider not found" }); return; }
  try {
    const { profile } = await samlClient(id, row.config, frontendUrl(req)).validatePostResponseAsync(req.body);
    if (!profile) throw Error("No profile");
    const p = profile as Record<string, unknown>;
    const email = p.email ?? p["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] ?? profile.nameID;
    const name = p.displayName ?? p["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] ?? email;
    if (typeof email !== "string" || !email.includes("@")) throw Error("No email");
    const user = await provisionUser(email, String(name), "saml", profile.nameID ?? email);
    if (row.config.groupAttributeName && row.config.groupMappings) {
      const attr = p[row.config.groupAttributeName];
      await syncGroups(user.id, Array.isArray(attr) ? attr.map(String) : attr ? [String(attr)] : [], JSON.parse(row.config.groupMappings));
    }
    await establishSsoSession(req, user);
    res.redirect("/");
  } catch { req.log.warn("SAML assertion rejected"); res.redirect("/login?error=saml_failed"); }
});
router.get("/auth/oidc/:id/login", async (req, res) => {
  const id = Number(req.params.id), row = await configFor(id, "oidc");
  if (!row) { res.status(404).json({ error: "SSO provider not found" }); return; }
  try {
    const { Issuer, generators } = await import("openid-client");
    const issuer = await Issuer.discover(row.config.issuerUrl);
    const redirect = `${frontendUrl(req)}/api/auth/oidc/${id}/callback`;
    const client = new issuer.Client({ client_id: row.config.clientId, client_secret: row.config.clientSecret, redirect_uris: [redirect], response_types: ["code"] });
    const state = generators.state(), nonce = generators.nonce(), verifier = generators.codeVerifier();
    req.session.oidcPending = { state, nonce, verifier, providerId: id, expiresAt: Date.now() + 300_000 };
    await new Promise<void>((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
    res.set("Cache-Control", "no-store").redirect(client.authorizationUrl({
      scope: row.config.scope || "openid email profile", state, nonce, redirect_uri: redirect,
      code_challenge: generators.codeChallenge(verifier), code_challenge_method: "S256"
    }));
  } catch { req.log.warn("OIDC login failed"); res.redirect("/login?error=oidc_config"); }
});
router.get("/auth/oidc/:id/callback", async (req, res) => {
  const id = Number(req.params.id), row = await configFor(id, "oidc");
  if (!row) { res.status(404).json({ error: "SSO provider not found" }); return; }
  const pending = req.session.oidcPending;
  delete req.session.oidcPending;
  await new Promise<void>((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
  if (!pending || pending.providerId !== id || pending.expiresAt < Date.now()) { res.redirect("/login?error=oidc_state"); return; }
  try {
    const { Issuer } = await import("openid-client");
    const issuer = await Issuer.discover(row.config.issuerUrl);
    const redirect = `${frontendUrl(req)}/api/auth/oidc/${id}/callback`;
    const client = new issuer.Client({ client_id: row.config.clientId, client_secret: row.config.clientSecret, redirect_uris: [redirect], response_types: ["code"] });
    const tokens = await client.callback(redirect, client.callbackParams(req as never), { state: pending.state, nonce: pending.nonce, code_verifier: pending.verifier });
    const claims = tokens.claims();
    let identity = { email: claims.email, email_verified: claims.email_verified, name: claims.name };
    if (!identity.email && tokens.access_token) identity = { ...identity, ...await client.userinfo(tokens) };
    // Auto-linking local accounts by email requires provider-verified ownership.
    if (typeof identity.email !== "string" || identity.email_verified !== true) throw Error("Verified email required");
    const ssoId = createHash("sha256").update(`${row.config.issuerUrl}:${claims.sub}`).digest("hex");
    const user = await provisionUser(identity.email, String(identity.name ?? identity.email), "oidc", ssoId);
    await establishSsoSession(req, user);
    res.redirect("/");
  } catch { req.log.warn("OIDC callback rejected"); res.redirect("/login?error=oidc_failed"); }
});
export default router;
