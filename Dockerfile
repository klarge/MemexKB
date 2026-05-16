# syntax=docker/dockerfile:1
# Multi-stage build for Lexikon knowledge base
# Stage 1 (builder): full Node + pnpm environment — installs deps and compiles everything
# Stage 2 (runtime): lean Alpine image — only the compiled output and a handful of runtime packages

# ── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:24-slim AS builder

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

# Build the frontend SPA.
# PORT is required by vite.config.ts even at build time (port validation).
# BASE_PATH=/ because in Docker the frontend is served from the root path.
# NODE_OPTIONS heap increase prevents OOM during minification on memory-
# constrained CI runners (especially QEMU arm64 emulation).
RUN NODE_ENV=production PORT=4000 BASE_PATH=/ NODE_OPTIONS="--max-old-space-size=4096" \
    pnpm --filter @workspace/knowledge-base run build

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

WORKDIR /app

# Install only the packages that esbuild externalised (not inlined into the bundle):
#   archiver   — ZIP bulk-export
#   unzipper   — ZIP bulk-import
#   pdfkit     — PDF article export
# All other runtime dependencies (express, pino, drizzle-orm, etc.) are already
# compiled inline into dist/index.mjs by esbuild.
RUN npm install --no-save \
    archiver@^8.0.0 \
    unzipper@^0.12.3 \
    pdfkit@^0.18.0

# Compiled API server bundle + pino worker thread files
COPY --from=builder /app/artifacts/api-server/dist ./dist

# Pre-built frontend SPA (static files served by Express via STATIC_DIR)
COPY --from=builder /app/artifacts/knowledge-base/dist/public ./public

# OpenAPI spec — loaded at startup for Swagger UI via process.cwd() fallback in app.ts
COPY --from=builder /app/lib/api-spec/openapi.yaml ./lib/api-spec/openapi.yaml

ENV NODE_ENV=production
ENV PORT=3000
ENV STATIC_DIR=/app/public

EXPOSE 3000

CMD ["node", "--enable-source-maps", "/app/dist/index.mjs"]
