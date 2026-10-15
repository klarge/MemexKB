// Disposable backend for the Maintenance browser test. No public data is copied.
// Start with: pnpm --filter @workspace/api-server exec tsx test/media-browser-fixture.ts
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withIsolatedBackupSchema } from "./helpers/isolated-backup-schema";

await withIsolatedBackupSchema(async (schema, databaseUrl) => {
  const runner = fileURLToPath(new URL("./helpers/media-maintenance-runner.ts", import.meta.url));
  const { NODE_TEST_CONTEXT: _context, ...environment } = process.env;
  const child = spawn(process.execPath, ["--import", "tsx", runner], {
    env: { ...environment, DATABASE_URL: databaseUrl, BACKUP_TEST_SCHEMA: schema, MEDIA_BROWSER_FIXTURE: "1" },
    stdio: "inherit",
  });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Fixture exited ${code}`)));
  });
  process.off("SIGTERM", stop);
  process.off("SIGINT", stop);
});
