---
name: Article visibility policy
description: Durable authorization and migration decisions for personal, group, and public knowledge articles.
---

Normal knowledge articles use explicit `personal`, `group`, or `public` visibility. Personal articles are owner/admin only; group articles are visible to selected group members plus owner/admin; public articles are visible to signed-in users only. Only editors/admins may create or edit normal knowledge articles, including personal articles; users retain read access to articles visible to them. Personal Logs are separate in permissions even though they use article storage: users can create and manage their own Logs.

**Why:** Treating missing group rows as public caused authorization ambiguity. Filtering only returned rows also leaked private totals and broke pagination, while account-independent client caches could briefly expose stale private data after switching users. The user explicitly wants the `user` role to read, not author, knowledge articles without losing personal Log access.

**How to apply:** Enforce one policy before database counts, sorting, pagination, stats, search, backlinks, history, exports, restores, and locks. Scope private article query caches by authenticated user. Treat Log creation/editing as an explicit owner exception rather than allowing user-owned normal articles to be edited. Existing unrestricted normal articles migrate to personal; existing grouped articles remain group-visible.