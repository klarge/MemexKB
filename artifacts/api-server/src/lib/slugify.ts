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
  return [...new Set(matches.map((m) => m.slice(2, -2).trim()))];
}

export function wikilinkSlug(title: string): string {
  return slugify(title);
}
