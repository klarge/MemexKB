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
  const matches = html.match(/\[\[([^\]]+)\]\]/g) ?? [];
  return [...new Set(matches.map((m) => {
    const body = m.slice(2, -2);
    const divider = body.indexOf("|");
    return (divider === -1 ? body : body.slice(0, divider)).trim();
  }))];
}

export function wikilinkSlug(title: string): string {
  return slugify(title);
}

export function rewriteWikilinksForSlug(html: string, oldSlug: string, newSlug: string): string {
  return html.replace(/\[\[([^\]]+)\]\]/g, (match, rawBody: string) => {
    const divider = rawBody.indexOf("|");
    const target = (divider === -1 ? rawBody : rawBody.slice(0, divider)).trim();
    if (slugify(target) !== oldSlug) return match;

    const label = divider === -1 ? target : rawBody.slice(divider + 1).trim();
    return `[[${newSlug}|${label}]]`;
  });
}
