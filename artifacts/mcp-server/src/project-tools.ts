import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type createApiClient, excerpt, formatDate, htmlToText, tagList } from "./client.js";

type ApiClient = ReturnType<typeof createApiClient>;
const id = z.number().int().min(1).max(2_147_483_647);

export function registerProjectTools(server: McpServer, api: ApiClient) {
  server.tool(
    "list_projects",
    "List projects this API key owner can access, including projects shared with their groups. Archived projects are listed separately.",
    { archived: z.boolean().optional().default(false).describe("List archived projects instead of active ones") },
    async ({ archived }) => {
      const { projects, truncated } = await api.listProjects(archived);
      const lines = [
        `${projects.length} accessible ${archived ? "archived" : "active"} project(s).${truncated ? " The API returned only the first 100; additional projects are not shown." : ""}`,
        ...projects.map((p) =>
          `- **${p.name}** (project ID: ${p.id}, boards: ${p.boardCount ?? 0})${p.description ? ` — ${p.description}` : ""}`,
        ),
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "get_project",
    "Read a project and its board IDs, including archived boards. Requires access to the project; does not expose member email addresses.",
    {
      project_id: id.describe("Project ID from list_projects"),
      boards_offset: z.number().int().min(0).max(2_147_483_647).optional().default(0).describe("Offset for the next page of boards"),
    },
    async ({ project_id, boards_offset }) => {
      const project = await api.getProject(project_id, 50, boards_offset);
      const lines = [
        `# ${project.name}`,
        `Project ID: ${project.id}`,
        `Description: ${project.description || "(none)"}`,
        `Status: ${project.archivedAt ? "Archived" : "Active"}`,
        `Shared groups: ${project.groups.map((g) => g.name).join(", ") || "(none)"}`,
        "",
        `Boards (${project.boards.length} shown, offset ${boards_offset}):`,
        ...project.boards.map((board) =>
          `- ${board.name} (board ID: ${board.id}${board.archivedAt ? ", archived" : ""})`,
        ),
        ...(project.boardsHasMore ? [`More boards available; call get_project with boards_offset=${boards_offset + project.boards.length}.`] : []),
        "Use list_project_documents to see this project's documents.",
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "get_project_board",
    "Read the columns and cards on a project board you can access, including descriptions, due dates, completion, and assigned member names.",
    { board_id: id.describe("Board ID from get_project") },
    async ({ board_id }) => {
      const board = await api.getBoard(board_id);
      const lines = [
        `# ${board.name}`,
        `Board ID: ${board.id} | Project ID: ${board.projectId}${board.archivedAt ? " | Archived" : ""}`,
        ...(board.cardsTruncated ? ["Warning: the API returns at most 300 cards across this board; some cards are not shown."] : []),
      ];
      for (const column of board.columns) {
        lines.push("", `## ${column.name} (column ID: ${column.id})`);
        if (!column.cards.length) lines.push("(No cards shown)");
        for (const card of column.cards) {
          lines.push(`- **${card.title}** (card ID: ${card.id}) — ${card.completedAt ? "Complete" : "Open"}${card.dueDate ? `; due ${formatDate(card.dueDate)}` : ""}`);
          if (card.description) lines.push(`  Description: ${card.description}`);
          if (card.members.length) lines.push(`  Assigned: ${card.members.map((m) => m.name).join(", ")}`);
        }
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "list_project_documents",
    "List documents attached to a project you can access. Use get_project_document to read one.",
    {
      project_id: id.describe("Project ID from list_projects"),
      offset: z.number().int().min(0).max(2_147_483_647).optional().default(0).describe("Offset for the next page of documents"),
    },
    async ({ project_id, offset }) => {
      const { documents, hasMore } = await api.listProjectDocuments(project_id, 50, offset);
      const lines = [
        `${documents.length} document(s) shown in project ${project_id} (offset ${offset}):`,
        ...documents.map((d) => `- **${d.title}** (slug: ${d.slug}; updated ${formatDate(d.updatedAt)})`),
        ...(hasMore ? [`More documents available; use offset=${offset + documents.length}.`] : []),
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "get_project_document",
    "Read the full content of a project document. The project access policy is checked by Memex.",
    {
      project_id: id.describe("Project ID from list_projects"),
      slug: z.string().min(1).describe("Document slug from list_project_documents"),
    },
    async ({ project_id, slug }) => {
      const doc = await api.getProjectDocument(project_id, slug);
      const lines = [
        `# ${doc.title}`,
        `Project ID: ${project_id} | Slug: ${doc.slug}`,
        `Created: ${formatDate(doc.createdAt)} | Updated: ${formatDate(doc.updatedAt)}`,
        ...(doc.tags.length ? [`Tags: ${tagList(doc.tags)}`] : []),
        "",
        htmlToText(doc.content) || "_This document has no content._",
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "get_card_comments",
    "Read a page of recent comments on a project card you can access, newest first. No changes can be made.",
    {
      card_id: id.describe("Card ID from get_project_board"),
      offset: z.number().int().min(0).max(2_147_483_647).optional().default(0).describe("Offset for older comments"),
    },
    async ({ card_id, offset }) => {
      const { comments, hasMore } = await api.getCardComments(card_id, 50, offset);
      const lines = [
        `${comments.length} comment(s) shown on card ${card_id} (offset ${offset}, newest first).${hasMore ? ` Older comments available; use offset=${offset + comments.length}.` : ""}`,
        ...comments.map((comment) =>
          `- ${comment.userName ?? "Unknown"} (${formatDate(comment.createdAt)}): ${excerpt(comment.content, 1_000)}`,
        ),
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );
}