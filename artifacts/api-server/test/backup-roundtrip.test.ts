import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withIsolatedBackupSchema } from "./helpers/isolated-backup-schema";

test("ZIP and encrypted backups round-trip Policies, Procedures and independent projects without touching live data", {
  skip: !process.env.DATABASE_URL && "An initialized PostgreSQL application schema is required",
  timeout: 90_000,
}, async () => {
  await withIsolatedBackupSchema(async (schema, databaseUrl) => {
    const runner = fileURLToPath(new URL("./helpers/backup-roundtrip-runner.ts", import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", runner], {
      env: { ...process.env, DATABASE_URL: databaseUrl, BACKUP_TEST_SCHEMA: schema },
      timeout: 75_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    process.stdout.write(stdout);
  });
});