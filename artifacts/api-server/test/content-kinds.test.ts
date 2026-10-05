import assert from "node:assert/strict";
import { test } from "node:test";
import { contentWithSteps, isContentKind, validateSteps } from "../src/lib/content-kinds";
import { extractWikilinks, rewriteWikilinksForSlug } from "../src/lib/slugify";

test("content kinds distinguish ordinary knowledge, policies, and procedures", () => {
  for (const kind of ["knowledge", "policy", "procedure"]) assert.equal(isContentKind(kind), true);
  for (const kind of [null, "log", "project", "Policy", {}]) assert.equal(isContentKind(kind), false);
});
test("procedure steps preserve source order and sanitize descriptions", () => {
  const steps = validateSteps([
    { title: " Review ", description: '<p>Read [[review-policy|Review Policy]]</p><script>alert(1)</script>' },
    { title: "Act", description: "Take action" },
  ]);
  assert.deepEqual(steps.map((s) => s.title), ["Review", "Act"]);
  assert.equal(steps[0].description.includes("<script"), false);
  assert.deepEqual(extractWikilinks(contentWithSteps({ content: "", procedureSteps: steps })), ["review-policy"]);
});
test("procedure steps require meaningful titles/descriptions and at least one step", () => {
  for (const steps of [[], null, {}, [{ title: "", description: "Yes" }], [{ title: "Yes", description: "<p> </p>" }], [{ title: 1, description: "Yes" }]]) {
    assert.throws(() => validateSteps(steps));
  }
});
test("step titles are escaped in portable content and wikilink labels survive URL changes", () => {
  const content = contentWithSteps({ content: "<p>Intro</p>", procedureSteps: [{ title: '<img src=x onerror="alert(1)">', description: "[[old-url|Keep this label]]" }] });
  assert.equal(content.includes("<img"), false);
  assert.ok(content.includes("&lt;img"));
  assert.ok(rewriteWikilinksForSlug(content, "old-url", "new-url").includes("[[new-url|Keep this label]]"));
});