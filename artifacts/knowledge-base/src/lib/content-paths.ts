export type ContentKind = "knowledge" | "policy" | "procedure";
export type ContentArea = "knowledge" | "policies" | "procedures";

export const AREA_BASE: Record<ContentArea, string> = {
  knowledge: "/knowledge",
  policies: "/policies",
  procedures: "/procedures",
};

export const KIND_AREA: Record<ContentKind, ContentArea> = {
  knowledge: "knowledge",
  policy: "policies",
  procedure: "procedures",
};

export const AREA_KIND: Record<ContentArea, ContentKind> = {
  knowledge: "knowledge",
  policies: "policy",
  procedures: "procedure",
};

export const KIND_LABEL: Record<ContentKind, string> = {
  knowledge: "Knowledge",
  policy: "Policy",
  procedure: "Procedure",
};

export function normalizeKind(kind?: string | null): ContentKind {
  return kind === "policy" || kind === "procedure" ? kind : "knowledge";
}

export function kindBasePath(kind?: string | null): string {
  return AREA_BASE[KIND_AREA[normalizeKind(kind)]];
}

/** Canonical path for any article-like record (log entries keep their own route). */
export function articlePathFor(a: {
  slug: string;
  kind?: string | null;
  logOwnerId?: number | null;
  logSlug?: string | null;
}): string {
  if (a.logOwnerId && a.logSlug) return `/logs/${a.logOwnerId}/${a.logSlug}`;
  return `${kindBasePath(a.kind)}/${a.slug}`;
}

/** Strip characters that would break [[slug|label]] syntax. */
export function wikilinkLabel(title: string): string {
  return title.replace(/[\[\]|]/g, " ").replace(/\s+/g, " ").trim();
}
