---
name: Request security compatibility
description: Why request security changes must account for browser uploads, native cookie sessions, reverse proxies and signed SAML posts.
---

Keep request-security changes compatible with both direct browser uploads and native cookie sessions; do not migrate to a new CSRF token protocol without coordinating all callers.

**Why:** A synchronizer-token migration would affect generated browser requests, direct multipart/form-data uploads, native clients that manually carry session cookies, and signed cross-site SAML posts. The security fix deliberately avoided that broader authentication-protocol migration.

**How to apply:** When changing CSRF or ingress checks, verify a real browser mutation through the proxied preview, not only an isolated HTTP test. Include native cookie requests and signed SAML callbacks in compatibility coverage; do not weaken assertion validation or broaden callback exemptions to solve a middleware error.
