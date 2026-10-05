import type TurndownService from "turndown";

// Preserve the self-contained custom nodes in Markdown, just as raw HTML is
// preserved in the lossless ZIP. Marked can read them back without metadata loss.
export function preserveCitationHtml(turndown: TurndownService) {
  turndown.addRule("citations", {
    filter: (node) => ["citation", "citation-sources"].includes(node.getAttribute("data-type") ?? ""),
    replacement: (_content, node) => node.nodeName === "DIV"
      ? `\n\n${node.outerHTML}\n\n` : node.outerHTML,
  });
}