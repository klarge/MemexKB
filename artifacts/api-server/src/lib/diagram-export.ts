import type TurndownService from "turndown";

/** Keep diagram identity/caption/width when portable Markdown is reimported.
 * The image file itself still carries all editable source. */
export function preserveDiagramHtml(turndown: TurndownService) {
  turndown.addRule("drawio-image", {
    filter: node => node.nodeName === "IMG" && node.getAttribute("data-diagram") === "drawio",
    replacement: (_content, node) => node.outerHTML,
  });
}
