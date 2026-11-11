import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { LoginBody, CreateGroupBody, ListArticlesQueryParams } from "@workspace/api-zod";

test("the lockfile keeps every GitHub-reported dependency on a patched release", () => {
  const lock = readFileSync(new URL("../../../pnpm-lock.yaml", import.meta.url), "utf8");
  const minimums: Record<string, string> = {
    "node-forge": "1.4.3",
    "@modelcontextprotocol/sdk": "1.32.0",
    zod: "4.6.6",
    vite: "7.3.7",
    dompurify: "3.4.17",
    "markdown-it": "14.3.3",
    multer: "2.5.0",
    "body-parser": "2.4.0",
    undici: "6.29.1",
  };
  for (const [name, minimum] of Object.entries(minimums)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const versions = [...lock.matchAll(new RegExp(`^  '?${escaped}@(\\d+\\.\\d+\\.\\d+)'?:$`, "gm"))];
    assert.ok(versions.length, `${name} must be present in the lockfile`);
    for (const [, version] of versions) {
      const actual = version.split(".").map(Number);
      const required = minimum.split(".").map(Number);
      const comparison = actual.reduce((result, part, index) => result || part - required[index], 0);
      assert.ok(comparison >= 0, `${name}@${version} must be at least ${minimum}`);
    }
  }
});

test("oversized constrained arrays are rejected before validating their elements", () => {
  let visited = 0;
  const schema = z.array(z.string().superRefine(() => { visited++; })).max(2);
  const result = schema.safeParse(Array(4096).fill("value"));
  assert.equal(result.success, false);
  assert.equal(visited, 0, "Reject oversized input without allocating per-element validation results");
  if (!result.success) assert.equal(result.error.issues[0].code, "too_big");
});

test("generated Zod 4 validators retain login, required-field and query coercion behavior", () => {
  assert.equal(LoginBody.safeParse({ email: "user@example.test", password: "test-password" }).success, true);
  assert.equal(LoginBody.safeParse({ email: "not-an-email", password: "test-password" }).success, false);
  assert.equal(CreateGroupBody.safeParse({ name: "" }).success, false);
  assert.equal(CreateGroupBody.safeParse({ name: "Team", description: "" }).success, true);
  const query = ListArticlesQueryParams.parse({ limit: "20", offset: "0" });
  assert.equal(query.limit, 20);
  assert.equal(query.offset, 0);
});
