---
name: Web login navigation
description: Why local authentication completion uses a browser navigation rather than only updating client query state.
---

After a successful local login or initial setup, navigate with a full browser
replacement to the authenticated home page instead of relying only on the
single-page app's cached auth state.

**Why:** A fresh browser can complete the login request and store the session
cookie while its initial unauthenticated auth check leaves the SPA on the login
route. A clean page navigation starts the destination with the stored cookie
and reliably rehydrates the authenticated state.

**How to apply:** Preserve the full-page handoff whenever changing local login,
initial setup, session-cookie handling, or React Query auth caching. Verify in
a fresh browser context, not only an already authenticated session.