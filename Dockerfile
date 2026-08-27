# syntax=docker/dockerfile:1
# Multi-stage build for Lexikon knowledge base
# Stage 1 (builder): full Node + pnpm environment — installs deps and compiles everything
# Stage 2 (runtime): lean Alpine image — only the compiled output and a handful of runtime packages

# ── Stage 1: Builder ─────────────────────────────────────────────────────────
# Always build on the native runner platform so pnpm/esbuild/vite run at full
# speed without QEMU emulation. The compiled output (JS bundles, static assets)
# is architecture-independent, so this is always safe.
FROM --platform=$BUILDPLATFORM node:24-slim AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy the entire monorepo (see .dockerignore for exclusions)
COPY . .

# Install all dependencies (dev + prod) using the lockfile
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Build the API server — produces artifacts/api-server/dist/index.mjs via esbuild
RUN pnpm --filter @workspace/api-server run build

# Build the stdio MCP server — its compiled output is packaged in the runtime
# image so Docker users do not need a separate MCP build on the host.
RUN pnpm --filter @workspace/mcp-server run build

# Build the frontend SPA.
# PORT is required by vite.config.ts even at build time (port validation).
# BASE_PATH=/ because in Docker the frontend is served from the root path.
RUN NODE_ENV=production PORT=4000 BASE_PATH=/ \
    pnpm --filter @workspace/knowledge-base run build

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
# This stage uses the target platform (arm64, amd64, etc.) — the Node binary
# here must match the architecture the container will actually run on.
FROM node:24-alpine AS runtime

WORKDIR /app

# Install only the packages that esbuild externalised (not inlined into the bundle):
#   archiver   — ZIP bulk-export
#   unzipper   — ZIP bulk-import
#   pdfkit     — PDF article export
# The MCP server has its own production dependency tree under /app/mcp.
# All other runtime dependencies (express, pino, drizzle-orm, etc.) are already
# compiled inline into dist/index.mjs by esbuild.
RUN npm install --no-save \
    archiver@^8.0.0 \
    unzipper@^0.12.3 \
    pdfkit@^0.18.0

# Compiled API server bundle + pino worker thread files
COPY --from=builder /app/artifacts/api-server/dist ./dist

# MCP stdio server and its production-only SDK dependencies. Keep this in a
# separate package root so its ESM metadata and node_modules stay isolated from
# the API runtime.
COPY --from=builder /app/artifacts/mcp-server/package.json ./mcp/package.json
RUN npm install --prefix /app/mcp --omit=dev --no-package-lock
COPY --from=builder /app/artifacts/mcp-server/dist ./mcp/dist

# Pre-built frontend SPA (static files served by Express via STATIC_DIR)
COPY --from=builder /app/artifacts/knowledge-base/dist/public ./public

# SQL migration files — applied by drizzle-orm/migrator on every app startup
COPY --from=builder /app/lib/db/migrations ./migrations

# OpenAPI spec — loaded at startup for Swagger UI via process.cwd() fallback in app.ts
COPY --from=builder /app/lib/api-spec/openapi.yaml ./lib/api-spec/openapi.yaml

ENV NODE_ENV=production
ENV PORT=3000
ENV STATIC_DIR=/app/public
ENV MIGRATIONS_DIR=/app/migrations

# SESSION_SECRET must be overridden in production (required).
# TRUST_PROXY: set to 0 when running without a reverse proxy (e.g. Docker Desktop
#   for Mac direct port-mapping). Defaults to 1 (trust one proxy hop).
# COOKIE_SECURE: set to true when serving over HTTPS.
# COOKIE_SAMESITE: "lax" (default) | "strict" | "none" (auto-enables Secure).

EXPOSE 3000

CMD ["node", "--enable-source-maps", "/app/dist/index.mjs"]
