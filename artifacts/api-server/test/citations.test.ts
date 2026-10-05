import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import TurndownService from "turndown";
import { marked } from "marked";
import { sanitizeArticleHtml } from "../src/lib/sanitize";
import { extractWikilinks, rewriteWikilinksForSlug } from "../src/lib/slugify";
import { preserveCitationHtml } from "../src/lib/citation-export";

const html = '<p>word<sup data-type="citation" data-citation-id="c-test" data-citation-description="A &quot;source&quot; [[literal]]" data-citation-url="https://example.test/?a=1&amp;b=2" data-citation-number="1"><a id="cite-ref-c-test" href="#cite-source-1">[1]</a></sup> [[real]]</p><div data-type="citation-sources"><h2>Sources</h2><ol><li id="cite-source-1">A &quot;source&quot; [[literal]] — <a href="https://example.test/?a=1&amp;b=2">URL</a> <a href="#cite-ref-c-test">↩</a></li></ol></div>';

test("citations retain escaped metadata and local anchors through sanitization", () => {
  const saved = sanitizeArticleHtml(html);
  for (const part of ['data-citation-id="c-test"', 'data-citation-description=', 'data-citation-url=', 'id="cite-source-1"', 'id="cite-ref-c-test"', 'href="#cite-source-1"']) {
    assert.ok(saved.includes(part), part);
  }
  assert.equal(sanitizeArticleHtml(saved), saved);
});

test("citation metadata cannot execute scripts or retain unsafe source schemes or arbitrary IDs", () => {
  const saved = sanitizeArticleHtml('<sup data-type="citation" data-citation-url="javascript:alert(1)" onclick="alert(1)"><a id="arbitrary" href="javascript:alert(1)">[1]</a></sup><li id="arbitrary"><script>alert(1)</script></li>');
  assert.ok(!saved.includes("javascript:"));
  assert.ok(!saved.includes("onclick"));
  assert.ok(!saved.includes("<script"));
  assert.ok(!saved.includes('id="arbitrary"'));
});

test("source descriptions are never indexed or rewritten as wikilinks", () => {
  assert.deepEqual(extractWikilinks(html), ["real"]);
  const rewritten = rewriteWikilinksForSlug(html, "literal", "changed");
  assert.equal(rewritten, html);
  assert.ok(rewriteWikilinksForSlug(html, "real", "renamed").includes("[[renamed|real]]"));
  assert.deepEqual(extractWikilinks(html.replace(/data-type="([^"]+)"/g, "data-type=$1")), ["real"]);
  const ordinary = `<div data-type="infobox" data-title="literal data-type='citation'">[[real]]</div>`;
  assert.deepEqual(extractWikilinks(ordinary), ["real"]);
  assert.ok(rewriteWikilinksForSlug(ordinary, "real", "renamed").includes("[[renamed|real]]"));
});

test("Markdown export/import preserves citation nodes, metadata and source entries", async () => {
  const td = new TurndownService();
  preserveCitationHtml(td);
  const exported = td.turndown(html);
  const restored = sanitizeArticleHtml(await marked.parse(exported));
  assert.ok(restored.includes('data-citation-id="c-test"'));
  assert.ok(restored.includes('data-citation-description="A &quot;source&quot; [[literal]]"'));
  assert.ok(restored.includes('data-type="citation-sources"'));
  assert.ok(restored.includes('id="cite-source-1"'));
});

test("editor citation normalization regression checks", async () => {
  const path = fileURLToPath(new URL("../../knowledge-base/src/lib/citation-extension.test.ts", import.meta.url));
  // Nested Node runners must not inherit the parent's worker flag: otherwise
  // --test can exit successfully without actually discovering the child tests.
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "--test", path], {
    timeout: 30_000, env: { ...process.env, NODE_TEST_CONTEXT: undefined },
  });
  assert.match(stdout, /tests 5/);
});