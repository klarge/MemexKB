OAuth's browser consent page intentionally suppresses referrers. Some browsers
omit Origin on its same-origin HTML form submissions as well.

**Why:** A real browser could sign in and reach the consent page but the generic
CSRF middleware rejected Deny before the OAuth handler saw its session nonce.

**How to apply:** Consent and disconnect are exempt from the generic Origin
check because their handlers require the signed-in session and a separate
unpredictable CSRF nonce. Header-based checks alone do not reliably work for
these forms. Keep all other browser, native and signed-SSO request rules intact;
never add a cookie-based OAuth mutation without its own nonce verification.

The OAuth consent page's CSP must explicitly permit both Memex's public origin
and the validated, registered AI callback origin for `form-action`.

**Why:** A real browser blocked the external OAuth callback after the server
had successfully returned HTTP 303 for consent. Browsers can apply the
initiating page's form-action rule to the redirect chain; self-only and
Memex-only rules can both break a legitimate cross-origin callback.

**How to apply:** Derive callback CSP origins only after exact redirect URI
registration has been verified. Keep the allowlist limited to the current
approved client and Memex, and retain no-referrer headers on the redirect so
authorization codes do not leak via a Referer.
---
name: Request security compatibility
description: Why request security changes must account for browser uploads, native cookie sessions, reverse proxies and signed SAML posts.
---

Keep request-security changes compatible with both direct browser uploads and native cookie sessions; do not migrate to a new CSRF token protocol without coordinating all callers.

**Why:** A synchronizer-token migration would affect generated browser requests, direct multipart/form-data uploads, native clients that manually carry session cookies, and signed cross-site SAML posts. The security fix deliberately avoided that broader authentication-protocol migration.

**How to apply:** When changing CSRF or ingress checks, verify a real browser mutation through the proxied preview, not only an isolated HTTP test. Include native cookie requests and signed SAML callbacks in compatibility coverage; do not weaken assertion validation or broaden callback exemptions to solve a middleware error.
