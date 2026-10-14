import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withIsolatedBackupSchema } from "./helpers/isolated-backup-schema";

test("Native SSO uses signed providers and isolated, expiring one-use grants", {
  skip: !process.env.DATABASE_URL && "An initialized PostgreSQL application schema is required",
  timeout: 120_000,
}, async () => {
  await withIsolatedBackupSchema(async (schema, databaseUrl) => {
    const env = { ...process.env, DATABASE_URL: databaseUrl, MOBILE_SSO_TEST_SCHEMA: schema };
    delete env.NODE_TEST_CONTEXT;
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--import", "tsx", "--test", "--test-reporter=tap",
      fileURLToPath(new URL("./helpers/mobile-sso-runner.ts", import.meta.url)),
    ], { env, timeout: 105_000, maxBuffer: 2 * 1024 * 1024 });
    process.stdout.write(stdout);
    assert.match(stdout, /# fail 0/);
    assert.match(stdout, /ok .*signed SAML handoff/);
    assert.match(stdout, /ok .*OIDC handoff/);
  });
});
