import test from "node:test";
import assert from "node:assert/strict";
import { protectedResourceMetadata } from "../dist/oauth-metadata.js";

test("MCP OAuth metadata trims long trailing slash runs without changing interior paths", () => {
  const previous = process.env.APP_BASE_URL;
  try {
    process.env.APP_BASE_URL = `https://memex.test/team/path${"/".repeat(300_000)}`;
    const metadata = protectedResourceMetadata({ headers: { host: "untrusted.test" } });
    assert.equal(metadata.resource, "https://memex.test/team/path/mcp");
    assert.deepEqual(metadata.authorization_servers, ["https://memex.test/team/path/api/oauth"]);
    delete process.env.APP_BASE_URL;
    assert.equal(protectedResourceMetadata({ headers: { host: `127.0.0.1:4567${"/".repeat(100_000)}` } }).resource,
      "http://127.0.0.1:4567/mcp");
    assert.throws(() => protectedResourceMetadata({ headers: { host: "external.test" } }), /HTTPS APP_BASE_URL/);
  } finally {
    if (previous === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previous;
  }
});
