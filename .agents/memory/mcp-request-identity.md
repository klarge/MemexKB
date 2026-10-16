---
name: MCP request identity
description: Security constraint for multi-user Streamable HTTP MCP access to Memex.
---

Every MCP tool invocation must use the bearer identity from its own authenticated HTTP request. Do not introduce shared credentials or reuse a transport's user context across independent requests.

**Why:** A remote MCP endpoint serves multiple users simultaneously. A shared token, cached API client, or session not safely bound to an identity can expose one person's restricted articles to another.

**How to apply:** When adding MCP tools, session support, caching, or alternate authentication, keep identity isolation explicit and cover two users with different permissions in an integration test.

Corporate AI users need MCP access that follows each employee's Memex
permissions, not a shared service-account key. A read-only key still reads
everything its owner is allowed to see.

**Why:** The user explicitly requested end-user-level access when the corporate
AI calls Memex, even though a service-account API key already works.

**How to apply:** Keep per-user OAuth authorization delegated by the employee,
read-only and resource-bound to MCP. Check the employee's current Memex identity
and group memberships on each call; never use client-credentials impersonation,
an AI-supplied username, or a shared privileged backend key as the user's
identity. Keep legacy personal API keys available.