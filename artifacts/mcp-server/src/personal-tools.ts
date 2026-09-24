import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type createApiClient, formatDate, htmlToText } from "./client.js";

type ApiClient = ReturnType<typeof createApiClient>;

export function registerPersonalTools(server: McpServer, api: ApiClient, userId: number) {
  server.tool(
    "list_logs",
    "List only this API key owner's personal log entries. Supports pagination; never lists another user's logs.",
    {
      limit: z.number().int().min(1).max(100).optional().default(20).describe("Entries per page (default 20, maximum 100)"),
      offset: z.number().int().min(0).max(2_147_483_647).optional().default(0).describe("Pagination offset"),
    },
    async ({ limit, offset }) => {
      const { entries, hasMore } = await api.listLogs(limit, offset);
      const lines = [
        `${entries.length} personal log entry/entries (offset ${offset}).${hasMore ? ` More available; use offset=${offset + entries.length}.` : ""}`,
        ...entries.map((entry) =>
          `- **${entry.title}** (log slug: ${entry.logSlug}; created ${formatDate(entry.createdAt)})`,
        ),
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "get_log",
    "Read one personal log entry belonging to this API key's owner. Pass its log slug from list_logs, not an article slug or another user's ID.",
    { log_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).describe("Owner-scoped log slug from list_logs") },
    async ({ log_slug }) => {
      // The list endpoint enforces the Log feature flag. The detail REST route
      // does not, so check it first rather than bypassing a disabled feature.
      await api.listLogs(1, 0);
      const log = await api.getMyLog(userId, log_slug);
      const lines = [
        `# ${log.title}`,
        `Log slug: ${log.logSlug}`,
        `Created: ${formatDate(log.createdAt)} | Updated: ${formatDate(log.updatedAt)}`,
        "",
        htmlToText(log.content) || "_This log entry has no content._",
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );

  server.tool(
    "list_tasks",
    "Browse this API key owner's personal task lists and tasks. The API returns at most 200 tasks total; the response warns when results may be incomplete.",
    {
      list_id: z.number().int().min(1).max(2_147_483_647).optional().describe("Optional task list ID"),
      include_completed: z.boolean().optional().default(true).describe("Include completed tasks (default true)"),
      limit: z.number().int().min(1).max(200).optional().default(50).describe("Maximum tasks on this page (default 50)"),
      offset: z.number().int().min(0).max(2_147_483_647).optional().default(0).describe("Pagination offset within the API's first 200 tasks"),
    },
    async ({ list_id, include_completed, limit, offset }) => {
      const { lists, truncated } = await api.listTaskLists();
      const chosen = lists.filter((list) => list_id === undefined || list.id === list_id);
      const tasks = chosen.flatMap((list) =>
        list.tasks.filter((task) => include_completed || !task.completedAt).map((task) => ({
          ...task,
          listId: list.id,
          listName: list.name,
        })),
      );
      const shown = tasks.slice(offset, offset + limit);
      const lines = [
        `Your task lists: ${chosen.map((list) => `${list.name} (ID: ${list.id})`).join(", ") || "(none)"}`,
        `${tasks.length} matching task(s) in the API response; showing ${shown.length} from offset ${offset}.`,
        ...(truncated ? ["Warning: the API returned only the first 200 tasks across all lists. Later tasks may be missing even when filtering by list."] : []),
        ...shown.map((task) =>
          `- [${task.completedAt ? "x" : " "}] ${task.title} (task ID: ${task.id}; list: ${task.listName}, ID: ${task.listId}${task.completedAt ? `; completed ${formatDate(task.completedAt)}` : ""})`,
        ),
        ...(offset + shown.length < tasks.length ? [`Use offset=${offset + shown.length} to see more matching tasks.`] : []),
      ];
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  );
}