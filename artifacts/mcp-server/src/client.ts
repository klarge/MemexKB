/**
 * Thin typed wrapper around the Memex REST API.
 * Each instance uses only the token from its own authenticated MCP request.
 */

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

type ArticleListParams = {
  search?: string;
  tagId?: number;
  limit?: number;
  offset?: number;
  sort?: "title" | "updated_at" | "created_at";
  order?: "asc" | "desc";
};

export function createApiClient(token: string) {
  const baseUrl = (process.env.MEMEX_URL ?? "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("MEMEX_URL environment variable is not set");
  const timeoutMs = Number(process.env.MCP_API_TIMEOUT_MS ?? "10000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
    throw new Error("MCP_API_TIMEOUT_MS must be between 100 and 60000 milliseconds");
  }

  async function apiFetch<T>(path: string): Promise<T> {
    const response = await fetch(`${baseUrl}/api${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Memex API ${response.status} for ${path}`);
    }
    return response.json() as Promise<T>;
  }

  async function listArticles(params: ArticleListParams): Promise<ArticleListResponse> {
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

  async function getArticle(slug: string): Promise<Article> {
    return apiFetch<Article>(`/articles/${encodeURIComponent(slug)}`);
  }

  async function listTags(): Promise<Tag[]> {
    return apiFetch<Tag[]>("/tags");
  }

  return { listArticles, getArticle, listTags };
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
