# Lexikon

A self-hostable, wiki-style knowledge base with a React frontend and an Express backend. Features include a WYSIWYG editor with wikilinks, group-based access control, article version history, bulk import/export (ZIP + Markdown), and Swagger API docs.

---

## Self-Hosting

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
# Edit .env — at minimum set SESSION_SECRET and POSTGRES_PASSWORD

# 3. Start everything (Postgres + migration + app)
docker compose up -d

# 4. Open http://localhost:3000
```

On first boot, set `RUN_SEED=true` in `.env` together with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` to create the initial admin account. Remove those variables after the first successful start.

### Environment variables

See [`.env.example`](.env.example) for the full list. The minimum required:

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Long random string for signing session cookies |
| `POSTGRES_PASSWORD` | Password for the `lexikon` Postgres user |

Generate a session secret with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Using pre-built images

Release images are published to GitHub Container Registry on every `v*.*.*` tag:

```bash
# Pull a specific release
docker pull ghcr.io/<your-org>/lexikon:v1.0.0

# Or always pull latest
docker pull ghcr.io/<your-org>/lexikon:latest
```

To use a pre-built image instead of building locally, replace `build: .` with `image: ghcr.io/<your-org>/lexikon:<tag>` in `docker-compose.yml`.

### Schema migrations

`docker compose up` automatically applies the latest schema before starting the app. If you are upgrading an existing installation and need to run migrations manually:

```bash
docker compose run --rm migrate \
  pnpm --filter @workspace/db run push
```

---

## Development

See [`replit.md`](replit.md) for the full developer guide including stack details, architecture decisions, and where things live.

```bash
# Install dependencies
pnpm install

# Push the DB schema (requires DATABASE_URL)
pnpm --filter @workspace/db run push

# Start the API server
pnpm --filter @workspace/api-server run dev

# Start the frontend
pnpm --filter @workspace/knowledge-base run dev
```

---

## License

MIT
