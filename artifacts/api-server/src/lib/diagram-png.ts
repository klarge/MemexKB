import { inflateSync, inflateRawSync } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";

export const DIAGRAM_PNG_LIMIT = 10 * 1024 * 1024;
export const DIAGRAM_XML_LIMIT = 2 * 1024 * 1024;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const table = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function validateXml(xml: string, page = false) {
  if (Buffer.byteLength(xml) > DIAGRAM_XML_LIMIT || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("Diagram source is too large or contains unsupported XML declarations.");
  }
  const errors: string[] = [];
  const document = new DOMParser({ errorHandler: {
    warning: message => errors.push(message), error: message => errors.push(message),
    fatalError: message => { throw new Error(message); },
  } }).parseFromString(xml, "text/xml");
  const root = document.documentElement;
  if (errors.length || !root || !(page ? root.tagName === "mxGraphModel" : ["mxfile", "mxGraphModel"].includes(root.tagName))) {
    throw new Error("PNG does not contain valid draw.io diagram source.");
  }
  const diagrams = root.tagName === "mxfile" ? Array.from(document.getElementsByTagName("diagram")) : [];
  if (root.tagName === "mxfile" && !diagrams.length) throw new Error("A diagram file has no pages.");
  if (diagrams.length > 100) throw new Error("A diagram may contain at most 100 pages.");
  let total = Buffer.byteLength(xml);
  // Bound compressed pages as well as the outer XML; embedded source can
  // otherwise be a tiny compressed payload expanding into a huge document.
  for (const diagram of diagrams) {
    if (diagram.getElementsByTagName("mxGraphModel").length) continue;
    const text = diagram.textContent?.trim();
    if (!text || !/^[A-Za-z0-9+/=\s]+$/.test(text)) throw new Error("A diagram page has no valid editable content.");
    const raw = inflateRawSync(Buffer.from(text, "base64"), { maxOutputLength: DIAGRAM_XML_LIMIT });
    const page = decodeURIComponent(raw.toString("utf8"));
    total += Buffer.byteLength(page);
    if (total > DIAGRAM_XML_LIMIT) throw new Error("Expanded diagram source exceeds 2 MB.");
    validateXml(page, true);
  }
  return xml;
}

/** Returns null for an ordinary image, or validates its embedded draw.io XML.
 * The original PNG bytes are never rewritten: source and preview stay together. */
export function readDiagramPng(bytes: Buffer): string | null {
  if (!bytes.subarray(0, 8).equals(signature)) return null;
  if (bytes.length > DIAGRAM_PNG_LIMIT) throw new Error("Diagram PNG exceeds 10 MB.");
  let source: string | null = null;
  let offset = 8;
  let ended = false;
  let width = 0, height = 0;
  let first = true;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("Truncated PNG chunk.");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, end - 4);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) {
      throw new Error("PNG checksum is invalid.");
    }
    if (first) {
      if (type !== "IHDR" || length !== 13) throw new Error("Invalid PNG header.");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      first = false;
    }
    if (["tEXt", "zTXt", "iTXt"].includes(type)) {
      const separator = data.indexOf(0);
      if (separator >= 0 && data.toString("ascii", 0, separator) === "mxfile") {
        if (source !== null) throw new Error("PNG contains duplicate diagram source.");
        let encoded = data.subarray(separator + 1);
        if (type === "zTXt") {
          if (encoded[0] !== 0) throw new Error("Unsupported diagram compression.");
          encoded = inflateSync(encoded.subarray(1), { maxOutputLength: DIAGRAM_XML_LIMIT * 3 });
        } else if (type === "iTXt") {
          const compressed = encoded[0];
          if (![0, 1].includes(compressed) || encoded[1] !== 0) throw new Error("Unsupported diagram compression.");
          const languageEnd = encoded.indexOf(0, 2);
          const translatedEnd = encoded.indexOf(0, languageEnd + 1);
          if (languageEnd < 0 || translatedEnd < 0) throw new Error("Invalid PNG text chunk.");
          encoded = encoded.subarray(translatedEnd + 1);
          if (compressed) encoded = inflateSync(encoded, { maxOutputLength: DIAGRAM_XML_LIMIT * 3 });
        }
        if (encoded.length > DIAGRAM_XML_LIMIT * 3) throw new Error("Diagram source exceeds 2 MB.");
        const text = encoded.toString("utf8");
        source = validateXml(text.startsWith("<") ? text : decodeURIComponent(text));
      }
    }
    offset = end;
    if (type === "IEND") { ended = true; break; }
  }
  if (!ended || offset !== bytes.length || !width || !height) throw new Error("Invalid PNG structure.");
  if (source && (width > 8192 || height > 8192 || width * height > 16_000_000)) {
    throw new Error("Diagram is too large. Use a smaller export scale or split it into pages.");
  }
  return source;
}
