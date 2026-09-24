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
  const identities = {
    alice: { id: 1, name: "Alice" },
    bob: { id: 2, name: "Bob" },
    stalled: { id: 3, name: "Stalled" },
    disabled: { id: 4, name: "Disabled" },
  };
  const api = createServer((req, res) => {
    const identity = identities[req.headers.authorization?.replace(/^Bearer /, "")];
    const owner = identity?.name;
    const parsedUrl = new URL(req.url, "http://localhost");
    const path = parsedUrl.pathname;
    const offset = Number(parsedUrl.searchParams.get("offset") ?? 0);
    const limit = Number(parsedUrl.searchParams.get("limit") ?? 50);
    const ownProjectId = identity?.id * 10;
    const ownBoardId = identity?.id * 100;
    res.setHeader("Content-Type", "application/json");
    const respond = (status, data) => {
      res.writeHead(status);
      res.end(JSON.stringify(data));
    };
    if (req.headers.authorization === "Bearer limited" && path === "/api/auth/me") {
      res.setHeader("Retry-After", "2");
      respond(429, { error: "Too many requests" });
    } else if (!owner) {
      respond(401, { error: "Unauthorized" });
    } else if (path === "/api/auth/me") {
      respond(200, identity);
    } else if (path === "/api/tags" && owner === "Stalled") {
      // Deliberately never respond: the tool request should time out.
    } else if (path === "/api/tags") {
      respond(200, [{ id: 1, name: `${owner}'s tag`, color: "#123456", articleCount: 1 }]);
    } else if (owner === "Disabled" && (
      path.startsWith("/api/projects") || path.startsWith("/api/boards") ||
      path.startsWith("/api/cards") || path.startsWith("/api/tasks")
    )) {
      respond(403, { error: "Feature disabled" });
    } else if (path === "/api/projects") {
      respond(200, {
        projects: [{
          id: ownProjectId, name: `${owner}'s project`, description: "Private project",
          archivedAt: null, updatedAt: "2026-09-24T00:00:00Z", boardCount: 1,
          secretEmail: `${owner.toLowerCase()}@example.com`,
        }],
        truncated: false,
      });
    } else if (path === `/api/projects/${ownProjectId}`) {
      const allBoards = Array.from({ length: owner === "Alice" ? 51 : 1 }, (_, index) => ({
        id: ownBoardId + index, name: `${owner}'s board ${index}`, position: index, archivedAt: null,
      }));
      respond(200, {
        id: ownProjectId, name: `${owner}'s project`, description: "Private project",
        archivedAt: null, groups: [{ id: 1, name: `${owner}'s group` }],
        boards: allBoards.slice(offset, offset + limit),
        boardsHasMore: offset + limit < allBoards.length,
      });
    } else if (path === `/api/boards/${ownBoardId}`) {
      respond(200, {
        id: ownBoardId, projectId: ownProjectId, name: `${owner}'s board`, archivedAt: null,
        cardsTruncated: false,
        columns: [{
          id: ownBoardId + 1, name: "To do",
          cards: [{
            id: ownBoardId + 2, title: `${owner}'s private card`, description: "Card details",
            dueDate: null, completedAt: null, members: [{ id: identity.id, name: owner }],
          }],
        }],
      });
    } else if (path === `/api/projects/${ownProjectId}/documents`) {
      const documents = Array.from({ length: owner === "Alice" ? 51 : 1 }, (_, index) => ({
        slug: `${owner.toLowerCase()}-doc${index || ""}`,
        title: `${owner}'s document ${index}`,
        updatedAt: "2026-09-24T00:00:00Z",
      }));
      respond(200, { documents: documents.slice(offset, offset + limit), hasMore: offset + limit < documents.length });
    } else if (path === `/api/projects/${ownProjectId}/documents/${owner.toLowerCase()}-doc`) {
      respond(200, {
        slug: `${owner.toLowerCase()}-doc`, title: `${owner}'s document`,
        content: `<p>${owner}'s confidential document</p>`,
        createdAt: "2026-09-24T00:00:00Z", updatedAt: "2026-09-24T00:00:00Z", tags: [],
      });
    } else if (path === `/api/cards/${ownBoardId + 2}/comments`) {
      const comments = Array.from({ length: owner === "Alice" ? 51 : 1 }, (_, index) => ({
        id: index + 1,
        content: `${owner}'s comment ${index + 1}`,
        createdAt: "2026-09-24T00:00:00Z",
        userName: owner,
      }));
      respond(200, comments.slice(offset, offset + limit));
    } else if (path === "/api/log" && owner === "Disabled") {
      respond(403, { error: "Logs disabled" });
    } else if (path === "/api/log") {
      respond(200, {
        entries: [{ logSlug: `${owner.toLowerCase()}-log`, logOwnerId: identity.id, title: `${owner}'s log`, createdAt: "2026-09-24T00:00:00Z", updatedAt: "2026-09-24T00:00:00Z" }],
        hasMore: false,
      });
    } else if (path === `/api/logs/${identity.id}/${owner.toLowerCase()}-log`) {
      // Deliberately succeeds even with the feature disabled, like the REST route.
      respond(200, {
        title: `${owner}'s log`, logSlug: `${owner.toLowerCase()}-log`,
        content: `<p>${owner}'s private journal</p>`,
        createdAt: "2026-09-24T00:00:00Z", updatedAt: "2026-09-24T00:00:00Z",
      });
    } else if (path === "/api/tasks/lists") {
      respond(200, {
        lists: [{
          id: identity.id, name: `${owner}'s tasks`, userId: identity.id,
          tasks: [{ id: identity.id, title: `${owner}'s personal task`, completedAt: null, createdAt: "2026-09-24T00:00:00Z" }],
        }],
        truncated: owner === "Bob",
      });
    } else {
      respond(path.startsWith("/api/projects/") || path.startsWith("/api/boards/") ||
        path.startsWith("/api/cards/") || path.startsWith("/api/logs/") ? 403 : 404, { error: "Not accessible" });
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
      assert.equal(tools.body.result.tools.length, 14);
      const result = await request(token, "tools/call", { name: "list_tags", arguments: {} });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.match(result.body.result.content[0].text, new RegExp(token === "alice" ? "Alice's tag" : "Bob's tag"));
      assert.doesNotMatch(result.body.result.content[0].text, new RegExp(token === "alice" ? "Bob's tag" : "Alice's tag"));
      const other = token === "alice" ? "Bob" : "Alice";
      const call = async (name, args = {}) => {
        const response = await request(token, "tools/call", { name, arguments: args });
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.result.isError, undefined, JSON.stringify(response.body));
        assert.match(response.body.result.content[0].text, new RegExp(identities[token].name));
        assert.doesNotMatch(response.body.result.content[0].text, new RegExp(`${other}'s`));
        return response.body.result.content[0].text;
      };
      const projectId = identities[token].id * 10;
      const boardId = identities[token].id * 100;
      const projectList = await call("list_projects");
      assert.doesNotMatch(projectList, /@example\.com/);
      const project = await call("get_project", { project_id: projectId });
      await call("get_project_board", { board_id: boardId });
      const documents = await call("list_project_documents", { project_id: projectId });
      await call("get_project_document", { project_id: projectId, slug: `${token}-doc` });
      const comments = await call("get_card_comments", { card_id: boardId + 2 });
      if (token === "alice") {
        assert.match(project, /boards_offset=50/);
        assert.match(await call("get_project", { project_id: projectId, boards_offset: 50 }), /Alice's board 50/);
        assert.match(documents, /offset=50/);
        assert.match(await call("list_project_documents", { project_id: projectId, offset: 50 }), /Alice's document 50/);
        assert.match(comments, /offset=50/);
        assert.match(await call("get_card_comments", { card_id: boardId + 2, offset: 50 }), /Alice's comment 51/);
      }
      await call("list_logs");
      await call("get_log", { log_slug: `${token}-log` });
      const tasks = await call("list_tasks");
      assert.doesNotMatch(tasks, /userId/);
      if (token === "bob") assert.match(tasks, /first 200 tasks/);
    }
    const deniedProject = await request("bob", "tools/call", { name: "get_project", arguments: { project_id: 10 } });
    assert.equal(deniedProject.body.result.isError, true);
    assert.doesNotMatch(JSON.stringify(deniedProject.body), /Alice's project/);
    for (const [name, args] of [
      ["get_project_board", { board_id: 100 }],
      ["list_project_documents", { project_id: 10 }],
      ["get_project_document", { project_id: 10, slug: "alice-doc" }],
      ["get_card_comments", { card_id: 102 }],
    ]) {
      const denied = await request("bob", "tools/call", { name, arguments: args });
      assert.equal(denied.body.result.isError, true, name);
      assert.doesNotMatch(JSON.stringify(denied.body), /Alice's/);
    }
    const deniedLog = await request("bob", "tools/call", { name: "get_log", arguments: { log_slug: "alice-log" } });
    assert.equal(deniedLog.body.result.isError, true);
    assert.doesNotMatch(JSON.stringify(deniedLog.body), /Alice's private journal/);
    const disabledLog = await request("disabled", "tools/call", { name: "get_log", arguments: { log_slug: "disabled-log" } });
    assert.equal(disabledLog.body.result.isError, true);
    assert.doesNotMatch(JSON.stringify(disabledLog.body), /Disabled's private journal/);
    for (const [name, args] of [
      ["list_projects", {}],
      ["get_project", { project_id: 40 }],
      ["list_project_documents", { project_id: 40 }],
      ["list_tasks", {}],
      ["list_logs", {}],
    ]) {
      const disabled = await request("disabled", "tools/call", { name, arguments: args });
      assert.equal(disabled.body.result.isError, true, name);
      assert.doesNotMatch(JSON.stringify(disabled.body), /Disabled's project|Disabled's personal task/);
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