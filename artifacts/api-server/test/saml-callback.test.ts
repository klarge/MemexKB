import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withIsolatedBackupSchema } from "./helpers/isolated-backup-schema";

test("Signed cross-site SAML callbacks authenticate only verified identities in an isolated schema", {
  skip: !process.env.DATABASE_URL && "An initialized PostgreSQL application schema is required",
  timeout: 120_000,
}, async () => {
  await withIsolatedBackupSchema(async (schema, databaseUrl) => {
    const runner = fileURLToPath(new URL("./helpers/saml-callback-runner.ts", import.meta.url));
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl, SAML_TEST_SCHEMA: schema };
    // A nested test runner must not inherit the parent worker context.
    delete env.NODE_TEST_CONTEXT;
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--import", "tsx", "--test", "--test-reporter=tap", runner,
    ], { env, timeout: 105_000, maxBuffer: 2 * 1024 * 1024 });
    process.stdout.write(stdout);
    assert.match(stdout, /# fail 0/);
    assert.match(stdout, /ok .*valid signed callback/);
    assert.match(stdout, /ok .*wrong audience/);
  });
});
