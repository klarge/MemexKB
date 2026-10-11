import test from "node:test";
import assert from "node:assert/strict";
import { extractWikilinks, rewriteWikilinksForSlug } from "../src/lib/slugify";
import { frontendUrl } from "../src/lib/frontend-url";
import { bearerToken } from "../src/lib/bearer-header";
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
  } finally {
    globalThis.fetch = originalFetch;
    setBaseUrl(null);
  }
});
