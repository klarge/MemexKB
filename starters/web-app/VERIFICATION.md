# Extraction verification

Verified on 2026-10-21 (America/Los_Angeles), Node 24 and pnpm 10.

## Independent export

The starter was copied to a separate temporary directory outside the donor workspace. Installed dependencies, build outputs, development branding files and generated API outputs were excluded from that copy. No donor package, source symlink, generated declaration cache, database or authentication configuration was used.

Passed:

- `pnpm install --frozen-lockfile`
- API client, shared types and Zod validator regeneration from the retained OpenAPI contract
- Full TypeScript check
- Production Vite build and bundled Express build
- Fresh database migration and repeat migration
- Production startup with working health, setup-status and HTML/asset serving
- Initial migration refusal against a separate non-empty test database, leaving its existing table intact and not creating a migration marker

The build emits a non-blocking warning about a JavaScript chunk exceeding 500 kB.

## Integration and protocol tests

`TEST_DATABASE_URL=.../starter_verify pnpm test` passed **10 tests, zero failures/skips**, in the independent copy.

Covered:

- Serialized initial-administrator setup and persisted local sessions
- Users, roles, groups and membership creation/editing/removal/deletion
- Forbidden administration access for anonymous users, regular users and editors
- Group isolation and redaction of member email/role information
- CSRF origin enforcement and exact SAML callback exception
- Branding name/color validation and logo/favicon upload, serving and deletion using development storage; SQL stores metadata/paths, not file bytes
- Password rotation, one-time recovery, revocation of recovered sessions, SSO-only restrictions and last-administrator protection
- Real SAML signatures with ephemeral certificates: request correlation, valid login, replay rejection, unsigned/tampered responses and bad audience rejection
- Isolated OIDC discovery/token/JWKS server: signed ID tokens, state, nonce, PKCE, audience, verified email and callback replay
- Immediate authorization changes after role updates and account deletion; sign-out

All database verification used a separate temporary PostgreSQL instance. Test signing keys were generated at runtime and removed by fixture cleanup.

## Focused browser verification

One browser pass against the independently built production server passed:

- First-run setup and administrator home
- User/group create and edit; membership add/remove with visible updates
- Disabled OIDC provider create, edit and delete
- Name/accent branding persisted after reload and appeared in navigation
- Dark/light theme switching and persistence
- Password change, sign-out and sign-in with the new password
- Regular-user home without administrator navigation; direct admin URL redirected safely
- Responsive navigation at a 390 × 844 viewport, including an unclipped sidebar drawer

No blocking browser error was observed. The initial anonymous session check returned the expected 401. Non-blocking password-form/autocomplete browser warnings remain.

## Not verified or performed here

- No second Replit project, external repository or published deployment was created.
- No real identity provider was registered or contacted. A new project's IdP registration, certificates/secrets, verified-email claim and public callback URLs must still be configured.
- Production App Storage was not provisioned or contacted; development-storage uploads were API-tested. Live production image upload and its unconfigured-storage error were not browser-tested.
- No donor data, runtime code, dependency manifests/lockfile, workflows or deployment configuration was changed. Temporary verification servers and databases were stopped after checks.
