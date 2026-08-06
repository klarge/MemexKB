# Memex MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that connects Claude Desktop, Cursor, VS Code Copilot, and other MCP clients to your self-hosted [Memex](../knowledge-base) knowledge base.

## What it does

Your LLM client gets five tools:

| Tool | Description |
|------|-------------|
| `search_articles` | Keyword search across titles and content |
| `get_article` | Read the full body of a specific article |
| `list_articles` | Browse all articles with optional tag filtering and pagination |
| `list_tags` | See all tags and their IDs (for filtering) |
| `get_backlinks` | Find every article that links to a given one |

## Prerequisites

- Node.js 18+
- A running Memex instance
- An API token (see below)

## Step 1 — Create an API token in Memex

1. Log in to your Memex instance
2. Click your avatar → **Settings** → **API Tokens**
3. Click **New token**, give it a name (e.g. "Claude Desktop"), and click **Create**
4. Copy the token — it's only shown once

> **Permissions:** The token inherits the permissions of the user who creates it. Create it with an account that has read access to all articles you want the LLM to see. Group-restricted articles that the token owner can't access will be listed (title visible) but their content won't be readable.

## Step 2 — Build the server

From the workspace root:

```bash
pnpm --filter @workspace/mcp-server build
```

Or from this directory:

```bash
pnpm install
pnpm build
```

The compiled server lands at `dist/index.js`.

## Step 3 — Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "memex": {
      "command": "node",
      "args": ["/absolute/path/to/artifacts/mcp-server/dist/index.js"],
      "env": {
        "MEMEX_URL": "http://your-memex-host:3000",
        "MEMEX_TOKEN": "paste-your-token-here"
      }
    }
  }
}
```

Restart Claude Desktop. You should see a 🔌 icon in the chat input area confirming tools are loaded.

## Step 3 (alternative) — Add to Cursor

Open Cursor → Settings → MCP, then add a new server:

```json
{
  "memex": {
    "command": "node",
    "args": ["/absolute/path/to/artifacts/mcp-server/dist/index.js"],
    "env": {
      "MEMEX_URL": "http://your-memex-host:3000",
      "MEMEX_TOKEN": "paste-your-token-here"
    }
  }
}
```

## Development (no build step)

If you have `tsx` installed, you can run the server directly from TypeScript:

```json
{
  "mcpServers": {
    "memex": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/artifacts/mcp-server/src/index.ts"],
      "env": {
        "MEMEX_URL": "http://your-memex-host:3000",
        "MEMEX_TOKEN": "paste-your-token-here"
      }
    }
  }
}
```

## Verifying it works

After restarting your client, try these prompts:

- *"What articles do we have in the knowledge base?"*
- *"Search for anything related to deployment"*
- *"What tags exist in our KB?"*
- *"Read the article about incident response"*
- *"Which articles link to our onboarding guide?"*

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MEMEX_URL` | ✅ | Base URL of your Memex instance, e.g. `http://192.168.1.10:3000`. No trailing slash. |
| `MEMEX_TOKEN` | ✅ | API token from Memex Settings → API Tokens |

## Troubleshooting

**"MEMEX_URL is not set"** — Check that the `env` block in your MCP config has the right key name (capital letters, underscore).

**API 401 errors** — The token is invalid or expired. Create a new one in Memex Settings.

**API 403 errors** — The token owner doesn't have the required role. Make sure the Memex user is at least a `viewer`.

**Group-restricted articles** — These show up in search/list results (title visible) but `get_article` returns an access-denied message. Create the token with an admin account if you need full access.
