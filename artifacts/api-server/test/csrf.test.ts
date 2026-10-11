import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { csrfProtection } from "../src/lib/csrf";

test("CSRF protection rejects browser forgery while supporting trusted origins, native clients and exact SAML callbacks", async () => {
  const app = express();
  app.use("/api", csrfProtection({ allowedOrigins: ["https://trusted.example"] }));
  // An isolated stub: confirms which requests reach routing, never signs users in.
  app.use("/api", (_req, res) => res.status(204).end());
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(headers: Record<string, string>, path = "/test", method = "POST") {
    const response = await fetch(`${base}/api${path}`, { method, headers });
    await response.text();
    return response.status;
  }
  try {
    assert.equal(await request({ Origin: base, Cookie: "connect.sid=fixture" }), 204);
    assert.equal(await request({ Origin: "https://trusted.example" }), 204);
    assert.equal(await request({ Referer: `${base}/articles` }), 204);
    assert.equal(await request({ Origin: "https://evil.example", Cookie: "connect.sid=fixture" }), 403);
    assert.equal(await request({ Origin: "null", "X-Memex-Client": "native" }), 403);
    assert.equal(await request({ Referer: "https://evil.example/" }), 403);
    assert.equal(await request({}), 403);
    assert.equal(await request({}, "/auth/login"), 403);
    assert.equal(await request({ "X-Memex-Client": "native", Cookie: "connect.sid=fixture" }), 204);
    assert.equal(await request({ Authorization: "bearer fixture-token" }), 204);
    assert.equal(await request({ Origin: "https://evil.example", Authorization: "Bearer fixture-token" }), 403);
    assert.equal(await request({ "X-Memex-Client": "native", "Sec-Fetch-Site": "cross-site" }), 403);
    assert.equal(await request({ Origin: "https://idp.example" }, "/auth/saml/1/callback"), 204);
    assert.equal(await request({ Origin: "https://idp.example" }, "/auth/saml/1/callback/extra"), 403);
    assert.equal(await request({ Origin: "https://idp.example" }, "/auth/saml/not-an-id/callback"), 403);
    assert.equal(await request({}, "/test", "GET"), 204);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
