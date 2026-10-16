import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withIsolatedBackupSchema } from "./helpers/isolated-backup-schema";

test("MCP OAuth isolates employee permissions and secures token lifecycle", {
  skip: !process.env.DATABASE_URL && "An initialized PostgreSQL schema is required", timeout: 120_000,
}, async () => {
  await withIsolatedBackupSchema(async (schema, databaseUrl) => {
    const env = { ...process.env, DATABASE_URL: databaseUrl, OAUTH_TEST_SCHEMA: schema };
    delete env.NODE_TEST_CONTEXT;
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--import", "tsx", "--test", "--test-reporter=tap",
      fileURLToPath(new URL("./helpers/mcp-oauth-runner.ts", import.meta.url)),
    ], { env, timeout: 100_000, maxBuffer: 2 * 1024 * 1024 });
    process.stdout.write(stdout);
    assert.match(stdout, /ok .*employee permissions/);
    assert.match(stdout, /# fail 0/);
  });
});
