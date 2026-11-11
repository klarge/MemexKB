import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withIsolatedBackupSchema } from "./helpers/isolated-backup-schema";

test("admin dashboard totals count all accounts and groups independently of article activity", {
  skip: !process.env.DATABASE_URL && "An initialized PostgreSQL schema is required",
  timeout: 90_000,
}, async () => {
  await withIsolatedBackupSchema(async (schema, databaseUrl) => {
    const { NODE_TEST_CONTEXT: _context, ...environment } = process.env;
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx",
      fileURLToPath(new URL("./helpers/dashboard-stats-runner.ts", import.meta.url)),
    ], {
      env: { ...environment, DATABASE_URL: databaseUrl, BACKUP_TEST_SCHEMA: schema },
      timeout: 75_000, maxBuffer: 2 * 1024 * 1024,
    });
    assert.match(stdout, /Dashboard totals checks passed/);
    process.stdout.write(stdout);
  });
});
