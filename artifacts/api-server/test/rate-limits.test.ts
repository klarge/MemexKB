import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import rateLimit from "express-rate-limit";
import type { AddressInfo } from "node:net";
import { createApiRateLimiters, ingressRateLimitOptions } from "../src/lib/rate-limits";

async function withApi(
  run: (request: (path: string, user?: number, successful?: boolean) => Promise<Response>) => Promise<void>,
) {
  const app = express();
  app.use("/api", rateLimit(ingressRateLimitOptions));
  app.use(express.json());
  // Synthetic session identities for an isolated server; no real DB/accounts.
  app.use((req, _res, next) => {
    req.session = { userId: Number(req.header("x-test-user")) || undefined } as typeof req.session;
    next();
  });
  const { apiLimiter, authLimiter } = createApiRateLimiters({
    authenticatedLimit: 4, anonymousLimit: 4, sessionControlLimit: 4, authAttemptLimit: 3,
  });
  app.use("/api", apiLimiter);
  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/setup", authLimiter);
  app.get("/api/articles", (_req, res) => res.json([]));
  app.get("/api/auth/me", (req, res) => res.status(req.session.userId ? 200 : 401).json({}));
  app.post("/api/auth/logout", (_req, res) => res.json({}));
  app.post(["/api/auth/login", "/api/auth/setup"], (req, res) => res.status(req.body.successful ? 200 : 401).json({}));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run(async (path, user, successful = true) => {
      const response = await fetch(`${base}/api${path}`, {
        method: path.startsWith("/auth/") && !path.startsWith("/auth/me") ? "POST" : "GET",
        headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": String(user) } : {}) },
        body: path.startsWith("/auth/") && !path.startsWith("/auth/me") ? JSON.stringify({ successful }) : undefined,
      });
      await response.text();
      return response;
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("exhausted article quotas do not block session checks, logout or login", async () => {
  await withApi(async (request) => {
    for (let i = 0; i < 4; i++) assert.equal((await request("/articles", 1)).status, 200);
    const blocked = await request("/articles", 1);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal((await request("/auth/me", 1)).status, 200);
    assert.equal((await request("/auth/logout", 1)).status, 200);
    assert.equal((await request("/auth/login", 1)).status, 200);
    assert.equal((await request("/articles", 2)).status, 200);
    for (let i = 0; i < 4; i++) assert.equal((await request("/articles")).status, 200);
    assert.equal((await request("/articles")).status, 429);
    assert.equal((await request("/auth/login")).status, 200);
    assert.equal((await request("/auth/me")).status, 401);
    assert.equal((await request("/articles", 2)).status, 200);
  });
});

test("successful sign-ins do not exhaust failed-attempt quota; failed attempts still do", async () => {
  await withApi(async (request) => {
    for (let i = 0; i < 20; i++) assert.equal((await request("/auth/login")).status, 200);
    for (let i = 0; i < 3; i++) assert.equal((await request("/auth/login", undefined, false)).status, 401);
    const blocked = await request("/auth/login");
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal((await request("/auth/me", 1)).status, 200);
    assert.equal((await request("/auth/logout", 1)).status, 200);
    // Login and first-account setup retain a shared brute-force quota.
    assert.equal((await request("/auth/setup")).status, 429);
  });
});

test("session controls retain an independent limit, including query/trailing-slash variants", async () => {
  await withApi(async (request) => {
    for (let i = 0; i < 4; i++) assert.equal((await request("/auth/me/?refresh=1", 1)).status, 200);
    assert.equal((await request("/auth/me", 1)).status, 429);
    assert.equal((await request("/articles", 1)).status, 200);
    assert.equal((await request("/auth/me", 2)).status, 200);
    assert.equal((await request("/auth/login/", 1)).status, 200);
  });
});

test("ingress limiting runs before expensive handlers and isolates credentials and session controls", async () => {
  const app = express();
  let handled = 0;
  app.use("/api", rateLimit({ ...ingressRateLimitOptions, limit: 2 }));
  app.use("/api", (_req, res) => { handled++; res.json({}); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(path: string, method = "GET") {
    const response = await fetch(`${base}/api${path}`, { method });
    await response.text();
    return response.status;
  }
  try {
    assert.equal(await request("/articles"), 200);
    assert.equal(await request("/articles"), 200);
    assert.equal(await request("/articles"), 429);
    assert.equal(handled, 2);
    assert.equal(await request("/auth/me/?q=1"), 200);
    assert.equal(await request("/auth/logout/", "POST"), 200);
    assert.equal(await request("/auth/me"), 429);
    assert.equal(await request("/auth/login", "POST"), 200);
    assert.equal(await request("/auth/setup/", "POST"), 200);
    assert.equal(await request("/auth/login", "POST"), 429);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
