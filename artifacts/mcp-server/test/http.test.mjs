import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function availablePort() {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test("Streamable HTTP authenticates and isolates each user's tools", async () => {
  const api = createServer((req, res) => {
    const owner = req.headers.authorization === "Bearer alice" ? "Alice"
      : req.headers.authorization === "Bearer bob" ? "Bob"
        : req.headers.authorization === "Bearer stalled" ? "Stalled" : null;
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization === "Bearer limited" && req.url === "/api/auth/me") {
      res.setHeader("Retry-After", "2");
      res.writeHead(429);
      res.end(JSON.stringify({ error: "Too many requests" }));
    } else if (!owner) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: "Unauthorized" }));
    } else if (req.url === "/api/auth/me") {
      res.end(JSON.stringify({ name: owner }));
    } else if (req.url === "/api/tags" && owner === "Stalled") {
      // Deliberately never respond: the tool request should time out.
    } else if (req.url === "/api/tags") {
      res.end(JSON.stringify([{ id: 1, name: `${owner}'s tag`, color: "#123456", articleCount: 1 }]));
    } else {
      res.writeHead(404);
      res.end("{}");
    }
  });
  const apiPort = await listen(api);
  const mcpPort = await availablePort();
  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: new URL("../", import.meta.url),
    env: {
      ...process.env,
      MEMEX_URL: `http://127.0.0.1:${apiPort}`,
      MCP_HOST: "127.0.0.1",
      MCP_PORT: String(mcpPort),
      MCP_ALLOWED_ORIGINS: "https://client.example",
      MCP_API_TIMEOUT_MS: "150",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const url = `http://127.0.0.1:${mcpPort}/mcp`;
  async function request(token, method, params, headers = {}) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }

  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`MCP server exited: ${stderr}`);
      try {
        const health = await fetch(`http://127.0.0.1:${mcpPort}/healthz`);
        if (health.ok) { ready = true; break; }
      } catch { /* startup in progress */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, `MCP server did not start: ${stderr}`);

    assert.equal((await request(null, "tools/list", {})).status, 401);
    assert.equal((await request("invalid", "tools/list", {})).status, 401);
    const rateLimited = await request("limited", "tools/list", {});
    assert.equal(rateLimited.status, 429);
    assert.equal(rateLimited.headers.get("retry-after"), "2");
    assert.equal((await request("alice", "tools/list", {}, { Origin: "https://evil.example" })).status, 403);
    const preflight = await fetch(url, { method: "OPTIONS", headers: { Origin: "https://client.example" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://client.example");

    for (const token of ["alice", "bob"]) {
      const init = await request(token, "initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      });
      assert.equal(init.status, 200, JSON.stringify(init.body));
      assert.equal(init.body.result.serverInfo.name, "memex");
      const tools = await request(token, "tools/list", {});
      assert.equal(tools.status, 200, JSON.stringify(tools.body));
      assert.equal(tools.body.result.tools.length, 5);
      const result = await request(token, "tools/call", { name: "list_tags", arguments: {} });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.match(result.body.result.content[0].text, new RegExp(token === "alice" ? "Alice's tag" : "Bob's tag"));
      assert.doesNotMatch(result.body.result.content[0].text, new RegExp(token === "alice" ? "Bob's tag" : "Alice's tag"));
    }
    const get = await fetch(url, { headers: { Authorization: "Bearer alice", Accept: "text/event-stream" } });
    assert.equal(get.status, 405);
    const stalled = await request("stalled", "tools/call", { name: "list_tags", arguments: {} });
    assert.equal(stalled.status, 200);
    assert.equal(stalled.body.result.isError, true);
  } finally {
    child.kill();
    await once(child, "exit").catch(() => {});
    await new Promise((resolve) => api.close(resolve));
  }
});