import test from "node:test";
import assert from "node:assert/strict";
import { extractWikilinks, rewriteWikilinksForSlug } from "../src/lib/slugify";
import { frontendUrl } from "../src/lib/frontend-url";
import { bearerToken } from "../src/lib/bearer-header";
import { newOAuthSecret, hashOAuth, pkceChallenge } from "../src/lib/oauth";
import { setBaseUrl, customFetch } from "../../../lib/api-client-react/src/custom-fetch";

test("wikilink scanning preserves existing bracket and label semantics", () => {
  for (const text of ["[[One]] [[Two|label]]", "[[]]", "[[[Nested]]", "[[bad] [[Good]]", "[[a][[b]]", "[[a]]]", "[[a|b]] [[a|b]]"]) {
    const expected = [...new Set((text.match(/\[\[([^\]]+)\]\]/g) ?? []).map(match => match.slice(2, -2).split("|")[0].trim()))];
    assert.deepEqual(extractWikilinks(text), expected);
  }
  assert.equal(rewriteWikilinksForSlug("[[Old Name|Label]] [[Other]]", "old-name", "new-name"), "[[new-name|Label]] [[Other]]");
  const malformed = "[".repeat(300_000);
  assert.deepEqual(extractWikilinks(malformed), []);
  assert.equal(rewriteWikilinksForSlug(malformed, "old", "new"), malformed);
});

test("bearer parsing handles whitespace and rejects malformed schemes or token line breaks", () => {
  assert.equal(bearerToken("bEaReR \t token-value  "), "token-value");
  for (const header of [undefined, "Bearer", "Bearerx token", "Basic token", `Bearer${" ".repeat(300_000)}`, "Bearer a\nb"]) {
    assert.equal(bearerToken(header), null);
  }
});

test("public and client base URLs remove a long trailing slash run without changing interior slashes", async () => {
  const base = `https://example.com/path${"/".repeat(300_000)}`;
  assert.equal(frontendUrl({ protocol: "https", get: () => "example.com" }, base), "https://example.com/path");
  const originalFetch = globalThis.fetch;
  try {
    setBaseUrl(base);
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      assert.equal(String(url), "https://example.com/path/api/test");
      return new Response('{"ok":true}', { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    assert.deepEqual(await customFetch("/api/test"), { ok: true });
    assert.deepEqual(await customFetch("/api/test", { baseUrl: base }), { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
    setBaseUrl(null);
  }
});

test("OAuth PKCE uses the RFC 7636 S256 vector and token digests cover 256-bit random credentials", () => {
  assert.equal(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const token = newOAuthSecret();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(token, "base64url").length, 32);
  assert.notEqual(newOAuthSecret(), token);
  assert.match(hashOAuth(token), /^[a-f0-9]{64}$/);
  assert.equal(hashOAuth(token), hashOAuth(token));
});
