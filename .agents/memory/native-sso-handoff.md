---
name: Native SSO handoff boundaries
description: Why native SSO uses PKCE, a fixed scheme, persistent SAML request correlation, and HTTPS.
---

Treat a custom app scheme as a routing convenience, not proof of app identity. Keep the native verifier in memory and fail closed after an app restart; a cold callback should require a new sign-in, not resume using URL-supplied credentials.

**Why:** Another installed app can claim the same custom scheme. PKCE makes an intercepted callback useless without the initiating app's verifier. Persisting pending sign-ins is unnecessary for the read-only mobile milestone and adds recovery and stale-account risks.

**How to apply:** Do not introduce dynamic callback URLs or put session cookies in browser links. Native SSO requires HTTPS even though password/server selection retains legacy HTTP support. Expo Go does not own Memex's custom scheme; test the handoff in a standalone/development build.

Mobile SAML must correlate the signed response to the initiating request independently of the browser session cookie, without relaxing signature or audience checks.

**Why:** A cross-site SAML POST can omit a SameSite=Lax cookie. In-memory request caches also fail when the callback lands on another server replica.

**How to apply:** Keep mobile correlation shared across replicas and enforce InResponseTo; do not change the IdP ACS to an app scheme or weaken signed SAML validation to make the callback work.
