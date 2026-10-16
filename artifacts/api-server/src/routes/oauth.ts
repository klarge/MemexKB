import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, oauthClientsTable as clients, oauthGrantsTable as grants,
  oauthCodesTable as codes, oauthTokensTable as tokens, usersTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { oauthPage, escapeOAuth as esc } from "../lib/oauth-page";
import { ACCESS_SECONDS, GRANT_SECONDS, OAUTH_SCOPE, equalSecret, hashOAuth,
  newOAuthSecret, oauthUrls, pkceChallenge, validRedirectUri } from "../lib/oauth";

const router = Router();
const after = (seconds: number) => new Date(Date.now() + seconds * 1000);
const value = (input: unknown): string | undefined => typeof input === "string" ? input : undefined;
function error(res: Response, status: number, code: string, description: string) {
  res.status(status).json({ error: code, error_description: description });
}
function protocolHeaders(res: Response) {
  res.set({ "Cache-Control": "no-store", Pragma: "no-cache", "Access-Control-Allow-Origin": "*" });
  res.removeHeader("Access-Control-Allow-Credentials");
}
export function oauthDiscovery(req: Request, res: Response) {
  try {
    const { issuer } = oauthUrls(req);
    protocolHeaders(res);
    res.json({
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`, revocation_endpoint: `${issuer}/revoke`,
      scopes_supported: [OAUTH_SCOPE], response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      code_challenge_methods_supported: ["S256"],
    });
  } catch { error(res, 503, "server_error", "Configure an HTTPS APP_BASE_URL for OAuth."); }
}
router.get("/.well-known/oauth-authorization-server", oauthDiscovery);
export function oauthProtectedResource(req: Request, res: Response) {
  try {
    const { resource, issuer } = oauthUrls(req);
    protocolHeaders(res);
    res.json({ resource, authorization_servers: [issuer], scopes_supported: [OAUTH_SCOPE], bearer_methods_supported: ["header"], resource_name: "Memex MCP" });
  } catch { error(res, 503, "server_error", "Configure an HTTPS APP_BASE_URL for OAuth."); }
}
router.get("/protected-resource", oauthProtectedResource);

router.use(["/register", "/token", "/revoke"], (_req, res, next) => { protocolHeaders(res); next(); });
router.options(["/register", "/token", "/revoke"], (_req, res) => {
  res.set({ "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" }).sendStatus(204);
});
router.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }));
router.post("/register", rateLimit({ windowMs: 3_600_000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false }), async (req, res) => {
  const body = req.body ?? {};
  if (!Array.isArray(body.redirect_uris) || !body.redirect_uris.length || body.redirect_uris.length > 10 ||
      !body.redirect_uris.every(validRedirectUri)) {
    error(res, 400, "invalid_redirect_uri", "Register 1–10 exact HTTPS redirect URIs (HTTP loopback is allowed)."); return;
  }
  const name = body.client_name === undefined
    ? `AI app (${new URL(body.redirect_uris[0]).hostname})`
    : value(body.client_name)?.trim();
  if (!name || name.length > 100) { error(res, 400, "invalid_client_metadata", "A client_name of 1–100 characters is required."); return; }
  const authMethod = value(body.token_endpoint_auth_method) ?? "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(authMethod) ||
      (body.grant_types !== undefined && (!Array.isArray(body.grant_types) || body.grant_types.some((x: unknown) => !["authorization_code", "refresh_token"].includes(String(x))))) ||
      (body.response_types !== undefined && (!Array.isArray(body.response_types) || body.response_types.some((x: unknown) => x !== "code"))) ||
      (body.scope !== undefined && body.scope !== OAUTH_SCOPE)) {
    error(res, 400, "invalid_client_metadata", "Only code/refresh_token grants, mcp:read, and the advertised authentication methods are supported."); return;
  }
  const clientId = newOAuthSecret("memex_client_");
  const secret = authMethod === "none" ? undefined : newOAuthSecret();
  await db.insert(clients).values({ id: clientId, name, redirectUris: [...new Set<string>(body.redirect_uris)], authMethod, secretHash: secret ? hashOAuth(secret) : null });
  res.status(201).json({
    client_id: clientId, client_name: name, redirect_uris: body.redirect_uris,
    token_endpoint_auth_method: authMethod, grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"], scope: OAUTH_SCOPE, client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
  });
});

router.get("/authorize", async (req, res) => {
  protocolHeaders(res);
  // Reject parameter pollution rather than letting different components choose different values.
  if (Object.values(req.query).some(x => typeof x !== "string")) {
    error(res, 400, "invalid_request", "Authorization parameters must be single strings."); return;
  }
  const query = req.query as Record<string, string>;
  const [client] = await db.select().from(clients).where(eq(clients.id, query.client_id ?? "")).limit(1);
  if (!client || !client.redirectUris.includes(query.redirect_uri)) {
    error(res, 400, "invalid_request", "Unknown client or unregistered redirect URI."); return;
  }
  const { resource } = oauthUrls(req);
  // Never redirect protocol errors until the exact registered callback has been checked.
  const reject = (code: string, description: string) => {
    const target = new URL(query.redirect_uri);
    target.searchParams.set("error", code); target.searchParams.set("error_description", description);
    if (query.state !== undefined) target.searchParams.set("state", query.state);
    res.redirect(302, target.href);
  };
  if (query.response_type !== "code") { reject("unsupported_response_type", "Use authorization code flow."); return; }
  if (query.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(query.code_challenge ?? "")) {
    reject("invalid_request", "S256 PKCE is required."); return;
  }
  if (query.scope !== undefined && query.scope !== OAUTH_SCOPE) { reject("invalid_scope", "Only mcp:read is supported."); return; }
  if (query.resource !== resource) { reject("invalid_target", "Request the exact Memex MCP resource URL."); return; }
  if ((query.state?.length ?? 0) > 2048) { error(res, 400, "invalid_request", "State is too long."); return; }
  if (!req.session.userId) {
    const returnTo = `/api/oauth/authorize?${new URLSearchParams(query)}`;
    res.redirect(302, `/login?returnTo=${encodeURIComponent(returnTo)}`); return;
  }
  // Consent must use a live user, never a bearer key or a stale session role.
  if (req.get("authorization")) { error(res, 400, "invalid_request", "Sign in using a browser session to approve access."); return; }
  const [user] = await db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.id, req.session.userId)).limit(1);
  if (!user) { error(res, 401, "login_required", "Sign in again."); return; }
  const csrf = newOAuthSecret();
  req.session.oauthPending = { clientId: client.id, redirectUri: query.redirect_uri, challenge: query.code_challenge,
    resource, state: query.state, csrf, expiresAt: Date.now() + 10 * 60_000, userId: user.id };
  await new Promise<void>((resolve, rejectSave) => req.session.save(err => err ? rejectSave(err) : resolve()));
  oauthPage(res, "Connect an app to Memex", `
    <p><strong>${esc(client.name)}</strong> is requesting read-only access as <strong>${esc(user.name)}</strong> (${esc(user.email)}).</p>
    <p>It can search and read articles, projects, personal logs and tasks that your account can access.
    It cannot edit content or use administration tools. Your current Memex permissions still apply to every request.</p>
    <p><small>Registered callback: ${esc(new URL(query.redirect_uri).origin)}<br>This app name is supplied by its developer, not verified by Memex.</small></p>
    <form method="post" action="/api/oauth/approve"><input type="hidden" name="csrf" value="${esc(csrf)}">
    <div class="actions"><button name="decision" value="allow" type="submit">Allow read-only access</button>
    <button class="secondary" name="decision" value="deny" type="submit">Deny</button></div></form>
    <small>Disconnect at any time in Settings → Connected AI apps. Only connect apps you trust with this content.</small>`,
    new URL(query.redirect_uri).origin);
});

router.post("/approve", async (req, res) => {
  const pending = req.session.oauthPending;
  if (req.get("authorization") || !pending || !req.session.userId || pending.userId !== req.session.userId ||
      pending.expiresAt < Date.now() || !equalSecret(value(req.body?.csrf) ?? "", pending.csrf) ||
      !["allow", "deny"].includes(req.body?.decision)) {
    error(res, 400, "invalid_request", "Consent expired or invalid. Start the connection again."); return;
  }
  delete req.session.oauthPending;
  // Persist consumption before issuing a code, so consent cannot be submitted twice sequentially.
  await new Promise<void>((resolve, rejectSave) => req.session.save(err => err ? rejectSave(err) : resolve()));
  const target = new URL(pending.redirectUri);
  // Preserve the redirect target allowlist on the POST response too; Helmet's
  // generic self-only CSP is insufficient for an OAuth callback on another site.
  res.set("Content-Security-Policy",
    `default-src 'none'; form-action ${new URL(oauthUrls(req).base).origin} ${target.origin}; frame-ancestors 'none'; base-uri 'none'`);
  res.set("Referrer-Policy", "no-referrer");
  if (pending.state !== undefined) target.searchParams.set("state", pending.state);
  if (req.body.decision === "deny") { target.searchParams.set("error", "access_denied"); res.redirect(303, target.href); return; }
  const code = newOAuthSecret();
  await db.transaction(async tx => {
    const id = newOAuthSecret("grant_");
    await tx.insert(grants).values({ id, userId: pending.userId, clientId: pending.clientId, resource: pending.resource, expiresAt: after(GRANT_SECONDS) });
    await tx.insert(codes).values({ hash: hashOAuth(code), grantId: id, redirectUri: pending.redirectUri, challenge: pending.challenge, expiresAt: after(120) });
  });
  target.searchParams.set("code", code);
  res.redirect(303, target.href);
});

async function authenticateClient(req: Request) {
  let id = value(req.body?.client_id);
  let secret = value(req.body?.client_secret);
  let method = secret === undefined ? "none" : "client_secret_post";
  const authorization = req.get("authorization");
  if (authorization) {
    if (!authorization.startsWith("Basic ") || secret !== undefined) return null;
    try {
      const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
      const colon = decoded.indexOf(":");
      if (colon < 0) return null;
      const basicId = decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, " "));
      if (id !== undefined && id !== basicId) return null;
      id = basicId; secret = decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, " ")); method = "client_secret_basic";
    } catch { return null; }
  }
  if (!id) return null;
  const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!client || client.authMethod !== method) return null;
  if (method !== "none" && (!secret || !client.secretHash || !equalSecret(hashOAuth(secret), client.secretHash))) return null;
  return client;
}

router.post("/token", async (req, res) => {
  const client = await authenticateClient(req);
  if (!client) { res.set("WWW-Authenticate", 'Basic realm="Memex OAuth"'); error(res, 401, "invalid_client", "Client authentication failed."); return; }
  if (!["authorization_code", "refresh_token"].includes(req.body?.grant_type)) {
    error(res, 400, "unsupported_grant_type", "Use authorization_code or refresh_token."); return;
  }
  const resource = oauthUrls(req).resource;
  if (req.body.resource !== resource) { error(res, 400, "invalid_target", "The exact Memex MCP resource is required."); return; }
  if (req.body.scope !== undefined && req.body.scope !== OAUTH_SCOPE) { error(res, 400, "invalid_scope", "Only mcp:read is supported."); return; }
  const isCode = req.body.grant_type === "authorization_code";
  const raw = value(isCode ? req.body.code : req.body.refresh_token);
  if (!raw || raw.length > 256) { error(res, 400, "invalid_grant", "Invalid credential."); return; }
  const rawHash = hashOAuth(raw);
  const result = await db.transaction(async tx => {
    const [credential] = isCode
      ? await tx.select().from(codes).where(eq(codes.hash, rawHash)).limit(1)
      : await tx.select().from(tokens).where(and(eq(tokens.hash, rawHash), eq(tokens.kind, "refresh"))).limit(1);
    if (!credential) return null;
    // All refresh/revocation operations serialize on the grant, including replay detection.
    const [grant] = await tx.select().from(grants).where(eq(grants.id, credential.grantId)).for("update");
    if (!grant || grant.clientId !== client.id || grant.resource !== resource || grant.revokedAt || grant.expiresAt <= new Date()) return null;
    if (isCode) {
      const verifier = value(req.body.code_verifier) ?? "";
      const saved = credential as typeof codes.$inferSelect;
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !equalSecret(pkceChallenge(verifier), saved.challenge) ||
          req.body.redirect_uri !== saved.redirectUri || saved.expiresAt <= new Date()) return null;
      const consumed = await tx.delete(codes).where(eq(codes.hash, rawHash)).returning();
      if (!consumed.length) return null;
    } else {
      const [saved] = await tx.select().from(tokens).where(eq(tokens.hash, rawHash)).limit(1);
      if (!saved) return null;
      if (saved.consumedAt) {
        await tx.update(grants).set({ revokedAt: new Date() }).where(eq(grants.id, grant.id));
        return null;
      }
      if (saved.expiresAt <= new Date()) return null;
      await tx.update(tokens).set({ consumedAt: new Date() }).where(eq(tokens.hash, rawHash));
    }
    const access = newOAuthSecret("memex_oat_"); const refresh = newOAuthSecret("memex_ort_");
    await tx.insert(tokens).values([
      { hash: hashOAuth(access), kind: "access", grantId: grant.id, expiresAt: after(ACCESS_SECONDS) },
      { hash: hashOAuth(refresh), kind: "refresh", grantId: grant.id, expiresAt: grant.expiresAt },
    ]);
    return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: ACCESS_SECONDS, scope: OAUTH_SCOPE };
  });
  if (!result) { error(res, 400, "invalid_grant", "Credential expired, revoked, already used, or does not match this request."); return; }
  res.json(result);
});

router.post("/revoke", async (req, res) => {
  const client = await authenticateClient(req);
  if (!client) { error(res, 401, "invalid_client", "Client authentication failed."); return; }
  const raw = value(req.body?.token);
  if (raw && raw.length <= 256) {
    const [row] = await db.select({ grantId: tokens.grantId }).from(tokens).where(eq(tokens.hash, hashOAuth(raw))).limit(1);
    if (row) await db.update(grants).set({ revokedAt: new Date() }).where(and(eq(grants.id, row.grantId), eq(grants.clientId, client.id)));
  }
  res.status(200).end();
});

router.get("/connections", requireAuth, async (req, res) => {
  if (req.get("authorization")) { error(res, 403, "access_denied", "Use a browser session."); return; }
  req.session.oauthConnectionsCsrf = newOAuthSecret();
  const rows = await db.select({ id: grants.id, name: clients.name, createdAt: grants.createdAt, expiresAt: grants.expiresAt })
    .from(grants).innerJoin(clients, eq(grants.clientId, clients.id))
    .where(and(eq(grants.userId, req.session.userId!), isNull(grants.revokedAt), gt(grants.expiresAt, new Date())));
  await new Promise<void>((resolve, rejectSave) => req.session.save(err => err ? rejectSave(err) : resolve()));
  oauthPage(res, "Connected AI apps", `<p>These connections can read only what your account currently permits. Disconnecting immediately disables their access and refresh tokens.</p>
    ${rows.length ? rows.map(row => `<article><strong>${esc(row.name)}</strong><br><small>Connected ${esc(row.createdAt.toISOString().slice(0, 10))} · Expires ${esc(row.expiresAt.toISOString().slice(0, 10))}</small>
    <form method="post" action="/api/oauth/disconnect"><input type="hidden" name="id" value="${esc(row.id)}">
    <input type="hidden" name="csrf" value="${esc(req.session.oauthConnectionsCsrf!)}"><button class="secondary" type="submit">Disconnect ${esc(row.name)}</button></form></article>`).join("") : "<p>No connected apps.</p>"}
    <a href="/settings">Back to Settings</a>`);
});
router.post("/disconnect", requireAuth, async (req, res) => {
  if (req.get("authorization") || !req.session.oauthConnectionsCsrf ||
      !equalSecret(value(req.body?.csrf) ?? "", req.session.oauthConnectionsCsrf)) {
    error(res, 403, "access_denied", "Invalid disconnect request."); return;
  }
  await db.update(grants).set({ revokedAt: new Date() })
    .where(and(eq(grants.id, value(req.body?.id) ?? ""), eq(grants.userId, req.session.userId!)));
  res.redirect(303, "/api/oauth/connections");
});
export default router;
