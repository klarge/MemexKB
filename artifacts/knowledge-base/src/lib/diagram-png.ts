// Bounded decoding/validation of draw.io "XML PNG" files. Everything is local.
export const MAX_DIAGRAM_XML_BYTES = 2 * 1024 * 1024;
export const MAX_DIAGRAM_PNG_BYTES = 10 * 1024 * 1024;
export const MAX_DIAGRAM_DIMENSION = 8192;
export const MAX_DIAGRAM_PIXELS = 16_000_000;
export const EMPTY_DIAGRAM_XML = '<mxfile><diagram id="d1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

export interface ParsedDiagramPng { width: number; height: number; xml: string | null }

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const latin1 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };

async function inflateBounded(data: Uint8Array, format: CompressionFormat = "deflate", limit = MAX_DIAGRAM_XML_BYTES): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot read compressed diagram data.");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel(); throw new Error("Diagram source is too large."); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function checkXml(xml: string, page = false): Promise<string> {
  if (new TextEncoder().encode(xml).length > MAX_DIAGRAM_XML_BYTES) throw new Error("Diagram source is too large.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported diagram XML declarations.");
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror") || !(page ? doc.documentElement.tagName === "mxGraphModel" :
    ["mxfile", "mxGraphModel"].includes(doc.documentElement.tagName))) {
    throw new Error("Diagram source is not valid draw.io XML.");
  }
  if (doc.documentElement.tagName === "mxfile") {
    const diagrams = Array.from(doc.getElementsByTagName("diagram"));
    if (!diagrams.length || diagrams.length > 100) throw new Error("Diagram files must contain between 1 and 100 pages.");
    let total = new TextEncoder().encode(xml).length;
    for (const diagram of diagrams) {
      if (diagram.getElementsByTagName("mxGraphModel").length) continue;
      const text = diagram.textContent?.trim();
      if (!text || !/^[A-Za-z0-9+/=\s]+$/.test(text)) throw new Error("Invalid compressed diagram page.");
      const binary = atob(text);
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      const expanded = decodeURIComponent(new TextDecoder().decode(await inflateBounded(bytes, "deflate-raw")));
      total += new TextEncoder().encode(expanded).length;
      if (total > MAX_DIAGRAM_XML_BYTES) throw new Error("Expanded diagram source exceeds 2 MB.");
      await checkXml(expanded, true);
    }
  }
  return xml;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function parseDiagramPng(bytes: Uint8Array): Promise<ParsedDiagramPng> {
  if (bytes.length > MAX_DIAGRAM_PNG_BYTES) throw new Error("Diagram image is larger than 10 MB.");
  if (bytes.length < 33 || SIG.some((v, i) => bytes[i] !== v)) throw new Error("Not a PNG image.");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8, width = 0, height = 0, xml: string | null = null, sawEnd = false, first = true;
  while (pos + 12 <= bytes.length) {
    const len = dv.getUint32(pos);
    const type = latin1(bytes.subarray(pos + 4, pos + 8));
    const start = pos + 8, end = start + len;
    if (end + 4 > bytes.length) throw new Error("PNG is truncated.");
    if (crc32(bytes.subarray(pos + 4, end)) !== dv.getUint32(end)) throw new Error("PNG checksum is invalid.");
    if (first) {
      if (type !== "IHDR" || len !== 13) throw new Error("PNG header is invalid.");
      width = dv.getUint32(start); height = dv.getUint32(start + 4);
      if (!width || !height || width > MAX_DIAGRAM_DIMENSION || height > MAX_DIAGRAM_DIMENSION || width * height > MAX_DIAGRAM_PIXELS) {
        throw new Error("Diagram image dimensions are too large.");
      }
      first = false;
    } else if (["tEXt", "zTXt", "iTXt"].includes(type)) {
      const chunk = bytes.subarray(start, end);
      const nul = chunk.indexOf(0);
      if (nul > 0 && latin1(chunk.subarray(0, nul)) === "mxfile") {
        if (xml !== null) throw new Error("PNG contains duplicate diagram source.");
        let text: string;
        if (type === "tEXt") text = latin1(chunk.subarray(nul + 1));
        else if (type === "zTXt") {
          if (chunk[nul + 1] !== 0) throw new Error("Unsupported PNG compression.");
          text = new TextDecoder().decode(await inflateBounded(chunk.subarray(nul + 2), "deflate", MAX_DIAGRAM_XML_BYTES * 3));
        } else {
          const compressed = chunk[nul + 1];
          if (![0, 1].includes(compressed) || chunk[nul + 2] !== 0) throw new Error("Unsupported PNG compression.");
          const languageEnd = chunk.indexOf(0, nul + 3);
          const translatedEnd = chunk.indexOf(0, languageEnd + 1);
          if (languageEnd < 0 || translatedEnd < 0) throw new Error("Invalid PNG text chunk.");
          const data = chunk.subarray(translatedEnd + 1);
          text = new TextDecoder().decode(compressed ? await inflateBounded(data, "deflate", MAX_DIAGRAM_XML_BYTES * 3) : data);
        }
        let decoded: string;
        try { decoded = text.startsWith("<") ? text : decodeURIComponent(text); } catch { throw new Error("Diagram source could not be decoded."); }
        xml = await checkXml(decoded);
      }
    }
    pos = end + 4;
    if (type === "IEND") { sawEnd = true; break; }
  }
  if (!sawEnd || pos !== bytes.length) throw new Error("PNG is incomplete or has trailing data.");
  return { width, height, xml };
}

export function dataUriToBytes(uri: string): Uint8Array {
  const prefix = "data:image/png;base64,";
  if (typeof uri !== "string" || !uri.startsWith(prefix)) throw new Error("Export did not return a PNG.");
  if (uri.length > Math.ceil((MAX_DIAGRAM_PNG_BYTES * 4) / 3) + prefix.length + 8) throw new Error("Diagram image is larger than 10 MB.");
  let bin: string;
  try { bin = atob(uri.slice(prefix.length)); } catch { throw new Error("Export returned invalid image data."); }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToPngDataUri(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(s)}`;
}

/** Only same-origin /api/articles/images/N is reopenable. Returns normalized path or null. */
export function localDiagramPath(src: string): string | null {
  try {
    const u = new URL(src, window.location.origin);
    if (u.origin !== window.location.origin || !/^\/api\/articles\/images\/\d+$/.test(u.pathname)) return null;
    return u.pathname;
  } catch { return null; }
}

export async function fetchLocalDiagramPng(src: string): Promise<Uint8Array> {
  const path = localDiagramPath(src);
  if (!path) throw new Error("This image is not stored in this wiki and cannot be edited.");
  const res = await fetch(path, { credentials: "include", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Could not load the diagram image (${res.status}).`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_DIAGRAM_PNG_BYTES) throw new Error("Diagram image is larger than 10 MB.");
  const buf = new Uint8Array(await res.arrayBuffer());
  await parseDiagramPng(buf);
  return buf;
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export const downloadPng = (bytes: Uint8Array, name = "diagram.png") => downloadBlob(name, new Blob([bytes as BlobPart], { type: "image/png" }));
export const downloadDrawio = (xml: string, name = "diagram.drawio") => downloadBlob(name, new Blob([xml], { type: "application/vnd.jgraph.mxfile+xml" }));

/** Download the stored PNG or its embedded .drawio source. */
export async function downloadStoredDiagram(src: string, kind: "png" | "drawio") {
  const bytes = await fetchLocalDiagramPng(src);
  if (kind === "png") return downloadPng(bytes);
  const { xml } = await parseDiagramPng(bytes);
  if (!xml) throw new Error("This image has no embedded diagram source.");
  downloadDrawio(xml);
}
