---
name: Article diagram constraints
description: User-required self-hosting and revision fidelity for editable article diagrams.
---

Keep diagram authoring and ordinary image export fully self-hosted. Do not
silently switch to the public diagrams.net editor or a remote export service.

**Why:** The user explicitly required the editor to ship inside this app without
depending on the public service for normal editing or export.

**How to apply:** Evaluate vendor upgrades and future diagram formats against
local embedding/export and outbound-request checks, including Docker builds.

Saved diagram revisions must keep their original editable source and preview
together rather than point at a mutable diagram that changes historical pages.

**Why:** Article version restoration and portable backups must recover the
diagram as it was at that revision, not merely show the latest rendering.

**How to apply:** Preserve immutable assets when adding new authoring features,
and check reader/PDF rendering separately from editable-source round trips.

Embedded editor security must account for the complete iframe ancestor chain,
including Replit's workspace UI, without granting the editor same-origin access.

**Why:** Direct screenshot/test browsers bypass the outer Preview frame. A
self-only frame-ancestors policy can pass those checks while blocking the
editor inside the user's workspace preview.

**How to apply:** Keep the exception scoped to static editor assets and trusted
platform ancestors; do not weaken application API CORS or the opaque sandbox.
