import { DOMParser } from "@xmldom/xmldom";
import { inflateRawSync } from "node:zlib";
import { DIAGRAM_XML_LIMIT, readDiagramPng } from "./diagram-png";
import { referencedImageIds } from "./media-usage";

/** Editable source can reference an image absent from the flattened PNG preview. */
export function diagramImageIds(bytes: Buffer): Set<number> {
  const source = readDiagramPng(bytes);
  if (!source) return new Set();
  const ids = referencedImageIds(source);
  const doc = new DOMParser().parseFromString(source, "text/xml");
  const pages = doc.getElementsByTagName("diagram");
  for (let i = 0; i < pages.length; i++) {
    const page = pages.item(i)!;
    if (page.getElementsByTagName("mxGraphModel").length) continue;
    const encoded = page.textContent?.trim();
    if (!encoded) continue;
    const expanded = decodeURIComponent(inflateRawSync(Buffer.from(encoded, "base64"), {
      maxOutputLength: DIAGRAM_XML_LIMIT,
    }).toString("utf8"));
    for (const id of referencedImageIds(expanded)) ids.add(id);
  }
  return ids;
}
