import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withIsolatedBackupSchema } from "./helpers/isolated-backup-schema";

test("article, log and document citations survive history, ZIP and encrypted backup round trips", {
  skip: !process.env.DATABASE_URL && "An initialized PostgreSQL schema is required",
  timeout: 120_000,
}, async () => {
  await withIsolatedBackupSchema(async (schema, databaseUrl) => {
    const runner = fileURLToPath(new URL("./helpers/citation-roundtrip-runner.ts", import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", runner], {
      env: { ...process.env, DATABASE_URL: databaseUrl, BACKUP_TEST_SCHEMA: schema },
      timeout: 105_000,
    });
    process.stdout.write(stdout);
  });
});