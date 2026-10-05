---
name: Favorites policy
description: Personal bookmark scope and behavior when access changes.
---

Favorites are personal to the signed-in user, across Policies, Procedures, Knowledge articles, and Projects.

**Why:** The user requested a home-screen area showing the user's favorites, not a shared organization-wide list.

**How to apply:** Keep favorites account-scoped on any additional client or derived surface, and apply current content permissions before returning metadata or links.

Temporarily inaccessible favorites should be hidden, not automatically erased.

**Why:** A sharing or membership change should not destroy the user's saved preference; it can become visible again if access is restored.

**How to apply:** Filter inaccessible targets when listing favorites. Do not turn authorization filtering into automatic bookmark deletion.