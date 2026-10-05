import assert from "node:assert/strict";
import test from "node:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, Plugin } from "@tiptap/pm/state";
import { undo, redo, history } from "@tiptap/pm/history";
import { Citation, CitationSources, normalizeCitations, sourceNodes, validCitation } from "./citation-extension";

const schema = getSchema([StarterKit, Citation, CitationSources]);
const cite = (id: string, description = "Example source", url = "https://example.test/source") =>
  schema.nodes.citation.create({ id, description, url, number: 99 });
function state(...references: ReturnType<typeof cite>[]) {
  return EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, schema.nodes.paragraph.create(null,
      references.flatMap((ref, i) => [schema.text(`word${i}`), ref]))),
    plugins: [history(), new Plugin({
      appendTransaction: (transactions, _old, next) => transactions.some((tr) => tr.docChanged) ? normalizeCitations(next) : null,
    })],
  });
}
const entries = (s: EditorState) => s.doc.lastChild?.attrs.entries ?? [];

test("citations number by first occurrence, deduplicate sources and repair copied IDs", () => {
  let s = state(cite("c-one"), cite("c-one"), cite("c-third", "Different", "https://example.test/other"));
  s = s.applyTransaction(normalizeCitations(s)!).state;
  const refs: { number: number; id: string }[] = [];
  s.doc.descendants((node) => { if (node.type.name === "citation") refs.push(node.attrs as typeof refs[number]); });
  assert.deepEqual(refs.map(r => r.number), [1, 1, 2]);
  assert.notEqual(refs[0].id, refs[1].id);
  assert.equal(entries(s).length, 2);
  assert.equal(entries(s)[0].refs.length, 2);
  assert.equal(normalizeCitations(s), null);
  assert.match(JSON.stringify(sourceNodes(entries(s))), /cite-source-1/);
});

test("removing references cleans sources and renumbers; undo and redo keep the list synchronized", () => {
  let s = state(cite("c-one"), cite("c-two", "Second", "https://example.test/two"));
  s = s.applyTransaction(normalizeCitations(s)!).state;
  let pos = 0;
  s.doc.descendants((node, p) => { if (node.type.name === "citation" && node.attrs.id === "c-one") pos = p; });
  s = s.applyTransaction(s.tr.delete(pos, pos + 1)).state;
  assert.equal(entries(s).length, 1);
  assert.equal(entries(s)[0].number, 1);
  assert.equal(entries(s)[0].description, "Second");
  assert.ok(undo(s, tr => { s = s.applyTransaction(tr).state; }));
  assert.equal(entries(s).length, 2);
  assert.ok(redo(s, tr => { s = s.applyTransaction(tr).state; }));
  assert.equal(entries(s).length, 1);
  s.doc.descendants((node, p) => { if (node.type.name === "citation") pos = p; });
  s = s.applyTransaction(s.tr.delete(pos, pos + 1)).state;
  assert.equal(s.doc.lastChild?.type.name, "paragraph");
  assert.equal(s.doc.textContent, "word0word1");
});

test("editing a source and moving a reference derive the new order", () => {
  let s = state(cite("c-one"), cite("c-two", "Second", "https://example.test/two"));
  s = s.applyTransaction(normalizeCitations(s)!).state;
  let pos = 0;
  s.doc.descendants((node, p) => { if (node.type.name === "citation" && node.attrs.id === "c-two") pos = p; });
  const node = s.doc.nodeAt(pos)!;
  s = s.applyTransaction(s.tr.delete(pos, pos + 1).insert(1, node)).state;
  assert.equal(entries(s)[0].description, "Second");
  s = s.applyTransaction(s.tr.setNodeMarkup(1, undefined, { ...node.attrs, description: "Changed" })).state;
  assert.equal(entries(s)[0].description, "Changed");
});

test("source validation rejects unsafe schemes, empty fields and oversized metadata", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "//example.test", "https://example.test/\n", "mailto:a@example.test"]) {
    assert.equal(validCitation("Source", url), false);
  }
  assert.equal(validCitation("", "https://example.test"), false);
  assert.equal(validCitation("x".repeat(1001), "https://example.test"), false);
  assert.equal(validCitation('<script>literal text</script> [[literal]]', "https://example.test/?a=1&b=2"), true);
});

test("citation-free documents are unchanged", () => {
  const s = state();
  assert.equal(normalizeCitations(s), null);
});