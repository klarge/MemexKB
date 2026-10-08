import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withIsolatedBackupSchema } from "./helpers/isolated-backup-schema";

test("SMTP settings, opt-ins, project/assignment events and deduplicated due reminders", {
  skip: !process.env.DATABASE_URL && "PostgreSQL is required", timeout: 120000,
}, async () => {
  await withIsolatedBackupSchema(async (schema, databaseUrl) => {
    const env = { ...process.env, DATABASE_URL: databaseUrl, BACKUP_TEST_SCHEMA: schema };
    delete env.NODE_TEST_CONTEXT;
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--import", "tsx", fileURLToPath(new URL("./helpers/notifications-runner.ts", import.meta.url)),
    ], { env, timeout: 100000, maxBuffer: 1024 * 1024 });
    assert.match(stdout, /notification integration checks passed/);
    process.stdout.write(stdout);
  });
});
