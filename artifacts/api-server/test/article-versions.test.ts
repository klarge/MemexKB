import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withIsolatedBackupSchema } from "./helpers/isolated-backup-schema";

test("article saves preserve recovery while coalescing autosaves in an isolated database", {
  skip: !process.env.DATABASE_URL && "An initialized PostgreSQL schema is required",
  timeout: 90_000,
}, async () => {
  await withIsolatedBackupSchema(async (schema, databaseUrl) => {
    const runner = fileURLToPath(new URL("./helpers/article-versions-runner.ts", import.meta.url));
    const { NODE_TEST_CONTEXT: _context, ...environment } = process.env;
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", runner], {
      env: { ...environment, DATABASE_URL: databaseUrl, BACKUP_TEST_SCHEMA: schema },
      timeout: 75_000, maxBuffer: 2 * 1024 * 1024,
    });
    if (!stdout.includes("PASS: autosave checkpoints")) throw new Error("Version runner exited without completing checks");
    process.stdout.write(stdout);
  });
});
