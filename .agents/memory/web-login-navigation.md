---
name: Web session handling
description: Reliable local-login navigation and distinguishing cached identity from session-check failures.
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

## Session-check failures

React Query retains earlier successful data when a background refetch fails.
Treat a confirmed session-check 401 as signed out even if a cached profile
remains; treat 429, network failures, and server failures as unresolved checks,
not proof of logout.

**Why:** Browser verification showed that cached identity survives a failed
refetch. Ignoring the response status keeps an expired identity visible, while
treating every error as logout disrupts ordinary editing during temporary
limits or outages.

**How to apply:** Check both response status and cached data when changing
authentication state or user-scoped cache cleanup. Cover initial transient
failure, cached-user transient failure, retry recovery, and confirmed expiry.