#!/usr/bin/env node
/**
 * Memex MCP Server
 *
 * Exposes a Memex knowledge base as five tools for MCP-compatible LLM clients
 * (Claude Desktop, Cursor, VS Code Copilot, etc.).
 *
 * Required env vars:
 *   MEMEX_URL   — base URL of your Memex instance, e.g. http://localhost:3000
 *   MEMEX_TOKEN — API token created in Memex → Settings → API Tokens
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  listArticles,
  getArticle,
  listTags,
  htmlToText,
  formatDate,
  tagList,
  excerpt,
} from "./client.js";

// ─── Server init ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "memex",
  version: "1.0.0",
});

// ─── Tool: search_articles ────────────────────────────────────────────────────

server.tool(
  "search_articles",
  "Search the Memex knowledge base by keyword. Returns titles, slugs, tags, and a short excerpt for each matching article. Use get_article to read the full content of a specific result.",
  {
    query: z.string().min(1).describe("Search query — supports partial matches"),
    tag_id: z
      .number()
      .int()
      .optional()
      .describe("Optional: filter results to a specific tag (use list_tags to get IDs)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe("Maximum number of results to return (default 10, max 50)"),
  },
  async ({ query, tag_id, limit }) => {
    const { articles, total } = await listArticles({
      search: query,
      tagId: tag_id,
      limit,
      sort: "updated_at",
      order: "desc",
    });

    if (articles.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No articles found matching "${query}"${tag_id ? ` with tag ID ${tag_id}` : ""}.`,
          },
        ],
      };
    }

    const lines: string[] = [
      `Found ${total} article${total !== 1 ? "s" : ""} matching "${query}"${tag_id ? ` (filtered by tag ${tag_id})` : ""}. Showing ${articles.length}:\n`,
    ];

    articles.forEach((a, i) => {
      lines.push(`${i + 1}. **${a.title}**`);
      lines.push(`   Slug: ${a.slug}`);
      lines.push(`   Updated: ${formatDate(a.updatedAt)}${a.updatedByName ? ` by ${a.updatedByName}` : ""}`);
      if (a.tags.length > 0) lines.push(`   Tags: ${tagList(a.tags)}`);
      if (a.isRestricted && !a.canAccess) {
        lines.push(`   ⚠ Restricted — your token doesn't have group access to this article`);
      }
      lines.push("");
    });

    if (total > articles.length) {
      lines.push(`… and ${total - articles.length} more. Use a more specific query or increase the limit.`);
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

// ─── Tool: get_article ────────────────────────────────────────────────────────

server.tool(
  "get_article",
  "Retrieve the full content of a Memex article by its slug. Returns the title, body text, tags, and a list of articles that link to this one (backlinks). Use search_articles or list_articles to find slugs.",
  {
    slug: z.string().min(1).describe("Article slug, e.g. 'incident-response-runbook'"),
  },
  async ({ slug }) => {
    const article = await getArticle(slug);

    if (!article.canAccess) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Access denied to "${article.title}" (slug: ${slug}). This article is restricted to specific groups and your API token doesn't have the required group membership.`,
          },
        ],
      };
    }

    const lines: string[] = [];

    // Header
    lines.push(`# ${article.title}`);
    lines.push("");
    lines.push(`**Slug:** ${article.slug}`);
    lines.push(`**Updated:** ${formatDate(article.updatedAt)}${article.updatedByName ? ` by ${article.updatedByName}` : ""}`);
    lines.push(`**Created:** ${formatDate(article.createdAt)}`);
    if (article.tags.length > 0) lines.push(`**Tags:** ${tagList(article.tags)}`);
    if (article.isRestricted) lines.push(`**Access:** Restricted (group-controlled)`);
    lines.push("");
    lines.push("---");
    lines.push("");

    // Body
    const body = htmlToText(article.content);
    lines.push(body || "_This article has no content._");

    // Backlinks
    if (article.backlinks.length > 0) {
      lines.push("");
      lines.push("---");
      lines.push(`**Backlinks** — ${article.backlinks.length} article${article.backlinks.length !== 1 ? "s" : ""} link${article.backlinks.length === 1 ? "s" : ""} here:`);
      article.backlinks.forEach((b) => {
        lines.push(`- ${b.title} (slug: \`${b.slug}\`)`);
      });
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

// ─── Tool: list_articles ──────────────────────────────────────────────────────

server.tool(
  "list_articles",
  "Browse all articles in the Memex knowledge base. Returns titles, slugs, tags, and last-updated dates. Supports optional tag filtering and pagination. Use get_article to read a specific article's content.",
  {
    tag_id: z
      .number()
      .int()
      .optional()
      .describe("Optional: only show articles with this tag (use list_tags to get IDs)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe("Number of articles per page (default 20, max 100)"),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .default(0)
      .describe("Pagination offset (default 0)"),
    sort: z
      .enum(["title", "updated_at", "created_at"])
      .optional()
      .default("updated_at")
      .describe("Sort order field (default: updated_at)"),
  },
  async ({ tag_id, limit, offset, sort }) => {
    const { articles, total } = await listArticles({
      tagId: tag_id,
      limit,
      offset,
      sort,
      order: sort === "title" ? "asc" : "desc",
    });

    if (total === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: tag_id
              ? `No articles found with tag ID ${tag_id}.`
              : "The knowledge base is empty.",
          },
        ],
      };
    }

    const from = (offset ?? 0) + 1;
    const to = (offset ?? 0) + articles.length;
    const lines: string[] = [
      `**${total} article${total !== 1 ? "s" : ""} total** — showing ${from}–${to}${tag_id ? ` (filtered by tag ${tag_id})` : ""}:\n`,
    ];

    articles.forEach((a, i) => {
      const num = (offset ?? 0) + i + 1;
      const tags = a.tags.length > 0 ? ` [${tagList(a.tags)}]` : "";
      const restricted = a.isRestricted && !a.canAccess ? " 🔒" : "";
      lines.push(`${num}. **${a.title}**${restricted}`);
      lines.push(`   Slug: \`${a.slug}\`  |  Updated: ${formatDate(a.updatedAt)}${tags}`);
    });

    if (to < total) {
      lines.push("");
      lines.push(
        `_Page ${Math.floor((offset ?? 0) / (limit ?? 20)) + 1} of ${Math.ceil(total / (limit ?? 20))}. Use offset=${to} to see the next page._`,
      );
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

// ─── Tool: list_tags ─────────────────────────────────────────────────────────

server.tool(
  "list_tags",
  "List all tags defined in the Memex knowledge base, including their IDs (for use as tag_id filters), display names, colors, and how many articles each tag has. Use this before filtering search_articles or list_articles by tag.",
  {},
  async () => {
    const tags = await listTags();

    if (tags.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No tags have been defined in this knowledge base." }],
      };
    }

    const lines: string[] = [`**${tags.length} tag${tags.length !== 1 ? "s" : ""}:**\n`];
    tags.forEach((t) => {
      lines.push(
        `- **${t.name}** — ID: ${t.id}, color: ${t.color}, ${t.articleCount} article${t.articleCount !== 1 ? "s" : ""}`,
      );
    });

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

// ─── Tool: get_backlinks ──────────────────────────────────────────────────────

server.tool(
  "get_backlinks",
  "Find all articles in the knowledge base that link to a given article. Useful for discovering related content, understanding how a concept is referenced across the KB, or navigating the article graph.",
  {
    slug: z
      .string()
      .min(1)
      .describe("Slug of the article to find backlinks for"),
  },
  async ({ slug }) => {
    // Backlinks are embedded in the article response
    const article = await getArticle(slug);

    if (!article.canAccess) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Cannot read backlinks for "${article.title}" — your token doesn't have access to this restricted article.`,
          },
        ],
      };
    }

    const { backlinks, title } = article;

    if (backlinks.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No articles link to **${title}** (slug: \`${slug}\`).`,
          },
        ],
      };
    }

    const lines: string[] = [
      `**${backlinks.length} article${backlinks.length !== 1 ? "s" : ""} link to "${title}"** (slug: \`${slug}\`):\n`,
    ];

    backlinks.forEach((b, i) => {
      const restricted = b.isRestricted && !b.canAccess ? " 🔒" : "";
      const tags = b.tags.length > 0 ? ` [${tagList(b.tags)}]` : "";
      lines.push(`${i + 1}. **${b.title}**${restricted}`);
      lines.push(`   Slug: \`${b.slug}\`  |  Updated: ${formatDate(b.updatedAt)}${tags}`);
    });

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
