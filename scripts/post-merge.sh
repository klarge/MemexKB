#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Native SSO's ephemeral table is additive. Apply its idempotent SQL explicitly:
# the legacy "db" filter above does not select the @workspace/db package.
# Avoid a broad/forced schema push that could alter existing application data.
pnpm --filter @workspace/api-server exec tsx -e \
  'import { pool } from "@workspace/db"; import { readFileSync } from "node:fs"; (async () => { try { await pool.query(readFileSync("../../lib/db/migrations/0028_mobile_sso.sql", "utf8")); } finally { await pool.end(); } })().catch(() => { console.error("Unable to apply mobile SSO schema."); process.exitCode = 1; });'
