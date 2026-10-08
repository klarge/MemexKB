# Filtered board drag regression

With the Knowledge Base web workflow running and the development database
initialized, run:

```sh
pnpm --filter @workspace/api-server exec tsx --test test/filtered-board-drag.test.ts
```

This also runs as part of the API server's normal `test` script. Set
`E2E_BASE_URL` if the frontend is not served through `http://localhost:80`.
The frontend must be the Vite development server (the mutation check intercepts
its served board module).

Browser setup: use `E2E_CHROMIUM_EXECUTABLE` to select a Chromium executable.
Replit's `/repl/tools/bin/chromium` is used when present; otherwise install the
browser using the existing root Playwright tooling: `pnpm exec playwright install chromium`.
No administrator credentials or existing accounts are needed.

The existing isolated-schema helper clones **table definitions only**, rewires
foreign keys and sequences, supplies a schema-only search path to a child process,
and drops the schema in `finally`. All users, projects, boards, columns and cards
are disposable. Every browser API request is intercepted and forwarded to the
isolated test API, including startup requests; none falls through to the preview's
real API. The frontend and production authentication code are not modified.

Assertions cover person filtering (including multiply assigned cards), Unassigned,
clear and no-match states, cross-column and same-column drags, Escape cancellation,
an empty destination column, complete reorder payloads, hidden-card relative order,
unique persisted positions, and clear/reload rendering.

The runner is executed again with a browser-only mutation replacing the full
reorder state with filtered IDs. Completion requires this mutant to fail at the
complete-payload assertion, not at an unrelated startup or drag failure. This
guards against false confidence from checking only reloads: the API leaves omitted
cards in place rather than deleting them.
