# Lexikon

A self-hostable wiki-style knowledge base with a React frontend and Express backend.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Self-Hosting with Docker

Lexikon ships as a single Docker image that bundles both the API server and the
pre-built frontend SPA.  No Node.js or pnpm required on the host.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24+
- [Docker Compose](https://docs.docker.com/compose/) v2

### Quick start

```bash
# 1. Clone the repository
git clone https://github.com/<your-org>/lexikon.git
cd lexikon

# 2. Create your environment file
cp .env.example .env
#    Edit .env — at minimum set SESSION_SECRET and POSTGRES_PASSWORD.

# 3. Start everything (Postgres + migration + app)
docker compose up -d

# 4. Open http://localhost:3000
```

On first boot, set `RUN_SEED=true` in `.env` together with `SEED_ADMIN_EMAIL`
and `SEED_ADMIN_PASSWORD` to create the initial admin account.  Remove the seed
variables after the first successful start.

### Environment variables

See `.env.example` for the full list with descriptions.  The minimum required
variables are:

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Long random string for signing session cookies |
| `POSTGRES_PASSWORD` | Password for the `lexikon` Postgres user |
| `DATABASE_URL` | Postgres connection string (auto-set by compose) |

### Schema migrations

`docker compose up` automatically runs `drizzle-kit push` (via the `migrate`
service) before starting the app.  This is safe on a fresh database.  If you
are upgrading an existing installation and the schema change requires interactive
conflict resolution, run the migration manually:

```bash
docker compose run --rm migrate \
  pnpm --filter @workspace/db run push
```

### Published images

Release images are published to GitHub Container Registry on every `v*.*.*` tag:

```bash
docker pull ghcr.io/<your-org>/lexikon:latest
```

To use a pre-built image instead of building locally, replace `build: .` with
`image: ghcr.io/<your-org>/lexikon:<tag>` in `docker-compose.yml`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Frontend: React 19 + Vite 7 + TipTap editor
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (bundled API), Vite (frontend SPA)

## Where things live

- `artifacts/api-server/src/` — Express API, routes, auth, seed
- `artifacts/knowledge-base/src/` — React SPA (pages, components, hooks)
- `lib/db/src/schema/` — Drizzle ORM schema (source of truth for DB shape)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contract)
- `lib/api-client-react/src/generated/` — auto-generated React Query hooks (do not edit)

## Architecture decisions

- **Single-container Docker**: The runtime image serves both `/api/*` (Express)
  and all other paths (React SPA static files) via `STATIC_DIR`.  No separate
  nginx container needed.
- **esbuild bundle**: The API server is compiled to a single `dist/index.mjs`
  with all deps inlined, except `archiver`, `unzipper`, and `pdfkit` which are
  CJS packages that must remain external.
- **pnpm deploy for migrations**: The `migrate` Docker service uses the
  `builder` stage so drizzle-kit is available without polluting the runtime image.
- **Session-based auth**: `express-session` + `connect-pg-simple` stores sessions
  in Postgres so they survive restarts without a separate Redis service.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The vite.config.ts requires `PORT` to be set even during `vite build` (it
  validates it at config-evaluation time).  The Dockerfile passes `PORT=4000`
  as a build-time env var.
- `drizzle-kit push` requires a TTY when there are unresolvable schema conflicts.
  On a fresh database this is never an issue.  For upgrades with conflicts, run
  the migration manually (see Self-Hosting above).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
