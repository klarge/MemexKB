---
name: Private log URLs
description: Public log paths are owner-scoped and are never a substitute for server-side authorization.
---

Personal logs use a stable URL made from the immutable numeric owner ID and an immutable per-owner log slug. A log title may change without changing that URL. The global article slug for a log is only an internal identifier and must not be treated as a public path.

**Why:** Users can have identical log titles, and display names may change or collide. Owner-scoped paths prevent collisions while server-side owner-or-admin checks prevent path knowledge from becoming access.

**How to apply:** Keep logs out of shared `/wiki` navigation and normal wikilink targets. Any endpoint returning, exporting, locking, restoring, or linking to a log must enforce owner-or-admin access and use the owner-scoped URL when it is shown to a client.