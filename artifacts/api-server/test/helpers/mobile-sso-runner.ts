import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { eq, sql } from "drizzle-orm";
import { db, pool, mobileSsoTable, ssoConfigsTable, usersTable } from "@workspace/db";
import { csrfProtection } from "../../src/lib/csrf";
import { pkceChallenge, opaqueToken, tokenHash } from "../../src/lib/mobile-sso";
import { withEphemeralIdp, samlResponse } from "./saml-fixtures";
import { withOidcFixture } from "./oidc-fixture";

test("Native SSO isolated provider flows", async t => {
  const schema = process.env.MOBILE_SSO_TEST_SCHEMA;
  assert.match(schema ?? "", /^backup_test_[a-f0-9]{32}$/);
  assert.equal((await db.execute(sql`select current_schema() as name`)).rows[0].name, schema);
  assert.equal((await db.select().from(usersTable)).length, 0);
  const originalBase = process.env.APP_BASE_URL;
  delete process.env.APP_BASE_URL;
  const { default: ssoRouter } = await import("../../src/routes/sso-auth");
  const { default: mobileRouter } = await import("../../src/routes/mobile-sso");
  const { default: authRouter } = await import("../../src/routes/auth");
  const { default: providersRouter } = await import("../../src/routes/sso-admin");
  const PgSession = connectPgSimple(session);
  const app = express();
  app.use("/api", csrfProtection());
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  const store = new PgSession({ pool, schemaName: schema, tableName: "user_sessions", createTableIfMissing: true });
  app.use(session({ store, secret: opaqueToken(), saveUninitialized: false, resave: false }));
  app.use("/api", ssoRouter, mobileRouter, authRouter, providersRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, redirect: "manual" });
  const post = (path: string, body: unknown, cookie?: string) => request(path, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Memex-Client": "native", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  const begin = async (providerId: number, extra = {}) => {
    const verifier = opaqueToken(), state = opaqueToken();
    const response = await post("/api/auth/mobile/start", { providerId, challenge: pkceChallenge(verifier), state, ...extra });
    return { response, verifier, state, ticket: response.ok ? (await response.json()).ticket as string : "" };
  };
  type Transaction = Awaited<ReturnType<typeof begin>>;
  const browser = async (flow: Transaction) => {
    const entry = await request(`/api/auth/mobile/browser?ticket=${flow.ticket}`);
    assert.equal(entry.status, 302);
    const login = await request(entry.headers.get("location")!);
    assert.equal(login.status, 302);
    return login;
  };
  const exchange = (flow: Transaction, code: string, verifier = flow.verifier, state = flow.state) =>
    post("/api/auth/mobile/exchange", { code, verifier, state });
  try {
    await withEphemeralIdp(async idp => withOidcFixture(async (issuerUrl, setEmail) => {
      const [saml] = await db.insert(ssoConfigsTable).values({
        provider: "saml", name: "SAML fixture", enabled: true,
        config: { entryPoint: "https://idp.example.test/login", idpCert: idp.certificate, issuer: base },
      }).returning();
      const [oidc] = await db.insert(ssoConfigsTable).values({
        provider: "oidc", name: "OIDC fixture", enabled: true,
        config: { issuerUrl, clientId: "fixture-client", clientSecret: "fixture-only" },
      }).returning();
      const [disabled] = await db.insert(ssoConfigsTable).values({ provider: "oidc", name: "Disabled", enabled: false }).returning();
      async function samlHandoff(flow: Transaction, changes: Partial<Parameters<typeof samlResponse>[0]> = {}) {
        const login = await browser(flow);
        const authorization = new URL(login.headers.get("location")!);
        assert.equal(authorization.searchParams.get("RelayState"), `memex.${flow.ticket}`);
        const xml = inflateRawSync(Buffer.from(authorization.searchParams.get("SAMLRequest")!, "base64")).toString();
        assert.match(xml, /ForceAuthn="true"/);
        const requestId = /\bID="([^"]+)"/.exec(xml)![1];
        const callback = `/api/auth/saml/${saml.id}/callback`;
        return request(callback, {
          method: "POST", headers: { Origin: "https://idp.example.test", "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            RelayState: `memex.${flow.ticket}`,
            SAMLResponse: samlResponse({
              callbackUrl: base + callback, audience: base, email: "saml-mobile@example.test",
              assertionKey: idp.privateKey, responseKey: idp.privateKey, inResponseTo: requestId, ...changes,
            }),
          }),
        });
      }
      await t.test("provider discovery and fixed destinations reject arbitrary redirects", async () => {
        const providers = await (await request("/api/auth/providers")).json();
        assert.deepEqual(providers.map((p: { id: number }) => p.id), [saml.id, oidc.id]);
        assert.ok(providers.every((p: object) => !("config" in p)));
        assert.equal((await begin(disabled.id)).response.status, 404);
        assert.equal((await begin(saml.id, { redirect: "https://attacker.example" })).response.status, 400);
        const flow = await begin(saml.id);
        assert.equal((await request(`/api/auth/mobile/browser?ticket=${flow.ticket}&redirect=evil`)).status, 400);
        await browser(flow);
        assert.equal((await request(`/api/auth/mobile/browser?ticket=${flow.ticket}`)).status, 400);
      });
      await t.test("cancelled and expired starts cannot return to a browser session", async () => {
        for (const cancel of [true, false]) {
          const flow = await begin(saml.id);
          if (cancel) assert.equal((await post("/api/auth/mobile/cancel", { ticket: flow.ticket, verifier: flow.verifier })).status, 204);
          else await db.update(mobileSsoTable).set({ expiresAt: new Date(0) }).where(eq(mobileSsoTable.ticketHash, tokenHash(flow.ticket)));
          assert.equal((await request(`/api/auth/mobile/browser?ticket=${flow.ticket}`)).status, 400);
        }
      });
      await t.test("signed SAML handoff requires PKCE and creates an SSO-only native session", async () => {
        const flow = await begin(saml.id);
        const response = await samlHandoff(flow);
        assert.equal(response.headers.get("set-cookie"), null, "No session credential is exposed to browser handoff");
        const callback = new URL(response.headers.get("location")!);
        assert.equal(callback.origin, "null");
        assert.equal(callback.host, "sso-callback");
        assert.equal(callback.searchParams.get("state"), flow.state);
        assert.deepEqual([...callback.searchParams.keys()].sort(), ["code", "state"]);
        const code = callback.searchParams.get("code")!;
        assert.equal((await exchange(flow, code, opaqueToken())).status, 400);
        assert.equal((await exchange(flow, code, flow.verifier, opaqueToken())).status, 400);
        const results = await Promise.all([exchange(flow, code), exchange(flow, code)]);
        assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
        const success = results.find(r => r.status === 200)!;
        const user = await success.json();
        const cookie = success.headers.get("set-cookie")!.split(";")[0];
        assert.equal((await (await request("/api/auth/me", { headers: { Cookie: cookie } })).json()).id, user.id);
        assert.equal((await db.select().from(usersTable).where(eq(usersTable.id, user.id)))[0].ssoOnly, true);
        assert.equal((await post("/api/auth/login", { email: user.email, password: "any password" })).status, 401);
        await post("/api/auth/logout", {}, cookie);
        assert.equal((await request("/api/auth/me", { headers: { Cookie: cookie } })).status, 401);
      });
      await t.test("SAML request matching, audience and signature checks remain enforced", async () => {
        const errors: string[] = [];
        t.mock.method(console, "error", (_label: string, error: unknown) => errors.push(String(error)));
        for (const changes of [{ inResponseTo: "_unrelated" }, { audience: "https://wrong.example" }, { tamperAssertion: true }]) {
          const response = await samlHandoff(await begin(saml.id), changes);
          assert.match(response.headers.get("location")!, /error=sso_failed/);
          assert.equal(response.headers.get("set-cookie"), null);
        }
        assert.equal(errors.length, 3);
        t.mock.restoreAll();
      });
      await t.test("expired and cancelled completed grants never issue credentials", async () => {
        for (const cancel of [true, false]) {
          const flow = await begin(saml.id);
          const handoff = await samlHandoff(flow);
          const code = new URL(handoff.headers.get("location")!).searchParams.get("code")!;
          if (cancel) await post("/api/auth/mobile/cancel", { ticket: flow.ticket, verifier: flow.verifier });
          else await db.update(mobileSsoTable).set({ expiresAt: new Date(0) }).where(eq(mobileSsoTable.ticketHash, tokenHash(flow.ticket)));
          assert.equal((await exchange(flow, code)).status, 400);
        }
      });
      await t.test("OIDC handoff validates state and switches isolated accounts without browser identity reuse", async () => {
        const identities: number[] = [];
        for (const email of ["oidc-first@example.test", "oidc-second@example.test"]) {
          setEmail(email);
          const flow = await begin(oidc.id);
          const login = await browser(flow);
          const browserCookie = login.headers.get("set-cookie")!.split(";")[0];
          const authorizeUrl = new URL(login.headers.get("location")!);
          assert.equal(authorizeUrl.searchParams.get("prompt"), "select_account");
          const authorization = await fetch(authorizeUrl, { redirect: "manual" });
          const callback = new URL(authorization.headers.get("location")!);
          const wrongState = new URL(callback);
          wrongState.searchParams.set("state", opaqueToken());
          const rejected = await request(wrongState.pathname + wrongState.search, { headers: { Cookie: browserCookie } });
          assert.match(rejected.headers.get("location")!, /error=sso_failed/);
          // Wrong state is not reusable: restart before the valid callback.
          const retry = await begin(oidc.id);
          const secondLogin = await browser(retry);
          const cookie = secondLogin.headers.get("set-cookie")!.split(";")[0];
          const authorized = await fetch(secondLogin.headers.get("location")!, { redirect: "manual" });
          const validCallback = new URL(authorized.headers.get("location")!);
          const handoff = await request(validCallback.pathname + validCallback.search, { headers: { Cookie: cookie } });
          const link = new URL(handoff.headers.get("location")!);
          assert.equal(link.searchParams.get("state"), retry.state);
          const exchanged = await exchange(retry, link.searchParams.get("code")!);
          assert.equal(exchanged.status, 200);
          const identity = await exchanged.json();
          assert.equal(identity.email, email);
          identities.push(identity.id);
          const nativeCookie = exchanged.headers.get("set-cookie")!.split(";")[0];
          assert.notEqual(nativeCookie, cookie, "Native session is fresh, not copied from the browser");
          assert.equal((await request("/api/auth/me", { headers: { Cookie: cookie } })).status, 401);
          await post("/api/auth/logout", {}, nativeCookie);
        }
        assert.notEqual(identities[0], identities[1]);
      });
    }));
  } finally {
    if (originalBase === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBase;
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
    await pool.end();
  }
});
