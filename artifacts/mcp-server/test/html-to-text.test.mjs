import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlToText } from "../dist/client.js";

test("HTML conversion handles malformed tags without joining unsafe markup", () => {
  assert.equal(htmlToText("<<script>script>alert(1)"), "<");
  assert.equal(htmlToText("<p>Alpha &amp; Beta</p>"), "Alpha & Beta");
  assert.equal(htmlToText("<p>Before</p><script>alert(1)</script><p>After</p>"), "Before\n\nAfter");
  // An encoded tag is literal text, not parsed or rendered as markup a second time.
  assert.equal(htmlToText("<p>&lt;img src=x onerror=alert(1)&gt;</p>"), "<img src=x onerror=alert(1)>");
});