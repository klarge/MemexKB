import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeArticleHtml } from "../src/lib/sanitize";

test("ordered lists retain explicit styles and starting numbers through saving", () => {
  for (const type of ["1", "a", "A", "i", "I"]) {
    const html = `<ol type="${type}" start="3"><li>Item<ol type="a"><li>Nested</li></ol></li></ol>`;
    assert.equal(sanitizeArticleHtml(html), html);
    assert.equal(sanitizeArticleHtml(sanitizeArticleHtml(html)), html);
  }
});

test("automatic lists keep their depth-based default without forced attributes", () => {
  const html = "<ol><li>Item<ol><li>Nested</li></ol></li></ol>";
  assert.equal(sanitizeArticleHtml(html), html);
});

test("invalid ordered-list styles and unsafe attributes are discarded", () => {
  assert.equal(
    sanitizeArticleHtml('<ol type="bogus" start="3px" onclick="alert(1)" style="color:red"><li>Item</li></ol>'),
    "<ol><li>Item</li></ol>",
  );
});
