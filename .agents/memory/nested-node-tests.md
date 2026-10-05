---
name: Nested Node test runners
description: Avoid false-success subprocess tests caused by inherited Node test-worker context.
---

Unset `NODE_TEST_CONTEXT` when a `node --test` test starts another `node --test` process, and check its output confirms tests actually ran.

**Why:** The parent runner supplies a worker-context environment flag. In this environment a nested runner inheriting it exited successfully in milliseconds without discovering any tests; running the same file directly executed them normally.

**How to apply:** For subprocess regression suites, remove the inherited flag from the child environment and assert a test summary or another explicit execution signal, not just exit status zero. Ordinary child scripts that do not launch a test runner are unaffected.