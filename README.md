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
MEMEX_URL=http://localhost:3000 pnpm --filter @workspace/mcp-server run dev  # MCP HTTP server on 127.0.0.1:3001
pnpm run typecheck                                 # full typecheck across all packages
pnpm run build                                     # typecheck + build all packages
pnpm --filter @workspace/api-spec run codegen     # regenerate API hooks from OpenAPI spec
pnpm --filter @workspace/db run push              # push DB schema changes (dev only)
```

Required env: `DATABASE_URL` (Postgres connection string), `SESSION_SECRET`

---

## Self-Hosting with Docker

Memex ships as a single Docker image (multi-platform: `linux/amd64` and `linux/arm64`) bundling the API server, pre-built frontend SPA, and the Streamable HTTP MCP server. No Node.js or pnpm required on the host.

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

The app applies the bundled SQL migrations before it starts listening. A connection or migration failure stops that attempt to start; check the app logs and database network/credentials rather than running `drizzle-kit push` against production. The external-DB Compose file also starts the same HTTP MCP service as the local-DB file.

### Use the MCP server from Compose

Both Compose files start an `mcp` service on HTTP port **3001 published on all Docker host interfaces**, like the app (or the host port set by `MCP_PORT`). From the Docker host, `http://127.0.0.1:3001/mcp` works. **Firewall that port to the HTTPS proxy or its private network.** Without network restrictions, clients can bypass the proxy and send bearer API keys over unencrypted HTTP. `MEMEX_URL=http://app:3000` is only the internal connection from MCP to the app. There is **no shared MCP token** in Compose.

1. Each user creates their own **Read-only** API key in **Settings → API Keys**. Every MCP request uses that key owner's permissions.
2. For remote access, put an HTTPS reverse proxy in front of both the app and the MCP port. For example, Caddy running **on the Docker host** (if the proxy runs on another host, use the Docker host's private IP and allow only that proxy to reach port 3001):

   ```caddyfile
   wiki.example.com {
     reverse_proxy /mcp 127.0.0.1:3001
     reverse_proxy 127.0.0.1:3000
   }
   ```

   Configure DNS and HTTPS for that hostname. Connect a Streamable HTTP-capable client to `https://wiki.example.com/mcp` and configure it to send `Authorization: Bearer <that user's API key>` on every request. Do not put the key in the URL or shared Compose `.env`. Clients with an HTTP-header field can use, for example:

   ```json
   {
     "url": "https://wiki.example.com/mcp",
     "headers": { "Authorization": "Bearer YOUR_OWN_READ_ONLY_API_KEY" }
   }
   ```

   The client-specific JSON shape varies. Clients that require OAuth rather than a configurable bearer header are **not supported by this API-key setup**. Browser-based clients must also have their exact origin listed in `MCP_ALLOWED_ORIGINS` in `.env`; desktop clients usually send no `Origin` header. Only allow public clients through the HTTPS proxy; restrict direct access to port 3001 with a firewall. See `artifacts/mcp-server/README.md` for local checks and client guidance.

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

The [CloudFormation template](infra/aws/ecs-rds.yaml) provisions a single-task ECS Fargate service, private RDS PostgreSQL database, ECR repository, generated Secrets Manager credentials, IAM execution role, CloudWatch logs, and an HTTPS ALB routing `/mcp` separately from the app. **It creates billable AWS resources; nothing is provisioned by this repository until you deploy the stack.** It assumes an existing VPC with at least two public and two private subnets in different Availability Zones, an ACM certificate for your hostname in the same Region, and an optional existing Route 53 public hosted zone. The public subnets need an internet gateway route; the private subnets need NAT or VPC endpoints for ECR (including S3), Secrets Manager, and CloudWatch Logs. RDS is not publicly accessible.

CloudFormation cannot push the image it is about to run, so deployment has two stages. With AWS CLI credentials configured and a PostgreSQL 16.x version available in your Region:

```bash
export AWS_REGION=us-east-1
export STACK=memexkb
export VPC_ID=vpc-REPLACE_ME
export PUBLIC_SUBNETS=subnet-PUBLIC_A,subnet-PUBLIC_B
export PRIVATE_SUBNETS=subnet-PRIVATE_A,subnet-PRIVATE_B
export ACM_CERTIFICATE_ARN=arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERTIFICATE_ID
export DOMAIN_NAME=wiki.example.com
export POSTGRES_VERSION=16.8  # choose a PostgreSQL 16.x version supported in your Region
PARAMS=(
  VpcId="$VPC_ID" PublicSubnetIds="$PUBLIC_SUBNETS" PrivateSubnetIds="$PRIVATE_SUBNETS"
  CertificateArn="$ACM_CERTIFICATE_ARN" DomainName="$DOMAIN_NAME"
  DbEngineVersion="$POSTGRES_VERSION"
)
# If using Route 53, add HostedZoneId=YOUR_PUBLIC_ZONE_ID to PARAMS.

aws cloudformation validate-template --region "$AWS_REGION" \
  --template-body file://infra/aws/ecs-rds.yaml

# Stage 1: create only the ECR repository (no running services yet).
aws cloudformation deploy --region "$AWS_REGION" --stack-name "$STACK" \
  --template-file infra/aws/ecs-rds.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides "${PARAMS[@]}" DeployRuntime=false

IMAGE_URI=$(aws cloudformation describe-stacks --region "$AWS_REGION" \
  --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='RepositoryUri'].OutputValue | [0]" --output text)
aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "${IMAGE_URI%/*}"
docker buildx build --platform linux/amd64 -t "$IMAGE_URI:v1" --push .

# Stage 2: create RDS, ECS, secrets, and the HTTPS load balancer.
# Keep deletion protection off until the first deployment is healthy so a
# failed rollout can be rolled back automatically.
aws cloudformation deploy --region "$AWS_REGION" --stack-name "$STACK" \
  --template-file infra/aws/ecs-rds.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides "${PARAMS[@]}" DeployRuntime=true ProtectDatabase=false ImageTag=v1

# After the service is healthy, protect the database from accidental deletion.
aws cloudformation deploy --region "$AWS_REGION" --stack-name "$STACK" \
  --template-file infra/aws/ecs-rds.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides "${PARAMS[@]}" DeployRuntime=true ProtectDatabase=true ImageTag=v1
```

If you did not supply `HostedZoneId`, point your hostname at the `LoadBalancerDnsName` stack output yourself. Use the hostname covered by the ACM certificate, not the ALB hostname, to browse the site. Check the app's CloudWatch log stream for “Database migrations complete” before completing initial admin setup in the browser; ALB health checks only confirm HTTP availability, not database connectivity. Each MCP request still uses its caller's own Read-only API key—no API keys are stored in the task.

The task builds its TLS-enabled `DATABASE_URL` in memory from the generated database password; neither it nor `SESSION_SECRET` appears as a plaintext value in the task definition. For simplicity this stack uses the RDS master user for application migrations. Consider a separately provisioned least-privilege application user if your security policy requires one. The database has backups and, after the final update, deletion protection. Before deleting the stack or replacing RDS, first update with `ProtectDatabase=false`; the RDS snapshot, database password secret, and ECR repository are retained on stack deletion and must be cleaned up deliberately. If the initial runtime rollout fails, inspect the ECS service events and CloudWatch logs, fix the networking/image issue, and retry with `ProtectDatabase=false`.

The service stops the old task before starting a replacement so startup migrations cannot run concurrently. **This causes a short outage on image updates.** Back up RDS before schema upgrades, build and push a **new immutable image tag**, then update `ImageTag` in the stack. Do not increase the task count or use overlapping deployments until migrations run in a separate coordinated process. The session secret remains stable across stack updates.

### Published images

```bash
docker pull ghcr.io/klarge/memexkb:latest   # amd64 + arm64
```

---

## Configure SAML SSO

Use your installation's **public HTTPS hostname** when setting up SSO. Behind an HTTPS-terminating proxy, set `COOKIE_SECURE=true` and `TRUST_PROXY=1`. If the metadata shows an internal hostname or `http://` instead of the public URL, set `APP_BASE_URL` to the public origin (for example, `https://wiki.example.com`) and reload the metadata. Do not use the container's internal address in the IdP.

1. Sign in as an admin, open **SSO / Identity**, and select **Add Provider → SAML 2.0**. Enter the IdP's SSO URL and its **current SAML signing X.509 certificate** in PEM format (`-----BEGIN CERTIFICATE-----` through `-----END CERTIFICATE-----`). The optional **SP Entity ID / Issuer** defaults to the app's public origin. Save the provider; new providers start disabled.
2. On the provider card, open the **MD** link to view the installation's SP metadata XML, or give that URL to an IdP that supports metadata import. The URL is `https://wiki.example.com/api/auth/saml/PROVIDER_ID/metadata`. If configuring manually, set the IdP's **ACS / Reply URL** to the XML's `AssertionConsumerService Location` (a **POST** endpoint ending in `/api/auth/saml/PROVIDER_ID/callback`). Set the IdP's **Audience URI / SP Entity ID / Relying Party Identifier** to the XML's `entityID` **exactly**, including any trailing slash. The audience is not the ACS URL or the IdP's own entity ID.
3. Configure the IdP to **sign both the SAML Response and the Assertion** with the private key matching the IdP signing certificate entered in Memex. Its assertion must include a `Conditions` → `AudienceRestriction` → `Audience` value equal to that exact SP `entityID`. Provide an email address as an `email` attribute, the standard email-address claim, or the NameID so Memex can identify the user.
4. Enable the provider with the switch on its card, then start a fresh sign-in from the Memex login page. Local login remains available. If you rotate the IdP signing certificate or change the public hostname/issuer, update the Memex provider and re-import the new metadata in the IdP.

Common failures: `Cannot POST /` means the IdP is posting to the site root instead of the ACS URL; `Invalid document signature` or `Invalid signature` means the required response/assertion signature is missing or cannot be verified with the configured IdP signing certificate; `SAML assertion has no AudienceRestriction` means the IdP omitted the audience, while an audience mismatch means it does not exactly match the SP `entityID`. Do not disable signature or audience validation to bypass these errors, and do not share raw SAML responses in logs or support requests.

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
| `list_projects` | List accessible active or archived projects |
| `get_project` | Read a project and its boards |
| `get_project_board` | Read columns and cards on an accessible board |
| `list_project_documents` | List a project's documents |
| `get_project_document` | Read a project's document |
| `get_card_comments` | Read recent comments on an accessible card |
| `list_logs` / `get_log` | List and read the API key owner's personal logs |
| `list_tasks` | Browse the API key owner's task lists and tasks |

**Connection:** Use the HTTPS `/mcp` endpoint and a per-user Read-only API key in an MCP client that supports Streamable HTTP with a custom Authorization header. All tools are view-only and retain the API's project/group permissions and personal log/task ownership rules. See the [Compose HTTPS instructions](#use-the-mcp-server-from-compose) and `artifacts/mcp-server/README.md`. There is no local stdio launcher or shared server-side token.

**Cursor example:** Add this to your personal Cursor MCP config at `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "memex": {
      "url": "https://wiki.example.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_OWN_READ_ONLY_API_KEY"
      }
    }
  }
}
```

Replace the example hostname with your HTTPS domain and the placeholder with a Read-only key you created in **Settings → API Keys**. Keep the key in your personal config; do not commit it in a project's `.cursor/mcp.json` or share it with other users.

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
- The MCP server uses stateless Streamable HTTP on `/mcp`; terminate public HTTPS at a reverse proxy, with each client sending its own bearer API key.
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
