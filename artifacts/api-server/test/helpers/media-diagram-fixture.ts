import { deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";

/** Synthetic editable PNG with a compressed page referencing another media ID. */
export function mediaDiagramPng(dependency: number): Buffer {
  const ordinary = readFileSync(new URL("../fixtures/drawio-local.png", import.meta.url));
  const xml = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" parent="1" style="shape=image;image=/api/articles/images/${dependency};" vertex="1"><mxGeometry width="30" height="30" as="geometry"/></mxCell></root></mxGraphModel>`;
  const source = `<mxfile><diagram name="Page-1">${deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString("base64")}</diagram></mxfile>`;
  const payload = Buffer.concat([Buffer.from("tEXt"), Buffer.from(`mxfile\0${source}`)]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const chunk = Buffer.alloc(payload.length + 8);
  chunk.writeUInt32BE(payload.length - 4);
  payload.copy(chunk, 4);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  // Retain PNG drawing chunks, replacing the original embedded source.
  const chunks = [ordinary.subarray(0, 8)];
  let offset = 8;
  while (offset < ordinary.length) {
    const end = offset + 12 + ordinary.readUInt32BE(offset);
    const type = ordinary.toString("ascii", offset + 4, offset + 8);
    if (type === "IEND") chunks.push(chunk);
    if (!["tEXt", "zTXt", "iTXt"].includes(type)) chunks.push(ordinary.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(chunks);
}
