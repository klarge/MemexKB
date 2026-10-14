---
name: Unattended schema sync
description: Interactive schema reconciliation can falsely appear successful during task merge setup.
---

Do not treat a zero exit code from an interactive Drizzle schema push as proof that an unattended schema update succeeded. Prefer reviewed, idempotent migrations; never force ambiguous renames to avoid a prompt.

**Why:** Post-merge setup reported success even though Drizzle emitted a non-TTY prompt error while resolving table names. The process returned zero, so fail-fast shell settings did not catch it.

**How to apply:** Inspect both stderr and the actual migration outcome when diagnosing unattended database setup. Keep task-merge scripts non-interactive and avoid broad schema pushes over existing data.
