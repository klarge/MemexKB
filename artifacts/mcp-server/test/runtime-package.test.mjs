import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the Docker MCP package can be installed by standalone npm", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  // Docker copies this manifest out of the pnpm workspace, then runs npm with
  // --omit=dev. Even omitted entries must use syntax that npm can parse.
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      assert.doesNotMatch(specifier, /^(?:catalog|workspace|link):/,
        `${section}.${name} must not require pnpm workspace resolution in the standalone Docker stage`);
    }
  }
  assert.equal(manifest.dependencies.zod, "4.6.7", "Keep Docker's validator on the reviewed security-patched version");
});
