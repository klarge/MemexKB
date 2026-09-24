# Memex

A self-hostable wiki and productivity hub with a React frontend and Express backend. Combine a rich knowledge base with personal task management and collaborative Kanban project boards.

---

## Features

- **Dashboard** — home page showing recent log entries, recently updated articles, and a "Needs Review" list (oldest by last-updated date)
- **Articles** — rich-text editing (TipTap), wikilinks, backlinks, version history, tags, PDF/Markdown export
- **Log Entries** — optional date-titled journal, kept separate from the main article list; togglable by admins
- **Tasks** — personal to-do lists with multiple named lists, checkbox items, and completed-task collapse; visible only to you; togglable by admins
- **Projects** — collaborative Kanban boards: create Projects, add Boards, define Columns, drag-and-drop Cards with due dates and member assignment; share Projects with Groups; togglable by admins
- **Groups & access control** — restrict articles and projects to specific groups; role-based access (admin / editor / viewer)
- **Tags** — colour-coded labels on articles; filterable in the article list
- **Edit locking** — warns a second editor when someone is already editing an article
- **API tokens** — long-lived bearer tokens for scripting and integrations (Settings → API Keys)
- **MCP server** — exposes the KB as tools for Claude Desktop, Cursor, and other MCP-compatible clients
- **Android companion app** — read-only Expo app for offline article access and full-text search

---

## Screenshots

### Dashboard
![Dashboard](docs/screenshots/dashboard.jpg)
*The home dashboard surfaces your recent log entries, recently updated articles, and articles that haven't been touched in a while (Needs Review).*

### Knowledge Base
![Knowledge](docs/screenshots/knowledge.jpg)
*Browse, search, and filter all articles. Editors can create and publish articles with full rich-text editing, wikilinks, tags, and version history.*

### Tasks
![Tasks](docs/screenshots/tasks.jpg)
*Personal to-do lists, visible only to you. Create multiple named lists, add tasks, check them off, and collapse completed items.*

### Projects (Kanban)
![Projects](docs/screenshots/projects.jpg)
*Projects are collaborative Kanban workspaces that can be shared with Groups. Each project holds multiple boards.*

### Kanban Board
![Board](docs/screenshots/board.jpg)
*Boards have columns with drag-and-drop cards. Cards support due dates (highlighted red when overdue), member assignment, and rich descriptions.*

### Admin Customization
![Admin Customization](docs/screenshots/admin-customization.jpg)
*Admins can rename the site, upload a logo, manage navigation links, and toggle individual features on or off.*


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

Memex ships as a single Docker image (multi-platform: `linux/amd64` and `linux/arm64`) bundling the API server, pre-built frontend SPA, and the stdio MCP server. No Node.js or pnpm required on the host.

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
#    Set SESSION_SECRET and a strong, URL-safe POSTGRES_PASSWORD.

# 3. Start PostgreSQL and the app (the app applies migrations at startup)
docker compose up -d

# 4. Open http://localhost:3000 (or the PORT set in .env)
```

On first boot, use the in-app initial setup, or set `RUN_SEED=true` in `.env` together with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` to create an initial admin account. Remove the seed variables after the first successful start. Never commit `.env`.
For backward compatibility, the local Compose file still has insecure development defaults if `.env` is absent; set both values before exposing the app. On an existing `pgdata` volume, changing `POSTGRES_PASSWORD` in `.env` does **not** change the already-created PostgreSQL user's password; rotate that password in PostgreSQL too before changing the Compose setting.

### Use an external PostgreSQL database instead

`docker-compose.external-db.yml` runs the same app image **without** starting a local `db` container or creating a `pgdata` volume. This is a standalone Compose file, not an override to combine with `docker-compose.yml`. The default `docker compose up -d` command above remains the local-Postgres option.

1. Provision an empty, reachable PostgreSQL database and a user with permission to create and alter tables. Back it up before connecting an existing installation. Allow connections from the app host on port 5432.
2. Copy `.env.example` to an untracked `.env`. Set `SESSION_SECRET` and uncomment `DATABASE_URL` with your database's hostname, database name, username, and password. Percent-encode special characters in connection-string credentials. For a remote database requiring TLS (including RDS), use a URL such as `postgres://dbuser:encoded-password@db.example.com:5432/memexkb?sslmode=require`. Do **not** use `db` as the hostname: that name only works with the local Compose service. `POSTGRES_PASSWORD` is unused in external mode.
3. Start and check the app:

   ```bash
   docker compose -f docker-compose.external-db.yml up -d
   docker compose -f docker-compose.external-db.yml logs -f app
   curl -f http://localhost:3000/api/healthz
   ```

The app applies the bundled SQL migrations before it starts listening. A connection or migration failure stops that attempt to start; check the app logs and database network/credentials rather than running `drizzle-kit push` against production. To use the optional stdio MCP service with this configuration, have your MCP client supply its own `MEMEX_TOKEN` environment variable and run `docker compose -f docker-compose.external-db.yml run --rm -T -e MEMEX_TOKEN mcp` (see below).

### Use the MCP server from Compose

The image includes the MCP server automatically, but the current MCP transport is **stdio**, not an HTTP endpoint. Do not start it as a detached service: it must stay attached to the MCP client that reads and writes its protocol messages.

1. Each user logs in to Memex and creates their own **Read-only** API key in **Settings → API Keys**. MCP requests use the key owner's article and group permissions, not the permissions of whoever is logged in to the web UI at the time.
2. Configure each user's MCP client to supply **their own** `MEMEX_TOKEN` in its local environment and launch the Compose service. For example, in Claude Desktop:

   ```json
   {
     "mcpServers": {
       "memex": {
         "command": "docker",
         "args": [
           "compose",
           "-f",
           "/absolute/path/to/memex/docker-compose.yml",
           "run",
            "--rm",
            "-T",
            "-e",
            "MEMEX_TOKEN",
           "mcp"
          ],
          "env": {
            "MEMEX_TOKEN": "paste-your-own-read-only-api-key-here"
          }
       }
     }
   }
   ```

The `mcp` service uses `http://app:3000` inside the Compose network. The `-e MEMEX_TOKEN` flag forwards the key from **that MCP client's process environment** into its own MCP container; neither Compose file stores a shared key. Keep each client's configuration private, and remove any old `MEMEX_TOKEN` entry from the shared Compose `.env` file. A normal `docker compose up -d` still starts only PostgreSQL and the web application. See `artifacts/mcp-server/README.md` for client-specific configuration and local non-Docker setup.

### Environment variables

See `.env.example` for the full list. Minimum required:

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Long random string for signing session cookies |
| `POSTGRES_PASSWORD` | Password for the local Compose `memexkb` Postgres user (local mode only; use URL-safe characters) |
| `DATABASE_URL` | PostgreSQL URL; constructed from `POSTGRES_PASSWORD` in local Compose, required in external Compose and ECS |
| `COOKIE_SECURE`, `TRUST_PROXY` | Set to `true` and `1` respectively behind one HTTPS-terminating proxy such as an ALB |

### Schema migrations

The Docker image includes `lib/db/migrations` and sets `MIGRATIONS_DIR=/app/migrations`. On **every** container startup the API runs the ordered Drizzle migrations before listening; already-applied migrations are not rerun. This works for either Compose file and for ECS. Review new migration SQL and take a database backup before upgrading. If a database already has application tables created outside the migration history (for example, by a previous `drizzle-kit push`), do **not** point a new container at it and assume the migrations can replay safely. Reconcile its migration history and schema first.

### Deploy to AWS ECS with Amazon RDS

ECS does not run Docker Compose. Build the same `Dockerfile` image, supply the external database URL and session secret to the ECS task, and put an Application Load Balancer (ALB) in front of the app. A basic single-task Fargate deployment:

1. **Network and database:** In one AWS Region, create a VPC with public subnets for the ALB and private subnets for ECS and RDS. Create an RDS for PostgreSQL 16 instance (or compatible version), a database named `memexkb`, and an application user with schema-creation/migration permissions. Keep RDS **not publicly accessible**. Permit inbound TCP 5432 on the RDS security group **only from the ECS task security group**; permit ALB-to-task TCP 3000. Arrange outbound access for ECS to ECR, Secrets Manager, and CloudWatch Logs via a NAT gateway or the appropriate VPC endpoints.
2. **Image:** Create a private ECR repository and push an image built for your Fargate architecture. For example, with the AWS CLI configured for the target account and Region:

   ```bash
   export AWS_REGION=us-east-1
   export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
   export IMAGE="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/memexkb:latest"
   aws ecr create-repository --repository-name memexkb --region "$AWS_REGION"
   aws ecr get-login-password --region "$AWS_REGION" |
     docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
   docker buildx build --platform linux/amd64 -t "$IMAGE" --push .
   ```

   Choose `ARM64` in the task definition and build for `linux/arm64` instead if using ARM-based Fargate. Reuse the repository on subsequent pushes (skip `create-repository`).
3. **Secrets and IAM:** In AWS Secrets Manager, store the full RDS `DATABASE_URL` (including `?sslmode=require` for TLS) and a separately generated `SESSION_SECRET` as two secrets. URL-encode credential characters. Never place either value in the task definition's plain `environment` array, image, source control, or ECS service command. Give the **task execution role** the managed `AmazonECSTaskExecutionRolePolicy` plus `secretsmanager:GetSecretValue` for those secret ARNs (and `kms:Decrypt` if using a customer-managed key). Configure an `awslogs` log group. The task role does not need database credentials when they are injected by the execution role.
4. **Task definition:** Create a Fargate task using the pushed ECR image, `awsvpc` networking, `X86_64`/Linux for the example build, at least 0.5 vCPU / 1 GB RAM, and container port **3000**. Map the secrets to environment variables named `DATABASE_URL` and `SESSION_SECRET`. Set plain environment variables `NODE_ENV=production`, `PORT=3000`, `STATIC_DIR=/app/public`, `MIGRATIONS_DIR=/app/migrations`, `COOKIE_SECURE=true`, and `TRUST_PROXY=1`. Configure CloudWatch `awslogs` and, optionally, a container health check against `http://localhost:3000/api/healthz`. The task's entrypoint is already defined by the image; do not override it.
5. **Service and HTTPS:** Create an ECS service in the private subnets with **one task** initially. Create an ALB in the public subnets, an IP-type target group for port 3000 with health-check path `/api/healthz`, and an HTTPS listener with an ACM certificate forwarding to that target group. Redirect HTTP to HTTPS. Point DNS at the ALB. Check CloudWatch logs for “Database migrations complete” before opening the app and completing initial admin setup. The health endpoint checks HTTP availability, not RDS connectivity; use logs and app operations to confirm the database works.

   The app currently migrates on every start, so avoid concurrent fresh tasks during a schema upgrade. Keep the service at one task until you have a separate, coordinated migration process for scale-out or zero-downtime rolling deployments. Back up RDS before upgrading the image. To seed an admin instead of using in-app setup, supply `RUN_SEED=true` and `SEED_ADMIN_EMAIL` plus `SEED_ADMIN_PASSWORD` (as a secret) for the first start only, then remove them. Use the **same** `SESSION_SECRET` across restarts/tasks so existing sessions remain valid.

### Published images

```bash
docker pull ghcr.io/klarge/memexkb:latest   # amd64 + arm64
```

---

## API basics

The API is served under `/api`. Create an API token in **Settings → API Keys**, then use it as a bearer token. The examples below assume:

```bash
export MEMEX_URL="http://localhost:3000"
export MEMEX_TOKEN="replace-with-your-api-token"
```

All write operations require an authenticated user. Article creation and edits require an `admin` or `editor` role; actions explicitly marked admin-only require an `admin` token.

**Example — verify your token:**

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $MEMEX_TOKEN" \
  "$MEMEX_URL/api/auth/me"
```

---

## Articles

Articles use HTML for `content`. You can link to another article with `[[Article title]]`. An article URL is generated from its title when it is created and stays stable when the title changes. An admin can explicitly change a URL; Memex updates inbound wikilinks and keeps their labels intact.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/articles` | List articles. Supports `search`, `sort` (`title`, `updated_at`, `created_at`), `order`, `limit`, `offset`, and `tagId`. |
| `POST` | `/api/articles` | Create an article (admin/editor) — body: `{ title, content, groupIds?, tagIds? }`. Returns `409` if the generated URL is already used. |
| `GET` | `/api/articles/maintenance` | List articles ordered by oldest update first; supports `limit` and `offset`. |
| `GET` | `/api/articles/stats` | Get knowledge-base counts and recently/least recently updated articles. |
| `GET` | `/api/articles/:slug` | Get one article, including tags and backlinks. Restricted articles return metadata with `canAccess: false` and empty content when access is denied. |
| `PATCH` | `/api/articles/:slug` | Update an article (admin/editor) — body: `{ title?, content?, groupIds?, tagIds? }`. Changing a title does not change its URL. |
| `DELETE` | `/api/articles/:slug` | Delete an article (admin/editor). |
| `PATCH` | `/api/articles/:slug/slug` | Change an article URL (admin only) — body: `{ slug }`. Rewrites incoming wikilinks and returns `{ slug, rewrittenArticles }`. |
| `GET` | `/api/articles/:slug/backlinks` | List articles that link to this article. |
| `GET` | `/api/articles/:slug/export/md` | Download the article as Markdown. |
| `GET` | `/api/articles/:slug/export/pdf` | Download the article as a PDF. |
| `PUT` | `/api/articles/:slug/groups` | Set access groups (admin/editor) — body: `{ groupIds }`. Editors may only use groups they belong to. |
| `POST` | `/api/articles/images` | Upload an article image (admin/editor) as `multipart/form-data` with a `file` field. |

**Example — create an article:**

```bash
curl --fail-with-body -X POST "$MEMEX_URL/api/articles" \
  -H "Authorization: Bearer $MEMEX_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"title":"Working agreements","content":"<p>Start here: [[Getting Started]]</p>","tagIds":[1]}'
```

**Example — change an article URL as an admin:**

```bash
curl --fail-with-body -X PATCH "$MEMEX_URL/api/articles/working-agreements/slug" \
  -H "Authorization: Bearer $MEMEX_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"slug":"team-working-agreements"}'
```

---

## Tasks

Personal to-do lists, visible only to the user who created them. Each user can create multiple named lists and add any number of tasks to each.

**Behaviour:**
- Tasks can be toggled complete; completed tasks collapse under a "N completed" disclosure at the bottom of the list
- List names are inline-editable (click the pencil icon)
- Feature can be disabled site-wide by admins (Admin → Customization → Tasks)

**API:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks/lists` | All lists with embedded tasks for the current user |
| `POST` | `/api/tasks/lists` | Create a list — body: `{ name }` |
| `PATCH` | `/api/tasks/lists/:id` | Rename a list — body: `{ name }` |
| `DELETE` | `/api/tasks/lists/:id` | Delete a list and all its tasks |
| `POST` | `/api/tasks` | Add a task — body: `{ listId, title }` |
| `PATCH` | `/api/tasks/:taskId/toggle` | Toggle a task's completed state |
| `DELETE` | `/api/tasks/:taskId` | Delete a task |

**Example — create a task list:**

```bash
curl --fail-with-body -X POST "$MEMEX_URL/api/tasks/lists" \
  -H "Authorization: Bearer $MEMEX_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"name":"This week"}'
```

---

## Projects & Kanban Boards

Collaborative Kanban workspaces. A **Project** contains one or more **Boards**; each Board has **Columns** (e.g. Backlog, In Progress, Done); each Column holds **Cards**.

**Behaviour:**
- Cards support due dates (rendered red when overdue) and member assignment from users with project access
- Cards are draggable within and between columns
- Projects can be shared with Groups — all group members gain read/write access
- Feature can be disabled site-wide by admins (Admin → Customization → Projects)

### Projects API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List all accessible projects (owned + shared via groups) |
| `POST` | `/api/projects` | Create a project — body: `{ name, description? }` |
| `GET` | `/api/projects/:id` | Project detail with boards, shared groups, and `isOwner` flag |
| `PATCH` | `/api/projects/:id` | Rename / redescribe (owner or admin) — body: `{ name?, description? }` |
| `DELETE` | `/api/projects/:id` | Delete project and all boards/columns/cards (owner or admin) |
| `GET` | `/api/projects/:id/members` | Users with access to this project (for card member assignment) |
| `POST` | `/api/projects/:id/groups` | Share project with a group — body: `{ groupId }` |
| `DELETE` | `/api/projects/:id/groups/:groupId` | Remove group access |

**Example — create a project:**

```bash
curl --fail-with-body -X POST "$MEMEX_URL/api/projects" \
  -H "Authorization: Bearer $MEMEX_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"name":"Website refresh","description":"Content and launch work"}'
```

### Boards API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/projects/:projectId/boards` | Create a board — body: `{ name }` |
| `GET` | `/api/boards/:boardId` | Board with all columns and cards (including card members) |
| `PATCH` | `/api/boards/:boardId` | Rename board — body: `{ name }` |
| `DELETE` | `/api/boards/:boardId` | Delete board and all columns/cards |
| `PATCH` | `/api/boards/:boardId/cards/reorder` | Bulk reorder / move cards across columns — body: `{ columns: [{ columnId, cardIds[] }] }` |

**Example — add a board to project `42`:**

```bash
curl --fail-with-body -X POST "$MEMEX_URL/api/projects/42/boards" \
  -H "Authorization: Bearer $MEMEX_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"name":"Launch plan"}'
```

### Columns API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/boards/:boardId/columns` | Create a column — body: `{ name }` |
| `PATCH` | `/api/columns/:columnId` | Rename column — body: `{ name }` |
| `DELETE` | `/api/columns/:columnId` | Delete column and all its cards |

**Example — add a column to board `7`:**

```bash
curl --fail-with-body -X POST "$MEMEX_URL/api/boards/7/columns" \
  -H "Authorization: Bearer $MEMEX_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"name":"In progress"}'
```

### Cards API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/columns/:columnId/cards` | Create a card — body: `{ title }` |
| `PATCH` | `/api/cards/:cardId` | Update card — body: `{ title?, description?, dueDate? }` |
| `DELETE` | `/api/cards/:cardId` | Delete card |
| `POST` | `/api/cards/:cardId/members` | Assign a user — body: `{ userId }` |
| `DELETE` | `/api/cards/:cardId/members/:userId` | Unassign a user |

**Example — add a card to column `9`:**

```bash
curl --fail-with-body -X POST "$MEMEX_URL/api/columns/9/cards" \
  -H "Authorization: Bearer $MEMEX_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"title":"Publish release notes"}'
```

---

## Log Entries

An optional daily journal, separate from the main knowledge base. When enabled, a **Log** item appears in the sidebar. Log entries are date-titled and scoped to the user who created them.

- Enabled/disabled site-wide by admins (Admin → Customization → Log Entries); disabled by default
- The home dashboard shows your recent log entries when the feature is on
- A "Today's Log" button on the home page creates today's entry or jumps to it if it already exists

**API:** Log entries are articles with `isLogEntry: true`. Use the standard articles API with the log endpoints:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/log` | List log entries for the current user (newest first) |
| `POST` | `/api/articles` | Create a log entry — include `isLogEntry: true` in the body |

**Example — create a log entry:**

```bash
curl --fail-with-body -X POST "$MEMEX_URL/api/articles" \
  -H "Authorization: Bearer $MEMEX_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"title":"2026-08-23","content":"<p>Shipped API documentation.</p>","isLogEntry":true}'
```

---

## Admin Feature Toggles

Admins can enable or disable the Log, Tasks, and Projects features from **Admin → Customization**. Changes take effect immediately for all users — the sidebar item disappears and the API returns `403` for non-admins when a feature is off.

**API:**

```bash
curl --fail-with-body -X PATCH "$MEMEX_URL/api/admin/settings" \
  -H "Authorization: Bearer $MEMEX_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"logEntriesEnabled":true,"tasksEnabled":true,"projectsEnabled":false}'
```

**Read current settings (public):**

```bash
curl --fail-with-body "$MEMEX_URL/api/settings"
```

---

## MCP Server

The `artifacts/mcp-server` package exposes Memex as a set of tools for MCP-compatible LLM clients. Any authenticated user with an API token can connect. Read-only API keys are recommended for LLM integrations.

**Available tools:**

| Tool | Description |
|------|-------------|
| `search_articles` | Keyword search across titles and content |
| `get_article` | Read the full body of an article by slug |
| `list_articles` | Browse all articles with optional tag filtering and pagination |
| `list_tags` | List all tags and their IDs |
| `get_backlinks` | Find every article that links to a given one |

**Setup (Claude Desktop):**

1. Create an API token in Memex → Settings → API Keys
2. For a local checkout, build the server: `pnpm --filter @workspace/mcp-server build`. When using the published Docker image, the MCP server is already included.
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

## Tags

Tags are managed by admins (Admin → Tags) and applied to articles by editors. Each tag has a name and a colour. Articles can have multiple tags.

**API:**
- `GET /api/tags` — list all tags
- `POST /api/tags` — create a tag (admin only) — body: `{ name, color }`
- `PATCH /api/tags/:id` — rename or recolour (admin only)
- `DELETE /api/tags/:id` — delete (admin only)
- Tags are included on every article list and article detail response as `tags[]`
- `GET /api/articles?tagId=N` — filter article list by tag

**Example — create a tag as an admin:**

```bash
curl --fail-with-body -X POST "$MEMEX_URL/api/tags" \
  -H "Authorization: Bearer $MEMEX_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"name":"Documentation","color":"#2563eb"}'
```

---

## Edit Locking

When an editor opens an article for editing, Memex acquires a 2-minute TTL lock. A second editor sees a warning showing who holds the lock. The lock refreshes automatically every 90 seconds while the editor is open.

**API:**
- `GET /api/articles/:slug/lock` — check lock state
- `PUT /api/articles/:slug/lock` — acquire or refresh (returns `409` if locked by someone else)
- `DELETE /api/articles/:slug/lock` — release a lock

**Example — acquire or refresh an edit lock:**

```bash
curl --fail-with-body -X PUT "$MEMEX_URL/api/articles/getting-started/lock" \
  -H "Authorization: Bearer $MEMEX_TOKEN"
```

---

## Android Companion App

`artifacts/memex-mobile` is a read-only Expo (React Native) app that connects to any self-hosted Memex instance.

- Syncs all articles locally for full offline access and search
- Tag filter chips, pull-to-refresh, dark mode
- Enter your server URL and log in with your Memex credentials

A GitHub Actions workflow (`.github/workflows/build-android.yml`) builds a debug APK on every push to `main`.

---

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Frontend: React 19 + Vite 7 + TipTap editor + @dnd-kit (drag-and-drop)
- Mobile: Expo (React Native) — managed workflow
- Validation: Zod, `drizzle-zod`
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Build: esbuild (API), Vite (SPA)
- Docker: multi-platform image (`linux/amd64` + `linux/arm64`)

---

## Where things live

| Path | Contents |
|------|----------|
| `artifacts/api-server/src/` | Express API — routes, auth, middleware, seed |
| `artifacts/api-server/src/routes/projects.ts` | Projects, boards, columns, cards API |
| `artifacts/api-server/src/routes/tasks.ts` | Tasks and task lists API |
| `artifacts/api-server/src/routes/settings.ts` | Site settings and feature flag toggles |
| `artifacts/knowledge-base/src/` | React SPA — pages, components, hooks |
| `artifacts/knowledge-base/src/pages/board.tsx` | Kanban board with drag-and-drop |
| `artifacts/knowledge-base/src/pages/tasks.tsx` | Personal tasks page |
| `artifacts/knowledge-base/src/pages/projects.tsx` | Projects list page |
| `artifacts/knowledge-base/src/pages/project.tsx` | Project detail + group sharing |
| `artifacts/mcp-server/src/` | MCP server — API client wrapper + tool definitions |
| `artifacts/memex-mobile/` | Expo companion app |
| `lib/db/src/schema/` | Drizzle ORM schema (source of truth for DB shape) |
| `lib/db/src/schema/projects.ts` | projects, boards, columns, cards, card members |
| `lib/db/src/schema/tasks.ts` | task_lists, tasks tables |
| `lib/db/migrations/` | SQL migration files (applied in order) |
| `lib/api-spec/openapi.yaml` | OpenAPI spec (source of truth for API contract) |
| `lib/api-client-react/src/generated/` | Auto-generated React Query hooks — **do not edit** |
| `.github/workflows/docker-publish.yml` | GitHub Actions — builds multi-platform Docker image on push |
| `.github/workflows/build-android.yml` | GitHub Actions — builds Android APK on push |
| `docs/screenshots/` | README screenshots (regenerate with `node docs/take-screenshots.mjs`) |

---

## Architecture decisions

- **Single-container Docker**: The runtime image serves both `/api/*` (Express) and all other paths (React SPA) via `STATIC_DIR`. No separate nginx needed.
- **Multi-platform build**: The `builder` stage uses `--platform=$BUILDPLATFORM` so Node.js compilation always runs natively on the CI runner (amd64). Only the lightweight runtime stage adopts the target platform (arm64), making cross-platform builds fast without QEMU overhead.
- **esbuild bundle**: The API server compiles to a single `dist/index.mjs` with all deps inlined, except `archiver`, `unzipper`, and `pdfkit` (CJS packages that must remain external).
- **Session-based auth + bearer tokens**: `express-session` + `connect-pg-simple` for browser sessions; SHA-256-hashed bearer tokens in `api_tokens` for API/MCP access.
- **Feature flags in `site_settings`**: Log, Tasks, and Projects can be toggled on/off at runtime. The setting is a key-value row; absent key = feature enabled (Tasks/Projects default on; Log defaults off).
- **Edit locks in Postgres**: Lock state is a single row in `edit_locks` with a `lockedAt` timestamp; expiry is enforced at read time rather than via a background job.
- **DnD with @dnd-kit**: Kanban drag-and-drop uses the multi-container sortable pattern. Cards move in local state immediately (optimistic) and are persisted via a bulk reorder endpoint that accepts the full new column order.

---

## Gotchas

- The `vite.config.ts` requires `PORT` to be set even during `vite build`. The Dockerfile passes `PORT=4000` as a build-time env var.
- `drizzle-kit push` requires a TTY when there are unresolvable schema conflicts. On a fresh database this is never an issue.
- The MCP server uses stdio transport — it must be launched as a subprocess by the LLM client, not run as a standalone server.
- The Android APK produced by CI is a debug build (unsigned). For production distribution, set up signing keys in the GitHub Actions workflow.
- The `/api/dev/autologin` route (used by `docs/take-screenshots.mjs`) is only registered when `NODE_ENV !== "production"` and is never present in the Docker runtime image.

---

## Regenerating screenshots

```bash
# Requires: app running in dev mode, seed user at admin@example.com / admin123456
node docs/take-screenshots.mjs
# Saves PNGs to docs/screenshots/
```

---

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
