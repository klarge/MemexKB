---
name: Article URL policy
description: Product decision for article titles, URLs, and internal bracket links.
---

Article title edits must not change an article URL. URL changes are a deliberate administrator action that migrates internal references while keeping their visible labels. Normal article URLs use the `/knowledge/<slug>` public path; legacy `/wiki` paths are compatibility redirects only.

**Why:** Shared URLs, bookmarks, and existing bracket links should not break when a title is revised. A URL change has a broader effect because it rewrites references across the knowledge base, so it needs elevated access and clear user intent.

**How to apply:** Keep ordinary bracket links compatible and direct their rendered browser links to `/knowledge`. Preserve legacy `/wiki` article, edit, history, and creation URLs as client redirects when changing public navigation. When an explicit URL change needs to preserve a label independently of its target, use the stable-target bracket form `[[slug|label]]`; do not make title editing silently alter URLs.