import { outsideCitations } from "./citation-regions";

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
}

export function extractWikilinks(html: string): string[] {
  const matches: string[] = [];
  outsideCitations(html, (text) => {
    return transformWikilinks(text, (match) => {
      matches.push(match);
      return match;
    });
  });
  return [...new Set(matches.map((m) => {
    const body = m.slice(2, -2);
    const divider = body.indexOf("|");
    return (divider === -1 ? body : body.slice(0, divider)).trim();
  }))];
}

/** Visit each bracket span once, including malformed/unclosed input. */
function transformWikilinks(text: string, transform: (match: string, body: string) => string): string {
  let cursor = 0, copied = 0, result = "";
  while (cursor < text.length) {
    const start = text.indexOf("[[", cursor);
    if (start === -1) break;
    const close = text.indexOf("]", start + 2);
    if (close === -1) break;
    cursor = close + (text[close + 1] === "]" ? 2 : 1);
    if (close === start + 2 || text[close + 1] !== "]") continue;
    result += text.slice(copied, start) + transform(text.slice(start, close + 2), text.slice(start + 2, close));
    copied = close + 2;
  }
  return result + text.slice(copied);
}

export function wikilinkSlug(title: string): string {
  return slugify(title);
}

export function rewriteWikilinksForSlug(html: string, oldSlug: string, newSlug: string): string {
  return outsideCitations(html, (text) => transformWikilinks(text, (match, rawBody) => {
    const divider = rawBody.indexOf("|");
    const target = (divider === -1 ? rawBody : rawBody.slice(0, divider)).trim();
    if (slugify(target) !== oldSlug) return match;

    const label = divider === -1 ? target : rawBody.slice(divider + 1).trim();
    return `[[${newSlug}|${label}]]`;
  }));
}
