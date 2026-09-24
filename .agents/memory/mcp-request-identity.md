---
name: MCP request identity
description: Security constraint for multi-user Streamable HTTP MCP access to Memex.
---

Every MCP tool invocation must use the bearer identity from its own authenticated HTTP request. Do not introduce shared credentials or reuse a transport's user context across independent requests.

**Why:** A remote MCP endpoint serves multiple users simultaneously. A shared token, cached API client, or session not safely bound to an identity can expose one person's restricted articles to another.

**How to apply:** When adding MCP tools, session support, caching, or alternate authentication, keep identity isolation explicit and cover two users with different permissions in an integration test.