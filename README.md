# Memex

A self-hostable wiki-style knowledge base with a React frontend and Express backend.

## Features

- **Articles** — rich-text editing (TipTap), wikilinks, backlinks, version history, PDF/Markdown export
- **Tags** — colour-coded labels that can be applied to articles; admins create/manage tags, editors apply them; filterable in the article list
- **Groups & access control** — restrict articles to specific groups; role-based access (admin / editor / viewer)
- **Edit locking** — when a second editor opens an article that someone is already editing, they see a warning with the lock owner's name; locks expire after 2 minutes of inactivity
- **API tokens** — long-lived bearer tokens for scripting and integrations (Settings → API Tokens)
- **MCP server** — exposes the KB as tools for Claude Desktop, Cursor, and other MCP-compatible LLM clients
- **Android companion app** — read-only Expo app that syncs all articles for offline use and full-text search

---

## Run & Operate

```bash
pnpm --filter @workspace/api-server run dev       # API server (port from $PORT)
pnpm --filter @workspace/knowledge-base run dev   # React SPA dev server
pnpm --filter @workspace/mcp-server run dev       # MCP server (stdio, for local testing)
pnpm run typecheck                                 # full typecheck across all packages
pnpm run build                                     # typecheck + build all packages
pnpm --filter @workspace/api-spec run codegen     # regenerate API hooks from OpenAPI spec
pnpm --filter @workspace/db run push              # push DB schema changes (dev only)
```

Required env: `DATABASE_URL` (Postgres connection string), `SESSION_SECRET`

---

## Self-Hosting with Docker

Memex ships as a single Docker image that bundles both the API server and the pre-built frontend SPA. No Node.js or pnpm required on the host.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24+
- [Docker Compose](https://docs.docker.com/compose/) v2

### Quick start

```bash
# 1. Clone the repository
git clone https://github.com/<your-org>/memex.git
cd memex

# 2. Create your environment file
cp .env.example .env
#    Edit .env — at minimum set SESSION_SECRET and POSTGRES_PASSWORD.

# 3. Start everything (Postgres + migration + app)
docker compose up -d

# 4. Open http://localhost:3000
```

On first boot, set `RUN_SEED=true` in `.env` together with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` to create the initial admin account. Remove the seed variables after the first successful start.

### Environment variables

See `.env.example` for the full list. Minimum required:

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Long random string for signing session cookies |
| `POSTGRES_PASSWORD` | Password for the `memex` Postgres user |
| `DATABASE_URL` | Postgres connection string (auto-set by compose) |

### Schema migrations

`docker compose up` automatically runs `drizzle-kit push` before starting the app. For upgrades with schema conflicts, run the migration manually:

```bash
docker compose run --rm migrate \
  pnpm --filter @workspace/db run push
```

### Published images

```bash
docker pull ghcr.io/<your-org>/memex:latest
```

---

## MCP Server

The `artifacts/mcp-server` package exposes Memex as a set of tools for MCP-compatible LLM clients. Any authenticated user with an API token can connect.

**Available tools:**

| Tool | Description |
|------|-------------|
| `search_articles` | Keyword search across titles and content |
| `get_article` | Read the full body of an article by slug |
| `list_articles` | Browse all articles with optional tag filtering and pagination |
| `list_tags` | List all tags and their IDs |
| `get_backlinks` | Find every article that links to a given one |

**Setup (Claude Desktop):**

1. Create an API token in Memex → Settings → API Tokens
2. Build the server: `pnpm --filter @workspace/mcp-server build`
3. Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "memex": {
      "command": "node",
      "args": ["/path/to/artifacts/mcp-server/dist/index.js"],
      "env": {
        "MEMEX_URL": "http://your-memex-host:3000",
        "MEMEX_TOKEN": "your-api-token"
      }
    }
  }
}
```

See `artifacts/mcp-server/README.md` for full setup instructions including Cursor support.

---

## Android Companion App

`artifacts/memex-mobile` is a read-only Expo (React Native) app that connects to any self-hosted Memex instance.

- Syncs all articles locally for full offline access and search
- Tag filter chips, pull-to-refresh, dark mode
- Enter your server URL and log in with your Memex credentials

A GitHub Actions workflow (`.github/workflows/build-android.yml`) builds a debug APK on every push to `main`.

---

## Tags

Tags are managed by admins (Settings → Tags) and can be applied to any article by editors. Each tag has a name and a colour. Articles can have multiple tags; the article list supports filtering by tag.

**API:**
- `GET /api/tags` — list all tags
- `POST /api/tags` — create a tag (admin only)
- `PATCH /api/tags/:id` — rename or recolour a tag (admin only)
- `DELETE /api/tags/:id` — delete a tag (admin only)
- Tags are included on every article list and article detail response as `tags[]`
- `GET /api/articles?tagId=N` — filter article list by tag

**Export/import:** Tags are included when exporting and re-applied when importing the knowledge base.

---

## Edit Locking

When an editor opens an article for editing, Memex acquires a 2-minute TTL lock on that article. If a second editor opens the same article while the lock is active, they see an inline warning showing who holds the lock and when they started editing. The editor holding the lock refreshes it automatically every 90 seconds while the editor is open; it expires naturally after 2 minutes of inactivity.

**API:**
- `GET /api/articles/:slug/lock` — check current lock state
- `PUT /api/articles/:slug/lock` — acquire or refresh a lock (returns 409 if locked by someone else)
- `DELETE /api/articles/:slug/lock` — release a lock

---

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Frontend: React 19 + Vite 7 + TipTap editor
- Mobile: Expo (React Native) — managed workflow
- Validation: Zod, `drizzle-zod`
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Build: esbuild (API), Vite (SPA)

---

## Where things live

| Path | Contents |
|------|----------|
| `artifacts/api-server/src/` | Express API — routes, auth, middleware, seed |
| `artifacts/knowledge-base/src/` | React SPA — pages, components, hooks |
| `artifacts/mcp-server/src/` | MCP server — API client wrapper + tool definitions |
| `artifacts/memex-mobile/` | Expo companion app |
| `lib/db/src/schema/` | Drizzle ORM schema (source of truth for DB shape) |
| `lib/api-spec/openapi.yaml` | OpenAPI spec (source of truth for API contract) |
| `lib/api-client-react/src/generated/` | Auto-generated React Query hooks — **do not edit** |
| `.github/workflows/build-android.yml` | GitHub Actions — builds Android APK on push |

---

## Architecture decisions

- **Single-container Docker**: The runtime image serves both `/api/*` (Express) and all other paths (React SPA) via `STATIC_DIR`. No separate nginx needed.
- **esbuild bundle**: The API server compiles to a single `dist/index.mjs` with all deps inlined, except `archiver`, `unzipper`, and `pdfkit` (CJS packages that must remain external).
- **Session-based auth + bearer tokens**: `express-session` + `connect-pg-simple` for browser sessions; SHA-256-hashed bearer tokens in `api_tokens` for API/MCP access.
- **Edit locks in Postgres**: Lock state is a single row in `edit_locks` with a `lockedAt` timestamp; expiry is enforced at read time rather than via a background job, keeping the architecture simple.
- **pnpm deploy for migrations**: The `migrate` Docker service uses the `builder` stage so drizzle-kit is available without polluting the runtime image.

---

## Gotchas

- The `vite.config.ts` requires `PORT` to be set even during `vite build`. The Dockerfile passes `PORT=4000` as a build-time env var.
- `drizzle-kit push` requires a TTY when there are unresolvable schema conflicts. On a fresh database this is never an issue.
- The MCP server uses stdio transport — it must be launched as a subprocess by the LLM client, not run as a standalone server.
- The Android APK produced by CI is a debug build (unsigned). For production distribution, set up signing keys in the GitHub Actions workflow.

---

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
