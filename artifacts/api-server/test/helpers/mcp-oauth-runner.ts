import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { db, pool, usersTable, articlesTable, articleGroupsTable, groupsTable,
  groupMembersTable, oauthTokensTable, oauthGrantsTable } from "@workspace/db";
import oauthRouter, { oauthDiscovery } from "../../src/routes/oauth";
import authRouter from "../../src/routes/auth";
import articlesRouter from "../../src/routes/articles";
import { csrfProtection } from "../../src/lib/csrf";
import { enforceApiTokenAccess, requireAuth } from "../../src/lib/auth";
import { newOAuthSecret, pkceChallenge, hashOAuth } from "../../src/lib/oauth";

test("OAuth PKCE, live employee permissions, MCP identity and revocation", async () => {
  const schema = process.env.OAUTH_TEST_SCHEMA;
  assert.match(schema ?? "", /^backup_test_[a-f0-9]{32}$/);
  assert.equal((await db.execute(sql`select current_schema() as name`)).rows[0].name, schema);
  assert.equal((await db.select().from(usersTable)).length, 0);
  delete process.env.APP_BASE_URL;
  const password = newOAuthSecret();
  const passwordHash = await bcrypt.hash(password, 4);
  const [alice, bob, admin] = await db.insert(usersTable).values(["Alice", "Bob", "Admin"].map(name => ({
    name, email: `${name.toLowerCase()}@oauth-test.invalid`, passwordHash, role: name === "Admin" ? "admin" : "user",
  }))).returning();
  const [alpha, beta] = await db.insert(groupsTable).values([{ name: "Alpha" }, { name: "Beta" }]).returning();
  await db.insert(groupMembersTable).values([{ groupId: alpha.id, userId: alice.id }, { groupId: beta.id, userId: bob.id }]);
  const [a, b] = await db.insert(articlesTable).values([
    { title: "Alpha confidential", slug: "alpha-private", content: "<p>Alpha secret</p>", visibility: "group", createdById: admin.id },
    { title: "Beta confidential", slug: "beta-private", content: "<p>Beta secret</p>", visibility: "group", createdById: admin.id },
  ]).returning();
  await db.insert(articleGroupsTable).values([{ articleId: a.id, groupId: alpha.id }, { articleId: b.id, groupId: beta.id }]);
  const app = express();
  app.use("/api", csrfProtection());
  app.use(express.json()); app.use(express.urlencoded({ extended: false }));
  const store = new session.MemoryStore();
  app.use(session({ store, secret: newOAuthSecret(), resave: false, saveUninitialized: false }));
  app.use("/api/oauth", oauthRouter);
  app.get("/.well-known/oauth-authorization-server/api/oauth", oauthDiscovery);
  app.use("/api", enforceApiTokenAccess, authRouter, articlesRouter);
  app.get("/api/admin/test", requireAuth, (_req, res) => res.json({ secret: "administration" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`, resource = `${base}/mcp`;
  const request = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, redirect: "manual" });
  const form = (path: string, body: Record<string, string>, cookie?: string, origin = base) =>
    request(path, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie, ...(origin ? { Origin: origin } : {}) } : {}) }, body: new URLSearchParams(body) });
  const cookieFor = async (email: string) => {
    const response = await request("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie")!.split(";")[0];
  };
  let mcp: ReturnType<typeof spawn> | undefined;
  try {
    const metadata = await (await request("/.well-known/oauth-authorization-server/api/oauth")).json();
    assert.equal(metadata.issuer, `${base}/api/oauth`);
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
    const register = async (name: string, authMethod = "none") => {
      const response = await request("/api/oauth/register", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          client_name: name, redirect_uris: ["https://ai.example.test/callback"], token_endpoint_auth_method: authMethod,
        }) });
      assert.equal(response.status, 201); return response.json();
    };
    const client = await register("<script>Corporate AI</script>");
    const aliceCookie = await cookieFor(alice.email), bobCookie = await cookieFor(bob.email);
    const adminCookie = await cookieFor(admin.email);
    const begin = (overrides: Record<string, string> = {}, id = client.client_id) => {
      const verifier = newOAuthSecret();
      const params = new URLSearchParams({ client_id: id, redirect_uri: "https://ai.example.test/callback",
        response_type: "code", resource, code_challenge: pkceChallenge(verifier),
        code_challenge_method: "S256", scope: "mcp:read", state: "original-state", ...overrides });
      return { verifier, path: `/api/oauth/authorize?${params}` };
    };
    const valid = begin();
    const unsigned = await request(valid.path);
    assert.equal(unsigned.status, 302); assert.ok(unsigned.headers.get("location")!.startsWith("/login?returnTo="));
    const badRedirect = await request(begin({ redirect_uri: "https://evil.example/callback" }).path, { headers: { Cookie: aliceCookie } });
    assert.equal(badRedirect.status, 400); assert.equal(badRedirect.headers.get("location"), null);
    const wrongResource = await request(begin({ resource: "https://other.example/mcp" }).path);
    assert.match(wrongResource.headers.get("location")!, /error=invalid_target/);
    const plain = await request(begin({ code_challenge_method: "plain" }).path);
    assert.match(plain.headers.get("location")!, /error=invalid_request/);
    const issueCode = async (cookie: string, id = client.client_id, decision = "allow") => {
      const flow = begin({}, id);
      const page = await request(flow.path, { headers: { Cookie: cookie } });
      assert.equal(page.status, 200); const html = await page.text();
      assert.ok(!html.includes("<script>Corporate"));
      assert.match(page.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
      assert.ok(page.headers.get("content-security-policy")!.includes(`form-action ${base}`));
      assert.ok(page.headers.get("content-security-policy")!.includes("https://ai.example.test"));
      const nonce = html.match(/name="csrf" value="([^"]+)"/)![1];
      // Origin/Referer alone neither grant nor deny consent; the session nonce
      // is mandatory even if a hostile caller can set their own HTTP headers.
      assert.equal((await form("/api/oauth/approve", { csrf: "invalid", decision }, cookie, "https://evil.example")).status, 400);
      assert.equal((await form("/api/oauth/approve", { csrf: "bad", decision }, cookie)).status, 400);
      assert.equal((await form("/api/oauth/approve", { csrf: nonce, decision }, undefined, "null")).status, 400);
      const response = await form("/api/oauth/approve", { csrf: nonce, decision }, cookie, "null");
      assert.equal(response.status, 303);
      assert.ok(response.headers.get("content-security-policy")!.includes("https://ai.example.test"));
      const callback = new URL(response.headers.get("location")!);
      assert.equal(callback.origin, "https://ai.example.test"); assert.equal(callback.searchParams.get("state"), "original-state");
      return { code: callback.searchParams.get("code")!, verifier: flow.verifier, callback };
    };
    const denied = await issueCode(aliceCookie, client.client_id, "deny");
    assert.equal(denied.callback.searchParams.get("error"), "access_denied"); assert.equal(denied.code, null);
    const exchange = (flow: { code: string; verifier: string }, id = client.client_id, extras = {}) =>
      form("/api/oauth/token", { grant_type: "authorization_code", client_id: id,
        resource, redirect_uri: "https://ai.example.test/callback", code: flow.code, code_verifier: flow.verifier, ...extras });
    const aliceCode = await issueCode(aliceCookie);
    assert.equal((await exchange(aliceCode, client.client_id, { code_verifier: newOAuthSecret() })).status, 400);
    const aliceResponse = await exchange(aliceCode); assert.equal(aliceResponse.status, 200);
    const aliceToken = await aliceResponse.json();
    assert.equal((await exchange(aliceCode)).status, 400);
    const bobResponse = await exchange(await issueCode(bobCookie)); assert.equal(bobResponse.status, 200);
    const bobToken = await bobResponse.json();
    const adminToken = await (await exchange(await issueCode(adminCookie))).json();
    const read = (path: string, token: string) => request(path, { headers: { Authorization: `Bearer ${token}` } });
    const aliceArticles = await (await read("/api/articles", aliceToken.access_token)).json();
    assert.deepEqual(aliceArticles.articles.map((row: { slug: string }) => row.slug), ["alpha-private"]);
    const bobArticles = await (await read("/api/articles", bobToken.access_token)).json();
    assert.deepEqual(bobArticles.articles.map((row: { slug: string }) => row.slug), ["beta-private"]);
    assert.ok([403, 404].includes((await read("/api/articles/beta-private", aliceToken.access_token)).status));
    assert.equal((await read("/api/admin/test", adminToken.access_token)).status, 401);
    assert.equal((await request("/api/articles", { method: "POST", headers: { Authorization: `Bearer ${adminToken.access_token}`, "Content-Type": "application/json" }, body: "{}" })).status, 401);
    const stored = await db.select().from(oauthTokensTable);
    assert.ok(stored.every(row => row.hash !== aliceToken.access_token && row.hash !== aliceToken.refresh_token));

    // Exercise the real MCP transport with the two user identities concurrently.
    const probe = createServer(); await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
    const probeAddress = probe.address(); assert.ok(probeAddress && typeof probeAddress !== "string");
    const port = probeAddress.port; await new Promise<void>(resolve => probe.close(() => resolve()));
    const env = { ...process.env, APP_BASE_URL: base, MEMEX_URL: base, MCP_HOST: "127.0.0.1", MCP_PORT: String(port) };
    delete env.NODE_TEST_CONTEXT;
    mcp = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../../../mcp-server/src/index.ts", import.meta.url))], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; mcp.stderr!.on("data", chunk => { stderr += chunk; });
    const mcpBase = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await fetch(`${mcpBase}/healthz`)).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, stderr);
    const missing = await fetch(`${mcpBase}/mcp`, { method: "POST" });
    assert.equal(missing.status, 401); assert.match(missing.headers.get("www-authenticate")!, /resource_metadata=/);
    const mcpMetadata = await (await fetch(`${mcpBase}/mcp/.well-known/oauth-protected-resource`)).json();
    assert.equal(mcpMetadata.resource, resource);
    const tool = async (token: string) => {
      const response = await fetch(`${mcpBase}/mcp`, { method: "POST", headers: {
        Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_articles", arguments: {} } }) });
      assert.equal(response.status, 200); return response.text();
    };
    const [aliceMcp, bobMcp] = await Promise.all([tool(aliceToken.access_token), tool(bobToken.access_token)]);
    assert.match(aliceMcp, /Alpha confidential/); assert.doesNotMatch(aliceMcp, /Beta confidential/);
    assert.match(bobMcp, /Beta confidential/); assert.doesNotMatch(bobMcp, /Alpha confidential/);
    await db.delete(groupMembersTable).where(and(eq(groupMembersTable.groupId, alpha.id), eq(groupMembersTable.userId, alice.id)));
    assert.equal((await (await read("/api/articles", aliceToken.access_token)).json()).articles.length, 0);
    assert.doesNotMatch(await tool(aliceToken.access_token), /Alpha confidential/);
    const refreshedResponse = await form("/api/oauth/token", { grant_type: "refresh_token", client_id: client.client_id, resource, refresh_token: aliceToken.refresh_token });
    assert.equal(refreshedResponse.status, 200); const refreshed = await refreshedResponse.json();
    assert.notEqual(refreshed.refresh_token, aliceToken.refresh_token);
    assert.equal((await read("/api/auth/me", refreshed.access_token)).status, 200);
    assert.equal((await form("/api/oauth/token", { grant_type: "refresh_token", client_id: client.client_id, resource, refresh_token: aliceToken.refresh_token })).status, 400);
    assert.equal((await read("/api/auth/me", refreshed.access_token)).status, 401);
    assert.equal((await read("/api/auth/me", aliceToken.access_token)).status, 401);
    const connections = await request("/api/oauth/connections", { headers: { Cookie: bobCookie } });
    const connectionsHtml = await connections.text();
    const disconnectId = connectionsHtml.match(/name="id" value="([^"]+)"/)![1];
    const disconnectCsrf = connectionsHtml.match(/name="csrf" value="([^"]+)"/)![1];
    // A different user's session cannot use Bob's form nonce or grant.
    assert.equal((await form("/api/oauth/disconnect", { id: disconnectId, csrf: disconnectCsrf }, aliceCookie)).status, 403);
    assert.equal((await form("/api/oauth/disconnect", { id: disconnectId, csrf: "bad" }, bobCookie, "https://evil.example")).status, 403);
    assert.equal((await form("/api/oauth/disconnect", { id: disconnectId, csrf: disconnectCsrf }, bobCookie, "")).status, 303);
    assert.equal((await read("/api/auth/me", bobToken.access_token)).status, 401);
    const confidential = await register("Confidential AI", "client_secret_post");
    const confidentialCode = await issueCode(bobCookie, confidential.client_id);
    assert.equal((await exchange(confidentialCode, confidential.client_id, { client_secret: "wrong" })).status, 401);
    const confidentialResponse = await exchange(confidentialCode, confidential.client_id, { client_secret: confidential.client_secret });
    assert.equal(confidentialResponse.status, 200); const confidentialToken = await confidentialResponse.json();
    assert.equal((await form("/api/oauth/revoke", { client_id: confidential.client_id, client_secret: confidential.client_secret, token: confidentialToken.refresh_token })).status, 200);
    assert.equal((await read("/api/auth/me", confidentialToken.access_token)).status, 401);
    await db.update(oauthTokensTable).set({ expiresAt: new Date(0) }).where(eq(oauthTokensTable.hash, hashOAuth(adminToken.access_token)));
    assert.equal((await read("/api/auth/me", adminToken.access_token)).status, 401);
    await db.delete(usersTable).where(eq(usersTable.id, admin.id));
    assert.equal((await db.select().from(oauthGrantsTable).where(eq(oauthGrantsTable.userId, admin.id))).length, 0);
  } finally {
    if (mcp && mcp.exitCode === null) { mcp.kill("SIGTERM"); await new Promise(resolve => mcp!.once("exit", resolve)); }
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.clear(() => {}); await pool.end();
  }
});
