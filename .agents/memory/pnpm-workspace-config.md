---
name: Pnpm workspace config preservation
description: Preserve intentional workspace YAML policy when adding dependencies.
---

Filtered pnpm dependency installs can reserialize the workspace YAML, remove its explanatory security comments, and change catalog specifiers from ranges to exact versions even when no change to those settings was requested.

**Why:** A routine package install produced an unrelated rewrite of the workspace configuration. The release-age policy and overrides are deliberate supply-chain safeguards, while the catalog ranges are intentional dependency policy.

**How to apply:** After adding dependencies, inspect the workspace configuration diff and restore unrelated serializer changes. Keep the lockfile's catalog specifiers aligned with the restored configuration; preserve the new package entries.