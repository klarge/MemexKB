import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withIsolatedBackupSchema } from "./helpers/isolated-backup-schema";

test("filtered board dragging preserves hidden cards (including a filtered-payload mutation check)", {
  skip: !process.env.DATABASE_URL && "An initialized PostgreSQL schema is required",
  timeout: 240_000,
}, async () => {
  await withIsolatedBackupSchema(async (schema, databaseUrl) => {
    const runner = fileURLToPath(new URL("./helpers/filtered-board-drag-runner.ts", import.meta.url));
    const env = { ...process.env, DATABASE_URL: databaseUrl, BACKUP_TEST_SCHEMA: schema };
    // This child is a script, not a nested node --test process.
    const run = (args: string[]) => promisify(execFile)(
      process.execPath, ["--import", "tsx", runner, ...args],
      { env, timeout: 105_000, maxBuffer: 2 * 1024 * 1024 },
    );
    const { stdout } = await run([]);
    assert.match(stdout, /FILTERED_BOARD_DRAG_PASSED/);
    process.stdout.write(stdout);

    // Mutate only the browser's served module, never the source on disk. A
    // passing mutant would mean this test no longer protects the full payload.
    await assert.rejects(run(["--mutate-filtered-reorder"]), (error: any) => {
      assert.match(error.stdout, /FILTERED_REORDER_MUTATION_APPLIED/);
      assert.match(error.stderr, /reorder payload must contain every card exactly once/);
      return true;
    });
    console.log("Filtered-only reorder mutation rejected by the regression check.");
  });
});
