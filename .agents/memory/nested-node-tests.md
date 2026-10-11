---
name: Nested Node test runners
description: Avoid false-success subprocess tests caused by inherited Node test-worker context.
---

Unset `NODE_TEST_CONTEXT` when a `node --test` test starts another `node --test` process, and check its output confirms tests actually ran.

**Why:** The parent runner supplies a worker-context environment flag. In this environment a nested runner inheriting it exited successfully in milliseconds without discovering any tests; running the same file directly executed them normally.

**How to apply:** For subprocess regression suites, remove the inherited flag from the child environment and assert a test summary or another explicit execution signal, not just exit status zero. Ordinary child scripts that do not launch a test runner are unaffected.

When parsing child-runner output, explicitly choose a reporter (for example, `--test-reporter=tap`) rather than assuming TAP is the default.

**Why:** The runner can select the human-readable spec reporter in this environment, so a successful suite has no `# fail 0` or `ok` lines unless TAP is requested explicitly.

**How to apply:** Pin the child reporter and check its completion summary and representative executed cases together.