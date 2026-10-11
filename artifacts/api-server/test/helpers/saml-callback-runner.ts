import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { eq, sql } from "drizzle-orm";
import { db, pool, ssoConfigsTable, usersTable } from "@workspace/db";
import { csrfProtection } from "../../src/lib/csrf";
import { samlResponse, withEphemeralIdp } from "./saml-fixtures";

test("Real CSRF, SAML validation, provisioning and persisted sessions", async t => {
  const schema = process.env.SAML_TEST_SCHEMA;
  assert.match(schema ?? "", /^backup_test_[a-f0-9]{32}$/);
  const actual = await db.execute(sql`SELECT current_schema() AS schema, current_setting('search_path') AS path`);
  assert.equal(actual.rows[0].schema, schema);
  assert.equal(actual.rows[0].path, schema, "Never fall back to existing application records");
  assert.equal((await db.select().from(usersTable)).length, 0);
  const { default: ssoRouter } = await import("../../src/routes/sso-auth");
  const errors: string[] = [];
  t.mock.method(console, "error", (_label: string, error: unknown) => {
    errors.push(error instanceof Error ? error.message : String(error));
  });
  const originalBase = process.env.APP_BASE_URL;
  const PgSession = connectPgSimple(session);

  try {
    await withEphemeralIdp(async idp => withEphemeralIdp(async rogueIdp => {
      for (const proxy of [false, true]) {
        const publicBase = "https://wiki.example.test";
        if (proxy) process.env.APP_BASE_URL = `${publicBase}/`;
        else delete process.env.APP_BASE_URL;
        const app = express();
        if (proxy) app.set("trust proxy", 1);
        app.use("/api", csrfProtection({ baseUrl: process.env.APP_BASE_URL }));
        app.use(express.urlencoded({ extended: true, limit: "2mb" }));
        const store = new PgSession({
          pool, schemaName: schema, tableName: "user_sessions", createTableIfMissing: true,
        });
        app.use(session({
          store, secret: randomBytes(32).toString("hex"),
          resave: false, saveUninitialized: false,
          cookie: { secure: proxy, httpOnly: true, sameSite: "lax" },
        }));
        app.get("/api/test-session", (req, res) => {
          res.json({
            userId: req.session.userId ?? null,
            userRole: req.session.userRole ?? null,
            userEmail: req.session.userEmail ?? null,
            userName: req.session.userName ?? null,
          });
        });
        app.post("/api/test-write", (_req, res) => { res.sendStatus(204); });
        app.use("/api", ssoRouter);
        const server = app.listen(0, "127.0.0.1");
        await new Promise<void>(resolve => server.once("listening", resolve));
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const base = `http://127.0.0.1:${address.port}`;
        const issuer = proxy ? publicBase : base;
        // No explicit issuer: metadata, login and callback must agree on frontendUrl.
        const [provider] = await db.insert(ssoConfigsTable).values({
          provider: "saml", name: "Ephemeral test IdP", enabled: true,
          config: { entryPoint: "https://idp.example.test/login", idpCert: idp.certificate },
        }).returning();
        const callback = `/api/auth/saml/${provider.id}/callback`;
        const callbackUrl = `${issuer}${callback}`;
        const proxyHeaders: Record<string, string> = proxy ? {
          Host: "internal-service.example.test:8080",
          "X-Forwarded-Host": "wiki.example.test",
          "X-Forwarded-Proto": "https",
        } : {};
        async function request(path: string, init: RequestInit = {}) {
          const response = await fetch(base + path, {
            ...init, redirect: "manual", headers: { ...proxyHeaders, ...init.headers },
          });
          const body = await response.text();
          return { response, body };
        }
        async function post(path: string, response?: string, cookie?: string) {
          return request(path, {
            method: "POST",
            headers: {
              Origin: "https://idp.example.test", "Sec-Fetch-Site": "cross-site",
              "Content-Type": "application/x-www-form-urlencoded",
              ...(cookie ? { Cookie: cookie } : {}),
            },
            body: new URLSearchParams(response === undefined ? {} : { SAMLResponse: response }).toString(),
          });
        }
        async function counts() {
          const users = await db.select().from(usersTable);
          const sessions = await db.execute(sql`SELECT count(*)::int AS count FROM user_sessions`);
          return { users: users.length, sessions: sessions.rows[0].count };
        }
        const options = {
          audience: issuer, callbackUrl, email: `saml-${proxy ? "proxy" : "direct"}@example.test`,
          assertionKey: idp.privateKey, responseKey: idp.privateKey,
        };
        try {
          await t.test(`${proxy ? "reverse proxy" : "direct"} metadata and login use the public origin`, async () => {
            const metadata = await request(`/api/auth/saml/${provider.id}/metadata`);
            assert.equal(metadata.response.status, 200);
            assert.ok(metadata.body.includes(`entityID="${issuer}"`));
            assert.ok(metadata.body.includes(`Location="${callbackUrl}"`));
            assert.ok(!metadata.body.includes("internal-service"));
            const login = await request(`/api/auth/saml/${provider.id}/login`);
            assert.equal(login.response.status, 302);
            const url = new URL(login.response.headers.get("location")!);
            assert.equal(url.origin, "https://idp.example.test");
            const authn = inflateRawSync(Buffer.from(url.searchParams.get("SAMLRequest")!, "base64")).toString();
            assert.ok(authn.includes(`AssertionConsumerServiceURL="${callbackUrl}"`));
            assert.ok(authn.includes(issuer));
          });
          let cookie = "";
          await t.test(`${proxy ? "reverse proxy" : "direct"} valid signed callback establishes the expected session`, async () => {
            const result = await post(callback, samlResponse(options));
            assert.equal(result.response.status, 302);
            assert.equal(result.response.headers.get("location"), "/");
            const setCookie = result.response.headers.get("set-cookie");
            assert.ok(setCookie, "A real persisted session cookie must be issued");
            assert.ok(setCookie.includes("HttpOnly"));
            assert.equal(setCookie.includes("; Secure"), proxy);
            cookie = setCookie.split(";")[0];
            const [user] = await db.select().from(usersTable).where(eq(usersTable.email, options.email));
            assert.ok(user);
            assert.equal(user.name, "Isolated SAML user");
            assert.equal(user.role, "user");
            assert.equal(user.ssoProvider, "saml");
            assert.equal(user.ssoId, options.email);
            assert.equal(user.ssoOnly, true);
            const restored = await request("/api/test-session", { headers: { Cookie: cookie } });
            assert.deepEqual(JSON.parse(restored.body), {
              userId: user.id, userRole: "user", userEmail: options.email, userName: user.name,
            });
          });
          const badCases = [
            { name: "bad response signature", changes: { responseKey: rogueIdp.privateKey }, error: /signature/i },
            { name: "bad assertion signature", changes: { assertionKey: rogueIdp.privateKey }, error: /signature/i },
            { name: "tampered signed assertion", changes: { tamperAssertion: true }, error: /signature/i },
            { name: "unsigned response", changes: { responseKey: undefined }, error: /signature/i },
            { name: "unsigned assertion", changes: { assertionKey: undefined }, error: /signature/i },
            { name: "wrong audience", changes: { audience: "https://wrong.example.test" }, error: /audience mismatch/i },
            { name: "missing audience", changes: { omitAudience: true }, error: /audience/i },
            { name: "malformed signed assertion conditions", changes: { duplicateConditions: true }, error: /multiple conditions/i },
            { name: "malformed assertion XML", raw: Buffer.from("<samlp:Response><broken").toString("base64") },
            { name: "missing assertion form field", missing: true },
          ];
          for (const [index, invalid] of badCases.entries()) {
            await t.test(`${proxy ? "reverse proxy" : "direct"} rejects ${invalid.name} without a session`, async () => {
              const before = await counts();
              const errorCount = errors.length;
              const payload = invalid.missing ? undefined : invalid.raw ?? samlResponse({
                ...options, email: `rejected-${proxy}-${index}@example.test`, ...invalid.changes,
              });
              const result = await post(callback, payload);
              assert.equal(result.response.status, 302, "The exact callback reaches SAML validation, not CSRF rejection");
              assert.equal(result.response.headers.get("location"), "/login?error=saml_failed");
              assert.equal(result.response.headers.get("set-cookie"), null);
              assert.deepEqual(await counts(), before, "Rejected identities must not provision users or persist sessions");
              assert.equal(errors.length, errorCount + 1);
              if (invalid.error) assert.match(errors.at(-1)!, invalid.error);
              const anonymous = await request("/api/test-session");
              assert.deepEqual(JSON.parse(anonymous.body), {
                userId: null, userRole: null, userEmail: null, userName: null,
              });
              assert.equal(anonymous.response.headers.get("set-cookie"), null);
            });
          }
          await t.test(`${proxy ? "reverse proxy" : "direct"} adjacent callbacks remain CSRF protected`, async () => {
            const before = await counts();
            for (const path of [
              `${callback}/extra`, `${callback}//`, `/api/auth/saml/not-an-id/callback`,
              `/api/auth/saml/${provider.id}extra/callback`, `/api/auth/oidc/${provider.id}/callback`,
              `/api/auth/saml/${provider.id}/login`, "/api/test-write",
            ]) {
              const result = await post(path, samlResponse(options), cookie);
              assert.equal(result.response.status, 403, path);
              assert.deepEqual(JSON.parse(result.body), { error: "Cross-site request rejected." });
              assert.equal(result.response.headers.get("set-cookie"), null);
            }
            assert.deepEqual(await counts(), before);
            const allowed = await request("/api/test-write", {
              method: "POST", headers: { Origin: issuer, Cookie: cookie },
            });
            assert.equal(allowed.response.status, 204, "Public same-origin writes still work behind the proxy");
          });
        } finally {
          await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
          store.close();
        }
      }
    }));
  } finally {
    if (originalBase === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBase;
    await pool.end();
  }
});
