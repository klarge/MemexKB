/**
 * Thin typed wrapper around the Memex REST API.
 * Reads MEMEX_URL and MEMEX_TOKEN from the environment.
 */

// ─── Config ───────────────────────────────────────────────────────────────────

export function getConfig(): { baseUrl: string; token: string } {
  const baseUrl = (process.env.MEMEX_URL ?? "").replace(/\/+$/, "");
  const token = process.env.MEMEX_TOKEN ?? "";
  if (!baseUrl) throw new Error("MEMEX_URL environment variable is not set");
  if (!token) throw new Error("MEMEX_TOKEN environment variable is not set");
  return { baseUrl, token };
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T> {
  const { baseUrl, token } = getConfig();
  const url = `${baseUrl}/api${path}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Memex API ${response.status} for ${path}: ${body}`);
  }
  return response.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Tag {
  id: number;
  name: string;
  color: string;
  createdAt: string;
  articleCount: number;
}

export interface ArticleSummary {
  id: number;
  slug: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  updatedByName: string | null;
  isRestricted: boolean;
  canAccess: boolean;
  tags: Tag[];
}

export interface Article extends ArticleSummary {
  content: string;
  backlinks: ArticleSummary[];
}

export interface ArticleListResponse {
  articles: ArticleSummary[];
  total: number;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function listArticles(params: {
  search?: string;
  tagId?: number;
  limit?: number;
  offset?: number;
  sort?: "title" | "updated_at" | "created_at";
  order?: "asc" | "desc";
}): Promise<ArticleListResponse> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.tagId != null) qs.set("tagId", String(params.tagId));
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.offset != null) qs.set("offset", String(params.offset));
  if (params.sort) qs.set("sort", params.sort);
  if (params.order) qs.set("order", params.order);
  const query = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<ArticleListResponse>(`/articles${query}`);
}

export async function getArticle(slug: string): Promise<Article> {
  return apiFetch<Article>(`/articles/${encodeURIComponent(slug)}`);
}

export async function listTags(): Promise<Tag[]> {
  return apiFetch<Tag[]>("/tags");
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** Strip HTML tags and decode common entities for plain-text output. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/(h[1-6]|div|section|article|blockquote|li|tr)>/gi, "\n")
    .replace(/<h([1-6])[^>]*>/gi, (_, n) => "#".repeat(Number(n)) + " ")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function tagList(tags: Tag[]): string {
  return tags.length > 0 ? tags.map((t) => t.name).join(", ") : "none";
}

export function excerpt(content: string, maxLen = 300): string {
  const text = htmlToText(content);
  return text.length > maxLen ? text.slice(0, maxLen).trimEnd() + "…" : text;
}
