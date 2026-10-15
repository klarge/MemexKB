import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withIsolatedBackupSchema } from "./helpers/isolated-backup-schema";

test("media maintenance preserves all references and deletes only confirmed unused synthetic images", {
  skip: !process.env.DATABASE_URL && "An initialized PostgreSQL schema is required", timeout: 90_000,
}, async () => {
  await withIsolatedBackupSchema(async (schema, databaseUrl) => {
    const runner = fileURLToPath(new URL("./helpers/media-maintenance-runner.ts", import.meta.url));
    const { NODE_TEST_CONTEXT: _context, ...environment } = process.env;
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", runner], {
      env: { ...environment, DATABASE_URL: databaseUrl, BACKUP_TEST_SCHEMA: schema },
      timeout: 75_000, maxBuffer: 2 * 1024 * 1024,
    });
    if (!stdout.includes("PASS: safe media maintenance")) throw new Error("Media runner did not complete");
    process.stdout.write(stdout);
  });
});
