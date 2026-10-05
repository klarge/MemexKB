import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withIsolatedBackupSchema } from "./helpers/isolated-backup-schema";

test("SSO Only creation, restrictions, provisioning and backup compatibility use isolated users", {
  skip: !process.env.DATABASE_URL && "An initialized PostgreSQL application schema is required",
  timeout: 120_000,
}, async () => {
  await withIsolatedBackupSchema(async (schema, databaseUrl) => {
    const runner = fileURLToPath(new URL("./helpers/sso-only-runner.ts", import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", runner], {
      env: { ...process.env, DATABASE_URL: databaseUrl, BACKUP_TEST_SCHEMA: schema },
      timeout: 105_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    process.stdout.write(stdout);
  });
});