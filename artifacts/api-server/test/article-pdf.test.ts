import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withIsolatedBackupSchema } from "./helpers/isolated-backup-schema";

test("Article PDF uses HTML rendering and preserves export authorization", {
  skip: !process.env.DATABASE_URL && "PostgreSQL is required", timeout: 90000,
}, async () => {
  await withIsolatedBackupSchema(async (schema, databaseUrl) => {
    const env = { ...process.env, DATABASE_URL: databaseUrl, BACKUP_TEST_SCHEMA: schema };
    delete env.NODE_TEST_CONTEXT;
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx",
      fileURLToPath(new URL("./helpers/article-pdf-runner.ts", import.meta.url)),
    ], { env, timeout: 75000, maxBuffer: 1024 * 1024 });
    assert.match(stdout, /article PDF checks passed/);
    process.stdout.write(stdout);
  });
});
