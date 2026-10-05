import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withIsolatedBackupSchema } from "./helpers/isolated-backup-schema";

test("personal favorites preserve ownership, access checks, live links and encrypted backup compatibility", {
  skip: !process.env.DATABASE_URL && "An initialized PostgreSQL schema is required",
  timeout: 90_000,
}, async () => {
  await withIsolatedBackupSchema(async (schema, databaseUrl) => {
    const runner = fileURLToPath(new URL("./helpers/favorites-runner.ts", import.meta.url));
    const { NODE_TEST_CONTEXT: _testContext, ...environment } = process.env;
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", runner], {
      env: { ...environment, DATABASE_URL: databaseUrl, BACKUP_TEST_SCHEMA: schema },
      timeout: 75_000, maxBuffer: 2 * 1024 * 1024,
    });
    if (!stdout.includes("All content types, user isolation")) throw new Error("Favorites runner exited without completing its checks");
    process.stdout.write(stdout);
  });
});