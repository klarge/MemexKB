# CodeQL findings review

This review addresses the screenshot containing alerts 185 through 166 and alert 7.
Line numbers in GitHub may refer to older revisions. Changes are implemented locally;
GitHub must analyze the updated revision before their alert status can be confirmed.
No query or test directory has been excluded from scanning.

## Implemented changes

| Findings | Resolution |
| --- | --- |
| 185, 184: URL substring checks in OAuth tests | Parse CSP directives and compare the complete `form-action` source list. Validate login redirects using exact URL origin and pathname comparisons. |
| 177, 176: missing rate limits in the OAuth test fixture | Install an actual Express rate limiter before every fixture route, including discovery and administration stubs. |
| 175–172: missing rate limits on public discovery endpoints | All four `/.well-known/` OAuth aliases now share one 120-request/minute IP quota. A dedicated test confirms HTTP 429 and Retry-After across aliases, while session checks remain available. |
| 171: browser OAuth return navigation | Session storage now supplies parsed query parameters only. The navigation call builds a fixed `/api/oauth/authorize` path and serializes its parameters; stored data cannot select a scheme, host or pathname. Invalid and tampered stored targets are rejected and removed. |
| 170, 167: potentially polynomial trailing-slash regexes | Replaced the MCP metadata and request-specific fetch base URL regexes with bounded linear scans. Regression tests include very long trailing slash runs. |
| 166: substring checks in SAML tests | Parse metadata and AuthnRequest XML and compare complete entity IDs, callback locations and issuer values. |

## Five findings that require false-positive review

### 181 and 180: SHA-256 in the OAuth helper

Suggested GitHub dismissal reason: **False positive**.

Copy-ready explanation:

> These hashes are not password hashes. `hashOAuth` produces lookup digests for
> cryptographically random server-generated OAuth credentials containing 256 bits
> of entropy. User passwords are independently protected with bcrypt. The second
> SHA-256 operation is the RFC 7636 S256 PKCE transformation, whose algorithm and
> output format are mandatory for interoperable OAuth. Replacing it with a
> password KDF would break the protocol without improving password protection.
> Regression tests check the RFC 7636 vector and the random credential length.

Evidence: `artifacts/api-server/src/lib/oauth.ts`,
`artifacts/api-server/src/routes/oauth.ts`, `artifacts/api-server/src/routes/auth.ts`,
and `artifacts/api-server/test/security-inputs.test.ts`.

### 179, 168 and 7: unrecognized custom CSRF middleware

Suggested GitHub dismissal reason: **False positive**.

Copy-ready explanation:

> The production app and both isolated test apps install `csrfProtection` before
> body parsing and session-backed routing. It rejects browser writes without a
> trusted Origin/Referer, rejects untrusted or opaque origins even with a native
> header or bearer token, and permits native no-Origin requests only with a
> non-simple custom header or bearer credentials. Exact protocol exemptions are
> protected separately: signed SAML assertions; explicit OAuth client/grant
> credentials; and session-bound OAuth consent/disconnect nonces. Consent also
> checks the pending authorization request's expiry.
> The CodeQL missing-token-validation query recognizes a limited set of middleware
> libraries and session-token patterns rather than this custom origin-aware gate.
> Real HTTP and signed-callback tests verify the protections. The integration
> fixtures use isolated database schemas and do not expose production endpoints.

Evidence: `artifacts/api-server/src/lib/csrf.ts`, `artifacts/api-server/src/app.ts`,
`artifacts/api-server/test/csrf.test.ts`,
`artifacts/api-server/test/helpers/mcp-oauth-runner.ts`,
`artifacts/api-server/test/helpers/mobile-sso-runner.ts`, and
`artifacts/api-server/test/helpers/saml-callback-runner.ts`.

Reference: [CodeQL's CSRF middleware recognition query](https://github.com/github/codeql/blob/main/javascript/ql/src/Security/CWE-352/MissingCsrfMiddleware.ql).

Do not replace these checks with an incompatible browser-only CSRF protocol,
weaken signed SAML validation, change PKCE, or suppress the entire query just to
make these alerts disappear.
