import test from "node:test";
import assert from "node:assert/strict";
import { rememberOAuthReturn, takeOAuthReturn } from "../src/lib/oauth-return";

test("OAuth return storage provides only query parameters for a fixed same-origin route", t => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const location = { origin: "https://memex.test", search: "" };
  const entries = new Map<string, string>();
  const storage = {
    setItem: (key: string, value: string) => { entries.set(key, value); },
    getItem: (key: string) => entries.get(key) ?? null,
    removeItem: (key: string) => { entries.delete(key); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location } });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
  t.after(() => {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
    if (storageDescriptor) Object.defineProperty(globalThis, "sessionStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  });
  const remember = (value: string) => {
    location.search = `?${new URLSearchParams({ returnTo: value })}`;
    rememberOAuthReturn();
  };
  const valid = "/api/oauth/authorize?client_id=test&state=%23%2F%2Fevil.test&redirect_uri=https%3A%2F%2Fclient.test%2Fcallback";
  remember(valid);
  const query = takeOAuthReturn();
  assert.ok(query instanceof URLSearchParams);
  assert.equal(query.get("state"), "#//evil.test");
  const destination = new URL(`/api/oauth/authorize?${query.toString()}`, location.origin);
  assert.equal(destination.origin, location.origin);
  assert.equal(destination.pathname, "/api/oauth/authorize");
  assert.equal(query.get("redirect_uri"), "https://client.test/callback");
  assert.equal(takeOAuthReturn(), null, "A successful return can only be consumed once");
  for (const invalid of [
    "javascript:alert(1)", "data:text/html,<script>alert(1)</script>",
    "//evil.test/api/oauth/authorize?x=1", "https://evil.test/api/oauth/authorize?x=1",
    "/\\evil.test/api/oauth/authorize?x=1", "/api/oauth/authorize/../token?x=1",
    "/api/oauth/authorize%3Fstate=x", `/api/oauth/authorize?state=${"x".repeat(8192)}`,
  ]) {
    remember(invalid);
    assert.equal(entries.size, 0, "Reject unsafe input before persisting it");
    storage.setItem("memex.oauth.return", invalid);
    assert.equal(takeOAuthReturn(), null, "Revalidate tampered session storage");
    assert.equal(entries.size, 0, "Discard rejected stored input");
  }
});
