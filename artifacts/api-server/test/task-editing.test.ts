import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withIsolatedBackupSchema } from "./helpers/isolated-backup-schema";

test("personal task titles and due dates preserve status/order, enforce ownership, and populate the dashboard", {
  skip: !process.env.DATABASE_URL && "An initialized PostgreSQL schema is required",
  timeout: 60_000,
}, async () => {
  await withIsolatedBackupSchema(async (schema, databaseUrl) => {
    const runner = fileURLToPath(new URL("./helpers/task-editing-runner.ts", import.meta.url));
    const env = { ...process.env, DATABASE_URL: databaseUrl, BACKUP_TEST_SCHEMA: schema };
    delete env.NODE_TEST_CONTEXT;
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", runner], {
      env,
      timeout: 45_000,
    });
    assert.match(stdout, /task editing and due-date integration checks passed/);
    process.stdout.write(stdout);
  });
});