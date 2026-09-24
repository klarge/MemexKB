/**
 * Thin typed wrapper around the Memex REST API.
 * Each instance uses only the token from its own authenticated MCP request.
 */
import { convert } from "html-to-text";

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

export interface ProjectSummary {
  id: number;
  name: string;
  description: string;
  archivedAt: string | null;
  updatedAt: string;
  boardCount?: number;
}

export interface ProjectBoard {
  id: number;
  name: string;
  position: number;
  archivedAt: string | null;
}

export interface ProjectDetail extends ProjectSummary {
  boards: ProjectBoard[];
  boardsHasMore: boolean;
  groups: { id: number; name: string }[];
}

export interface ProjectDocumentSummary {
  slug: string;
  title: string;
  updatedAt: string;
}

export interface ProjectDocument extends ProjectDocumentSummary {
  content: string;
  createdAt: string;
  tags: Tag[];
}

export interface BoardCard {
  id: number;
  title: string;
  description: string;
  dueDate: string | null;
  completedAt: string | null;
  members: { id: number; name: string }[];
}

export interface BoardDetail {
  id: number;
  projectId: number;
  name: string;
  archivedAt: string | null;
  cardsTruncated: boolean;
  columns: { id: number; name: string; cards: BoardCard[] }[];
}

export interface CardComment {
  id: number;
  content: string;
  createdAt: string;
  userName: string | null;
}

export interface LogSummary {
  logSlug: string;
  logOwnerId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface LogDetail extends LogSummary {
  content: string;
}

export interface TaskList {
  id: number;
  name: string;
  tasks: { id: number; title: string; completedAt: string | null; createdAt: string }[];
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

  async function listProjects(archived: boolean) {
    return apiFetch<{ projects: ProjectSummary[]; truncated: boolean }>(
      `/projects?archived=${archived}`,
    );
  }

  async function getProject(id: number, limit: number, offset: number) {
    return apiFetch<ProjectDetail>(`/projects/${id}?limit=${limit}&offset=${offset}`);
  }

  async function getBoard(id: number) {
    return apiFetch<BoardDetail>(`/boards/${id}`);
  }

  async function listProjectDocuments(projectId: number, limit: number, offset: number) {
    return apiFetch<{ documents: ProjectDocumentSummary[]; hasMore: boolean }>(
      `/projects/${projectId}/documents?limit=${limit}&offset=${offset}`,
    );
  }

  async function getProjectDocument(projectId: number, slug: string) {
    return apiFetch<ProjectDocument>(`/projects/${projectId}/documents/${encodeURIComponent(slug)}`);
  }

  async function getCardComments(cardId: number, limit: number, offset: number) {
    const comments = await apiFetch<CardComment[]>(
      `/cards/${cardId}/comments?limit=${limit + 1}&offset=${offset}&order=desc`,
    );
    return { comments: comments.slice(0, limit), hasMore: comments.length > limit };
  }

  async function listLogs(limit: number, offset: number) {
    return apiFetch<{ entries: LogSummary[]; hasMore: boolean }>(
      `/log?limit=${limit}&offset=${offset}`,
    );
  }

  async function getMyLog(userId: number, logSlug: string) {
    // The ID comes from the verified /auth/me response, never MCP tool arguments.
    return apiFetch<LogDetail>(`/logs/${userId}/${encodeURIComponent(logSlug)}`);
  }

  async function listTaskLists() {
    return apiFetch<{ lists: TaskList[]; truncated: boolean }>("/tasks/lists");
  }

  return {
    listArticles, getArticle, listTags,
    listProjects, getProject, getBoard, listProjectDocuments, getProjectDocument, getCardComments,
    listLogs, getMyLog, listTaskLists,
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** Parse HTML once into plain text; never treat decoded text as HTML. */
export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [{ selector: "a", options: { ignoreHref: true } }],
  }).trim();
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
