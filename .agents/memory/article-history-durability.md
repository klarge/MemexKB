---
name: Article history durability
description: Why history storage optimization must not reduce current-article save frequency or overwrite deliberate checkpoints.
---

Keep frequent autosave durability separate from history density. Preserve deliberate saves, editor transitions, restores, and pre-existing history when grouping nearby autosaves.

**Why:** The user approved reducing the storage growth from repeated full snapshots, not making recovery less reliable or discarding existing history.

**How to apply:** Future retention or diff-storage changes must preserve those boundaries. Do not assume a version ID guarantees immutable content: the active autosave checkpoint can evolve, so cached history views need freshness handling.
