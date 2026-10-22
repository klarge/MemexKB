# Web application starter

A standalone extraction of Memex's web foundation: local authentication, PostgreSQL sessions, SAML and OIDC, users, roles, groups, branding and the existing responsive light/dark application shell. This directory is the **export root**. It can become its own repository; nothing imports Memex code.

This is source preparation only. It does not create a second Replit app, publish anything, register an identity provider, synchronize later Memex changes, or copy any existing users or data.

## 1. Export into a separate repository

Copy **only this directory's contents**, including dotfiles, into an empty directory outside the donor workspace. Do not copy the parent repository, `.git`, `.agents`, `.local`, `.env`, `node_modules`, `dist`, `.data`, uploads or database files.

For example, from the donor repository:

```sh
mkdir -p /tmp/my-new-app
tar -C starters/web-app \
  --exclude=node_modules --exclude=dist --exclude=.data --exclude=.git \
  --exclude=.env --exclude='core*' -cf - . | tar -C /tmp/my-new-app -xf -
cd /tmp/my-new-app
git init
git add .
git commit -m "Start independent web application"
```

Use a permanent location or your own repository instead of `/tmp` for real work. Create and push to a repository you control; this task does not do that. Preserve the included license notice. Copies are independent: future changes in Memex do not automatically update them.

## 2. Install and configure fresh infrastructure

Requirements: Node.js 22.12+ (Node 24 is tested), pnpm 10, and a **new, empty PostgreSQL database**. Never use the donor database or session secret.

```sh
pnpm install --frozen-lockfile
```

Configure these environment variables in your new project's Secrets/settings or your shell. `.env.example` lists names only; the application does not automatically load `.env` files.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Connection string for the new dedicated PostgreSQL database; required |
| `SESSION_SECRET` | Fresh random secret of at least 32 characters; required in every environment |
| `APP_BASE_URL` | Public origin, e.g. `https://app.example.com`, with no path; required for CSRF and SSO |
| `PORT` | Listening port; defaults to `3000`; honor the host-provided value |
| `TRUST_PROXY` | `0` for a direct connection; `1` only behind one trusted reverse proxy |
| `COOKIE_SECURE` | `true` for HTTPS; `false` only for local HTTP |
| `COOKIE_SAMESITE` | `lax` by default; `none` requires HTTPS and enables Secure automatically |
| `PRIVATE_OBJECT_DIR` | New App Storage path `/bucket/private-prefix`; needed for production branding uploads |

Generate your secret locally with a cryptographic generator, for example `openssl rand -hex 48`, and save it directly in the new project's Secrets. Do not commit or share it. No fixed password or fallback session secret is shipped.

```sh
pnpm db:migrate
pnpm dev
```

Open the configured origin. The first visitor is directed to **Create your administrator account**. Complete setup before exposing an uninitialized installation publicly. Setup is serialized so simultaneous submissions cannot create multiple initial administrators.

`pnpm dev` runs Express with Vite middleware on **one port**. There is no separate frontend proxy, hardcoded backend hostname, or dependency on the donor's artifact routing. This starter occupies `/` and `/api` in its own project. Do not register it as another live artifact in Memex.

## 3. Import into a new Replit app

1. Create/push the independent repository above.
2. Use [Import from GitHub](https://replit.com/import) in a **new** Replit app, then select your repository.
3. Provision a new SQL database in that app and configure fresh Secrets. Do not copy Memex's credentials, provider configuration, data or private files.
4. Set the development origin in `APP_BASE_URL`, `TRUST_PROXY=1` behind Replit's proxy, and `COOKIE_SECURE=true` for HTTPS.
5. Run `pnpm install --frozen-lockfile`, then `pnpm db:migrate`. Configure the new app's Run command as `pnpm dev`, serving its assigned `PORT` on `0.0.0.0`.
6. Complete first-run setup. Configure publishing and production secrets separately when ready.

If Replit creates artifact-managed services for the new project, configure that **new project's** web service to run this package at `/` and `/api` on the same port using its artifact configuration tools. Do not copy the donor's artifact files or workflows, and do not add a second competing server.

Official references: [Import](https://docs.replit.com/build/import-from-providers), [Secrets](https://docs.replit.com/core-concepts/project-editor/app-setup/secrets), [SQL database](https://docs.replit.com/features/data-and-storage/sql-database), [App Storage](https://docs.replit.com/features/data-and-storage/object-storage), [configuration](https://docs.replit.com/features/project-setup/configuration).

## Branding storage

Administrators can change the application name, accent color, logo and favicon under Customization. Names/colors and file **paths/metadata only** are stored in SQL; uploaded bytes are not.

In the **new Replit app**, provision App Storage and configure its fresh `PRIVATE_OBJECT_DIR`. The server uses Replit's storage sidecar credentials; no cloud credentials are exported. Outside Replit, the same adapter supports Google Cloud application-default credentials and `/bucket/prefix` paths.

Local development/test uploads use `.data/branding` (or `DEV_ASSET_DIR`). Those files are ignored, not exported and **not supported in production**. Production uploads fail explicitly until durable storage is configured. Brand images are public through the branding endpoints; never upload private documents there. SVG uploads are rejected.

## SSO configuration

Keep a password-enabled administrator for recovery while configuring SSO. Create **new registrations** in your identity provider and configure them under SSO / Identity. Provider secrets are held only in the new database and are redacted in administrator API responses. Protect database access and backups accordingly.

Use the final public HTTPS origin in `APP_BASE_URL`; changing from development to production requires new/correct callback registrations.

### SAML

- Metadata: `https://YOUR-ORIGIN/api/auth/saml/PROVIDER_ID/metadata`
- ACS callback: `https://YOUR-ORIGIN/api/auth/saml/PROVIDER_ID/callback`
- Set the SP Entity ID / Issuer explicitly and register the same audience in the IdP.
- Supply the IdP's HTTPS entry point and signing certificate. Sign **both the response and assertion**. The application validates signatures, time conditions, audience and InResponseTo.
- Start login from this app. Unsolicited IdP-initiated assertions are intentionally rejected; request IDs expire after five minutes and cannot be reused.
- Optional group mappings map SAML attribute values to existing app group IDs. Only mapped groups are reconciled; unrelated manual memberships remain.
- The assertion callback is the only cross-site POST exempted from browser-origin CSRF checks. Browser session cookies are regenerated after successful SSO; SAML correlation is database-backed, not dependent on a cookie arriving on the cross-site POST.

### OIDC

- Redirect URI: `https://YOUR-ORIGIN/api/auth/oidc/PROVIDER_ID/callback`
- Use the discovery issuer URL, fresh client ID/secret and `openid email profile` scope.
- Register authorization-code flow and S256 PKCE. State and nonce are checked, the pending request expires after five minutes, and successful authentication rotates the session.
- The IdP must return `email_verified: true`. Email-based linking to an existing account is not allowed with an unverified address.

New SSO identities receive role `user` and `SSO Only`. Existing local accounts linked by verified email retain their administrator-selected login mode and permissions. SSO never grants an administrative role automatically. Only admins manage users, roles, groups, memberships, providers and branding.

Users/editors may list their own groups. Group members can see names within a group; email addresses and roles remain administrator-only. Unrelated groups and memberships are not visible.

### Administrator recovery

With infrastructure access, a password-enabled administrator can request a short-lived, single-use recovery link:

```sh
pnpm admin:recovery admin@example.com
```

Treat the printed link like a password. Recovery revokes that account's previous sessions. This command never creates a user, assigns an admin role, generates a fixed password or changes `SSO Only`. SSO-only administrators must recover their IdP configuration through trusted infrastructure access; do not bypass their policy with password recovery. Never disable/delete the last usable SSO provider without a working alternative administrator sign-in.

## Commands and production preparation

| Command | Purpose |
| --- | --- |
| `pnpm dev` | One-port Express/Vite development server |
| `pnpm generate` | Regenerate React Query client/types and Zod validation from `openapi.yaml` |
| `pnpm typecheck` | Check frontend, server, contracts, database and tests |
| `pnpm db:migrate` | Apply transactional, checksum-verified SQL migrations |
| `pnpm build` | Regenerate contracts, typecheck, build web assets and bundle server |
| `NODE_ENV=production pnpm start` | Serve bundled API and web SPA on `PORT` |
| `TEST_DATABASE_URL=... pnpm test` | Isolated integration/protocol tests described below |

Install all dependencies for generation/build/migrations. Run migrations in a controlled release step **before** starting production, with the production database explicitly configured in that environment. The server does not silently push schema changes. The initial migration refuses a non-empty public schema; subsequent migrations use an advisory lock and applied-file checksums. Never edit an applied migration; add a new SQL file instead.

Production preparation: build, configure fresh production secrets/DB/storage, run migrations, set the production `APP_BASE_URL`, configure HTTPS/proxy cookies, update IdP callbacks, and start `NODE_ENV=production pnpm start`. Provisioning or publishing remains a separate user action. Changing `SESSION_SECRET` invalidates old sessions. Maintain infrastructure-level database/storage backups; no content backup UI is included.

## Verification

Integration tests require a **disposable dedicated database whose name is exactly `starter_verify`** and `openssl` for ephemeral certificates. They refuse the donor's `DATABASE_URL` and truncate only that explicitly selected test database. Do not put valuable data in it.

```sh
createdb starter_verify
TEST_DATABASE_URL=postgresql://localhost/starter_verify pnpm test
```

The suite applies migrations, checks setup concurrency, local login/logout/password rotation/recovery, anonymous/user/editor/admin authorization, group privacy, user/group/member CRUD, branding, and real SAML/OIDC validation with runtime-generated signing keys and an isolated OIDC discovery/token server. It checks bad signatures/audience, replay, state/nonce, PKCE and unverified email failures. No real IdP keys or credentials are included.

See `VERIFICATION.md` for the extraction verification and its limits. A real IdP registration, live cloud storage, a second Replit import and a published deployment still need configuration and checks in the independent project.

## Structure

- `server/`: retained Express authentication/administration and one-port startup
- `db/`: retained foundation-only schema and initial migration
- `shared/`: generated API client/validators, all internal to this root
- `web/`: React UI, reused theme and administration screens
- `scripts/`: migrations, build and infrastructure-authorized recovery
- `test/`: dedicated-database and ephemeral-protocol fixtures

Excluded: all knowledge-base content modules, content jobs/notifications, API keys, MCP/OAuth server, development autologin, screenshot shortcuts, native sign-in, mobile/Expo/Android, real user/content data, provider registrations, secrets, private agent memory and source Git history.
