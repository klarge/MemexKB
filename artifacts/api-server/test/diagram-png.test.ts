import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync, deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import TurndownService from "turndown";
import { marked } from "marked";
import { readDiagramPng, DIAGRAM_XML_LIMIT } from "../src/lib/diagram-png";
import { sanitizeArticleHtml } from "../src/lib/sanitize";
import { preserveDiagramHtml } from "../src/lib/diagram-export";

const fixture = readFileSync(new URL("./fixtures/drawio-local.png", import.meta.url));
const graph = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
const xml = `<mxfile><diagram name="First">${graph}</diagram></mxfile>`;
function chunk(type: string, data: Buffer) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let b = 0; b < 8; b++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, bytes, sum]);
}
function png(source: string, type = "tEXt", dimensions?: [number, number]) {
  const header = Buffer.from(fixture.subarray(16, 29));
  if (dimensions) { header.writeUInt32BE(dimensions[0], 0); header.writeUInt32BE(dimensions[1], 4); }
  const text = Buffer.from(encodeURIComponent(source));
  const data = type === "zTXt" ? Buffer.concat([Buffer.from("mxfile\0\0"), deflateSync(text)])
    : type === "iTXt" ? Buffer.concat([Buffer.from("mxfile\0\x01\0\0\0"), deflateSync(text)])
    : Buffer.concat([Buffer.from("mxfile\0"), text]);
  return Buffer.concat([fixture.subarray(0, 8), chunk("IHDR", header), chunk(type, data), chunk("IEND", Buffer.alloc(0))]);
}

test("actual self-hosted xmlpng export preserves source and does not mutate bytes", () => {
  const before = Buffer.from(fixture);
  const source = readDiagramPng(fixture);
  assert.match(source!, /Example workflow/);
  assert.match(source!, /<mxGraphModel/);
  assert.deepEqual(fixture, before);
  assert.equal(readDiagramPng(Buffer.from("ordinary JPEG")), null);
});
test("plain, compressed and international PNG text metadata decode identically", () => {
  for (const type of ["tEXt", "zTXt", "iTXt"]) {
    assert.equal(readDiagramPng(png(xml, type)), xml);
  }
  const unicode = xml.replace("First", "Café &amp; 日本語");
  assert.equal(readDiagramPng(png(unicode)), unicode);
});
test("compressed draw.io pages remain editable and have an expanded source limit", () => {
  const encode = (text: string) => deflateRawSync(Buffer.from(encodeURIComponent(text))).toString("base64");
  const valid = `<mxfile><diagram>${encode(graph)}</diagram></mxfile>`;
  assert.equal(readDiagramPng(png(valid)), valid);
  const bomb = `<mxfile><diagram>${encode("a".repeat(DIAGRAM_XML_LIMIT + 1))}</diagram></mxfile>`;
  assert.throws(() => readDiagramPng(png(bomb)));
  const nested = `<mxfile><diagram>${encode(xml)}</diagram></mxfile>`;
  assert.throws(() => readDiagramPng(png(nested)), /valid draw.io/);
});
test("invalid PNG chunks, checksum, XML and unsafe dimensions are rejected", () => {
  assert.throws(() => readDiagramPng(fixture.subarray(0, fixture.length - 3)), /Invalid PNG|Truncated/);
  const damaged = Buffer.from(fixture); damaged[22] ^= 1;
  assert.throws(() => readDiagramPng(damaged), /checksum/);
  assert.throws(() => readDiagramPng(png("<html/>")), /valid draw.io/);
  assert.throws(() => readDiagramPng(png('<!DOCTYPE mxfile [<!ENTITY x "bad">]>' + xml)), /declarations/);
  assert.throws(() => readDiagramPng(png(xml + "<other/>")), /valid draw.io/);
  assert.throws(() => readDiagramPng(png("<mxfile/>")), /no pages/);
  assert.throws(() => readDiagramPng(png(xml, "tEXt", [8193, 1])), /too large/);
  assert.throws(() => readDiagramPng(png(xml, "tEXt", [5000, 5000])), /too large/);
  assert.throws(() => readDiagramPng(png(xml.replace("First", "x".repeat(DIAGRAM_XML_LIMIT)))), /too large|exceeds/);
});
test("diagram identity, width and caption survive sanitizer and portable Markdown", async () => {
  const html = '<p><img src="/api/articles/images/42" data-diagram="drawio" width="480" data-caption="A workflow" onerror="alert(1)"></p>';
  const clean = sanitizeArticleHtml(html);
  assert.match(clean, /data-diagram="drawio"/);
  assert.doesNotMatch(clean, /onerror/);
  assert.doesNotMatch(sanitizeArticleHtml('<img data-diagram="evil" src="/api/articles/images/42">'), /data-diagram/);
  const converter = new TurndownService();
  preserveDiagramHtml(converter);
  const roundtrip = sanitizeArticleHtml(await marked.parse(converter.turndown(clean)));
  assert.match(roundtrip, /data-diagram="drawio"/);
  assert.match(roundtrip, /data-caption="A workflow"/);
  assert.match(roundtrip, /width="480"/);
});
