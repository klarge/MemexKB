#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Refresh shared declarations before checking or running merged app imports.
pnpm run typecheck:libs
# Native SSO's ephemeral table is additive. Apply its idempotent SQL explicitly:
# Broad schema pushes can prompt for ambiguous renames in unattended setup and
# may exit successfully despite the prompt failing. Use explicit migrations
# instead; never force schema changes over existing application data.
pnpm --filter @workspace/api-server exec tsx -e \
  'import { pool } from "@workspace/db"; import { readFileSync } from "node:fs"; (async () => { try { await pool.query(readFileSync("../../lib/db/migrations/0028_mobile_sso.sql", "utf8")); } finally { await pool.end(); } })().catch(() => { console.error("Unable to apply mobile SSO schema."); process.exitCode = 1; });'
