/** Transform non-citation regions without reserializing unrelated stored HTML.
 * The tokenizer respects quoted attributes; saved citations are sanitized HTML.
 * Both inline metadata and the derived bibliography are literal source text,
 * never wiki targets, even when their description contains bracket syntax.
 */
export function outsideCitations(html: string, transform: (text: string) => string): string {
  const tags = /<(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
  let result = "", cursor = 0, protectedStart = 0, depth = 0, protectedTag = "";
  for (const match of html.matchAll(tags)) {
    const token = match[0];
    const tag = /^<\/?([a-z0-9]+)/i.exec(token)?.[1]?.toLowerCase();
    if (!tag) continue;
    const closing = token.startsWith("</");
    // Read complete attribute values so "data-type='citation'" inside an
    // ordinary infobox's quoted title is not mistaken for an actual attribute.
    const typeAttribute = Array.from(token.matchAll(/\s([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))
      .find((attribute) => attribute[1].toLowerCase() === "data-type");
    const dataType = typeAttribute?.[2] ?? typeAttribute?.[3] ?? typeAttribute?.[4];
    if (!depth && !closing && ["sup", "div"].includes(tag) &&
        ["citation", "citation-sources"].includes(dataType?.toLowerCase() ?? "")) {
      result += transform(html.slice(cursor, match.index));
      protectedStart = match.index;
      protectedTag = tag; depth = 1;
    } else if (depth && tag === protectedTag) {
      depth += closing ? -1 : 1;
      if (!depth) {
        cursor = match.index + token.length;
        result += html.slice(protectedStart, cursor);
      }
    }
  }
  return result + (depth ? html.slice(protectedStart) : transform(html.slice(cursor)));
}