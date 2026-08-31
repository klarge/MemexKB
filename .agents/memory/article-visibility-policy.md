---
name: Article visibility policy
description: Durable authorization and migration decisions for personal, group, and public knowledge articles.
---

Normal knowledge articles use explicit `personal`, `group`, or `public` visibility. Personal articles are owner/admin only; group articles are visible to selected group members plus owner/admin; public articles are visible to signed-in users only. Ordinary users may create and edit their own personal articles, but editor/admin privileges are required to create group/public articles or change visibility away from personal.

**Why:** Treating missing group rows as public caused authorization ambiguity. Filtering only returned rows also leaked private totals and broke pagination, while account-independent client caches could briefly expose stale private data after switching users.

**How to apply:** Enforce one policy before database counts, sorting, pagination, stats, search, backlinks, history, exports, restores, and locks. Scope private article query caches by authenticated user. Existing unrestricted normal articles migrate to personal; existing grouped articles remain group-visible.