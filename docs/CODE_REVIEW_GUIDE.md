# Memex: architecture and production code-review guide

**Audience:** reviewers comfortable with HTML and Python who are new to TypeScript.

**Scope:** the current Memex application, not the previously extracted starter. This guide describes source code and deployment files inspected when it was written. It does not certify a deployed environment, establish that every route is secure, or report a newly executed test suite or vulnerability scan.

## 1. What the application does

Memex is a self-hostable knowledge base with related work-management features:

- Knowledge articles with rich text, links, images, tags, citations, diagrams and version history.
- Policies organized into categories and procedures containing ordered steps.
- Personal logs, personal favorites and personal task lists.
- Projects, project documents, boards and cards, with project membership and management rules.
- Local password sign-in and SAML/OIDC single sign-on.
- Administration of users, roles, groups, branding, notifications, imports, exports, backups and media maintenance.
- A mobile client with offline access, plus an MCP service that exposes application capabilities to compatible external tools.

These are not independent security domains merely because they have separate screens. Several features share the same article tables, users, groups and authorization helpers. A change to article access can affect search results, dashboards, exports, images, history and external-tool responses.

## 2. The overall architecture

This is a **pnpm monorepo**: one repository containing several related JavaScript/TypeScript packages. A workspace package such as `@workspace/db` refers to code in this repository, not a separately downloaded public package.

```text
Browser: HTML + React UI
        |
        | HTTP requests; JSON responses; session cookie
        v
Express API ----------------------------------> PostgreSQL
        |                                        |
        |                                        +-- content and relationships
        |                                        +-- accounts and sessions
        |                                        +-- stored image data/settings
        |
        +--> SMTP server for opted-in notifications
        +--> SAML/OIDC identity provider during sign-in
        +--> local Chromium for article PDF export

Mobile client ---------- HTTP ----------> same API
External MCP client ---> MCP service ---> same API
```

### Repository map

| Location | Responsibility | Python comparison |
|---|---|---|
| `artifacts/knowledge-base/` | React browser application | A separate browser UI, rather than Jinja templates rendered by Flask |
| `artifacts/api-server/` | Express HTTP routes and application logic | Flask/FastAPI service |
| `lib/db/` | PostgreSQL connection, Drizzle schema and SQL migrations | SQLAlchemy models and migration files |
| `lib/api-spec/` | OpenAPI contract and client-generation configuration | OpenAPI schema used to generate clients |
| `lib/api-client-react/` | Generated client functions/hooks and shared HTTP handling | A typed API client library |
| `lib/api-zod/` | Generated runtime request/response schemas | Pydantic-style validation definitions |
| `artifacts/memex-mobile/` | Expo/React Native client and offline support | Another client of the API, not another backend |
| `artifacts/mcp-server/` | MCP protocol adapter | A service translating an external protocol into API calls |
| `artifacts/mockup-sandbox/` | Design/component-preview tooling | Development tooling, not the main production UI |
| `tests/e2e/` | Browser-level regression tests | End-to-end tests using a real browser |
| `.github/workflows/` | Container publishing and Android build automation | CI/build automation |
| `Dockerfile`, `docker-compose*.yml` | Self-hosting build and runtime topology | Container packaging and service configuration |

**Development and production differ.** Development uses separate managed services for the browser UI and API. For container production, the React app is compiled into static files and served by Express when `STATIC_DIR` is set. The MCP service is a separate process/container, even when it uses the same built image.

## 3. TypeScript concepts needed to read the code

### JavaScript is the runtime; TypeScript adds checks before execution

Node.js plays a role similar to the Python interpreter for backend programs. Browsers execute JavaScript on the frontend. TypeScript adds type annotations and compiler checks, then is converted to JavaScript.

```ts
type Role = "admin" | "editor" | "user";

async function loadUser(id: number): Promise<User | null> {
  // A real implementation would look up the supplied id.
  return null;
}
```

Read this as: “`loadUser` accepts a number and asynchronously produces either a User or null.” `Promise<T>` is broadly comparable to an awaitable result. `await`, `try` and `catch` have familiar counterparts in asynchronous Python.

Important reading rules:

- `const` prevents reassignment of a variable; it does not make the contained object immutable.
- `interface` and `type` describe shapes of values. They do not automatically validate an incoming JSON request.
- `x?: string` means the field may be absent. `string | null` means null is an explicitly permitted value. JavaScript also has `undefined`.
- `value?.name` safely accesses a property when the value may be absent; `value ?? fallback` supplies a fallback for null/undefined.
- `array.map(...)` and `array.filter(...)` transform/select items, much like comprehensions.
- `export` and `import` expose and consume module members. `@workspace/...` is a workspace package; `@/...` in the web app is a configured local source alias.
- `as SomeType` is a compiler assertion, not a conversion or a security check. A request body cast to a type is still untrusted input.
- `any` bypasses useful type checking. Review code using it especially carefully near imports, restores, JSON fields and permission decisions.

### `.tsx` files combine UI logic with HTML-like syntax

React components are functions returning a description of the UI:

```tsx
function Greeting({ name }: { name: string }) {
  return <h1 className="text-xl">Hello, {name}</h1>;
}
```

This is **JSX**, not a literal HTML document. `className` becomes an HTML class; braces evaluate JavaScript expressions. Ordinary text values are escaped by React. Rendering stored HTML through a raw-HTML API is different and needs sanitization.

React hooks manage state and side effects:

- `useState`: component-local state, such as an open dialog.
- `useEffect`: synchronization with something outside rendering.
- Context/providers: shared identity, theme or application settings.
- React Query hooks: server data, loading/error states and cache invalidation.

Treat the React Query cache as a browser-side copy, not the source of truth. A successful database update may need cache invalidation before the screen reflects it. Caches must not carry private data between signed-in users.

### Build-time types and runtime validation are separate defenses

TypeScript can catch a developer passing a string where a number is expected. It cannot stop an HTTP client sending malicious JSON. Zod validation, authorization checks and database constraints must handle actual runtime data.

Drizzle is the ORM/query builder. Calls such as `db.select().from(usersTable)` are analogous to SQLAlchemy queries. Its SQL template syntax binds ordinary interpolated values as parameters; reviewers should still inspect raw SQL and any dynamically constructed identifiers or fragments.

## 4. Follow one request from screen to database

A typical article read works like this:

1. The browser loads the React application and its route selects the article page.
2. A client hook or direct fetch requests an API URL.
3. Express middleware applies headers, request limits, origin checks and session/token handling.
4. The route authenticates the caller and looks up the requested record.
5. Authorization checks decide whether this particular caller may read it.
6. Drizzle executes SQL through a PostgreSQL connection pool.
7. The API returns JSON; React renders it and manages loading/error states.

An article update adds several responsibilities: validate input, check **write** access, sanitize HTML, persist content, update relationships and maintain history. A hidden Edit button is only a convenience. The API must independently reject unauthorized edits.

The contract flow is:

```text
lib/api-spec/openapi.yaml
        |
        | Orval code generation
        v
React API client/types + Zod schemas
        |
        v
frontend and backend consumers
```

Change the contract and regenerate its outputs together. Not every route is necessarily implemented through generated validation, and a matching TypeScript type does not prove contract completeness.

## 5. Backend organization and middleware

Start with `artifacts/api-server/src/index.ts`, `app.ts` and `routes/index.ts`.

- `index.ts` validates the port, optionally applies SQL migrations, starts HTTP listening and the notification worker, and optionally seeds initial data.
- `app.ts` assembles Express middleware and mounts routers.
- `routes/` contains feature-specific HTTP handlers.
- `lib/` contains reusable helpers for authentication, HTML, versioning, notifications, diagrams, exports and maintenance.

The main request order is significant: security headers and logging; public sandboxed diagram assets; CORS; ingress rate limiting; CSRF checks; body parsing; PostgreSQL-backed sessions; OAuth endpoints; bearer-token enforcement; general API limits; feature routes. Static frontend serving is added for production when configured.

Changing middleware order can change security. For example, rejecting oversized/abusive requests before database-backed authentication reduces unnecessary work. An endpoint mounted before a general protection needs its own appropriate checks.

Routes often contain both HTTP handling and business/database logic, rather than a strict controller/service/repository layering. This makes individual flows easy to locate, but large route modules and shared authorization logic require careful review.

## 6. Data model and persistence

The schema lives in `lib/db/src/schema/`; the database connection is in `lib/db/src/index.ts`.

| Data family | Main relationships and review concerns |
|---|---|
| Users, groups, memberships | Roles, local/SSO login mode, identity links and group-based access |
| Articles | HTML content, kind, owner, visibility and optional project association |
| Article groups, tags and links | Many-to-many sharing/classification and internal links/backlinks |
| Article versions | Historical content and independent save checkpoints |
| Article images | Uploaded content associated with articles/uploaders |
| Projects, boards and cards | Project access, managers, ordering, assignments and due dates |
| Personal task lists and favorites | Per-user ownership; not global shared preferences |
| Settings and notifications | Branding/configuration, SMTP credentials, preferences and delivery state |
| API tokens, OAuth and mobile SSO | Hashed credentials, grants and temporary sign-in state |

An article's `kind` distinguishes knowledge, policy and procedure content. Logs and project documents share the article infrastructure but have additional access/URL rules.

**Important storage distinction:** the main Memex app currently stores article-image data in PostgreSQL as text. It is not the same storage design as the exported starter's branding adapter. Do not assume uploads live in an external object bucket. Inspect the image and settings routes when deciding backup coverage, database sizing and storage migration plans.

Foreign keys, unique indexes and transactions provide database-level protection. They complement but do not replace application authorization. Schema types alone do not necessarily enforce every permitted string value in SQL.

## 7. Main functional workflows

### Articles, editing and history

The browser uses Tiptap/ProseMirror for rich editing. It handles structured editor nodes such as tables, citations and diagram images; saved content is primarily HTML, with additional structured fields for procedures.

The server sanitizes content, stores article relationships and manages version history. Autosave persistence and visible history density are separate concerns: nearby autosaves can be coalesced into a history checkpoint while deliberate saves/restores preserve independent checkpoints. Review concurrent saves and restoration as data-integrity operations, not just UI behavior.

Titles and URLs are deliberately separate: changing a title should not casually change existing links. Private log URLs are owner-scoped. Internal-link handling, exports and redirects need to retain the same access rules as the article reader.

### Visibility and permissions

For ordinary articles, the current central policy checks administrator access, ownership, visibility and group membership. The `public` visibility label means available to the app's authenticated audience under these helpers; it is **not automatically an anonymous Internet publication mode**.

Personal logs are owner/admin resources. Project documents use project access rules instead of the normal article-sharing rule. Reading and editing are different decisions; project managers, creators, editors and group members do not all have identical powers.

Key review locations: `routes/articles.ts` (`canAccessArticleRecord` and related helpers) and `routes/projects.ts` (`checkProjectAccess` and document-edit rules).

Apply the same policy to list queries, counts, pagination, search, favorites, history, image serving, PDFs, ZIP files and MCP responses. Otherwise a protected reader can coexist with a leaking secondary endpoint.

### Policies, procedures and projects

Policies add category organization. Procedures add ordered steps and can be run into independent projects. Projects organize boards/cards, memberships, managers and documents. Review procedure-run creation as a multi-record operation; later source-procedure changes should not accidentally rewrite an independent project.

### Images, diagrams, citations and exports

Image access involves both attachment/reference checks and article authorization. Unattached uploads need ownership rules. Cleanup must consider current content, history and diagram references before deleting stored media.

The Draw.io-based editor is served locally with its own sandbox/header handling. Diagram previews retain editable source information. A safe preview, sanitizer or export must not inadvertently discard the source needed for future editing.

Citations are stored metadata and links, not an automatic web-research service.

PDF export uses local Chromium through Playwright Core to render authorized content. Its rendering helpers restrict scripts/network behavior and embed permitted media. ZIP/Markdown and full-environment backups are distinct export mechanisms and need separate review.

### Notifications

SMTP settings are administered centrally; users opt in to supported events/reminders. A worker started in the API process checks pending work periodically, with persisted delivery/retry/deduplication state.

SMTP passwords are encrypted with a key derived from `SESSION_SECRET`. Rotation therefore affects more than session cookies: existing SMTP configuration may need re-entry. Review duplicate delivery, worker concurrency and restore behavior before running multiple API instances.

### Mobile and external tools

The Expo/React Native client calls the same API but has additional cookie handling, secure credential storage, offline files/cache and browser-to-native SSO handoff. Native session data uses Expo SecureStore; its web fallback uses browser storage. Offline access has a bounded cached-session period, but server-side revocation cannot instantly erase an already disconnected device's copies.

The MCP server translates tool requests into Memex API requests. API keys and OAuth grants are separate credential paths from browser sessions. OAuth access is restricted to its allowed read surface. Review per-request identity isolation, upstream URLs, token scopes/expiry/revocation and TLS at the MCP boundary.

## 8. Dependencies and why they exist

This is a selected dependency map, not a complete license or vulnerability inventory. Exact installed versions come from `pnpm-lock.yaml`; declared ranges and shared catalog values come from package manifests and `pnpm-workspace.yaml`.

| Group | Main dependencies | Purpose |
|---|---|---|
| Runtime and language | Node.js, TypeScript, `tsx` | Execute backend JavaScript; check/execute TypeScript during development/tests |
| Web application | React 19, Vite, Wouter | Components, browser build/dev server and client-side navigation |
| UI and forms | Tailwind CSS, Radix UI, React Hook Form, Lucide | Styling, UI primitives, form state/validation integration and icons |
| Server state | TanStack React Query | API hooks, caching, loading/error state and mutations |
| Rich content | Tiptap/ProseMirror, DOMPurify, `sanitize-html`, `diff` | Editing, browser/server sanitization and comparison |
| API | Express 5, Helmet, CORS, `express-rate-limit`, Pino | Routing, headers, origin controls, throttling and logging |
| Database | PostgreSQL, `pg`, Drizzle ORM/Kit | SQL storage, connection pooling, typed queries and schema tooling |
| Contracts | OpenAPI, Orval, Zod | API definition, generation and runtime validation |
| Authentication | `bcryptjs`, `express-session`, `connect-pg-simple` | Password hashing and database-backed sessions |
| Identity providers | `@node-saml/node-saml`, `openid-client` | SAML and OIDC protocol handling |
| Files and exports | Multer, Archiver, Unzipper, Marked, Turndown, PDFKit, Playwright Core | Uploads, archives, Markdown conversion and PDF-related functionality |
| Email | Nodemailer | SMTP delivery |
| Diagrams | Vendored editor assets and supporting XML/PNG code | Self-hosted diagram editing and source-preserving previews |
| Native application | Expo 54, React Native, Expo Router/SecureStore/FileSystem | Mobile UI, navigation, credentials and offline data |
| MCP | Model Context Protocol SDK | External-tool protocol server |

Some frontend build dependencies are listed under `devDependencies` even though their output is part of the shipped browser application. Production build environments still need these dependencies; installing only runtime packages before compiling is insufficient.

pnpm includes a one-day minimum release-age policy, an allowlist of build scripts and dependency overrides. These are useful supply-chain controls, not substitutes for advisories, license review or vulnerability scanning. The Docker runtime also installs some externalized packages through npm separately from the pnpm build; review those versions and resolution paths rather than assuming the root lockfile controls the entire image.

## 9. Authentication and credential handling

### Local sign-in

Passwords are hashed with bcrypt; sign-in compares the supplied password with the stored hash. Successful login regenerates and saves the session. The browser receives a signed session identifier; session data is persisted in PostgreSQL, not all placed in the cookie.

Cookies are HTTP-only, have a seven-day configured maximum age, and support Secure/SameSite settings. HTTP-only prevents ordinary script reads of the cookie; it does not stop every consequence of XSS.

Production refuses a missing `SESSION_SECRET`, but accepting a present value does not establish that it is strong. Development has an insecure fallback. Compose examples contain placeholder credentials and must not be used unchanged.

Initial setup/seeding establishes a highly privileged account. Complete initialization under controlled access before exposing an uninitialized installation publicly, and remove one-time seed credentials afterward.

`SSO Only` is an explicit account mode: it should prevent local-password and local-recovery bypasses. Recovery uses hashed, expiring, single-use tokens and is a privileged access-recovery operation.

### Sessions versus current permissions

`requireAuth` and `requireRole` in `src/lib/auth.ts` can use identity/role stored in the session. Bearer authentication instead resolves the token and associated account from the database.

**Review priority:** trace what happens to an already-issued browser session after a role change, account deletion, password reset or SSO-only change. A client refresh or `/auth/me` recheck is not equivalent to every protected API call rereading the account. Verify required revocation timing with direct requests using an old session.

### SSO

Real SSO handlers live in `routes/sso-auth.ts` and `routes/mobile-sso.ts` within the API server; similarly named no-op foundation hooks in `artifacts/api-server/src/lib/auth.ts` are not evidence that SSO is unimplemented.

SAML validation delegates to Node-SAML using configured certificate/issuer/callback values. Some request-correlation options are explicitly conditional on a mobile pending request. OIDC uses the configured provider and pending state/nonce flow.

**Review priority:** inspect browser and native flows separately for signature/audience/time checks, request correlation/replay protection, state/nonce/PKCE, email trust and account linking. Explicit configuration, library defaults and guarantees differ between flows. Do not transfer the extracted starter's test results or stricter settings to this application.

### API keys and OAuth

API keys are looked up by SHA-256 hashes and can expire. Read-only keys are blocked from mutating HTTP methods by global enforcement. That alone cannot make an incorrectly implemented state-changing GET safe; inspect endpoint semantics.

OAuth is an authorization protocol for external clients, not another name for local login. Its routes are mounted separately and must validate their own clients, grants, consent and form anti-forgery state.

## 10. Other security controls and their limits

| Control visible in source | What it helps with | What review must still establish |
|---|---|---|
| Zod schemas and route checks | Reject malformed data | All relevant paths use them, including imports/partial edits |
| ORM parameters and SQL constraints | Injection resistance and data integrity | Raw/dynamic SQL, ownership checks and transaction coverage |
| Server HTML sanitizer and browser DOMPurify | Reduce stored-XSS risk | Reader/history/diff/template/import/export coverage and custom editor attributes |
| Helmet headers | Browser hardening | Current CSP allows inline/eval scripts and HTTPS images; it is deliberately permissive |
| CORS allowlist | Limits cooperating browsers' cross-origin API access | CORS is not authentication and does not restrict non-browser clients |
| CSRF origin/referrer checks | Reject forged browser writes | Native-header exceptions, OAuth exceptions and exact SAML callbacks remain safe |
| Rate limits and body limits | Bound abusive requests | Expensive authenticated exports/restores, memory use and multi-instance limiting |
| API authorization | Restrict protected records | All derived surfaces enforce the same policy |
| Pino request logging | Operational visibility | Other logs never include assertions, tokens, secrets or private content |

The CSRF helper permits some origin-less native/bearer requests. The native header is a compatibility signal, **not proof of user identity**. Authentication is still required. Trusted-proxy settings affect how host/protocol/IP information is interpreted; validate them against the actual proxy chain.

Swagger UI is disabled in production. The development `/api/dev/autologin` route can create an administrator session without a password outside production. Ensuring `NODE_ENV=production` and absence of development shortcuts at the public boundary is a release-critical check.

Full-environment backups use passphrase-based key derivation and authenticated AES-GCM encryption. Restore is admin-only and can transactionally replace large portions of the database. Encrypted archives remain sensitive; protect passphrases, validate the restore confirmation/account policy, retain an independent backup and test restores only in isolation. Encryption does not make an unsafe restore safe.

## 11. General design decisions and tradeoffs

- **One shared backend:** browser/mobile/tools can reuse business rules, but every new client expands the authentication and data-exposure review surface.
- **Shared article infrastructure:** reduces duplicated content logic, but ordinary articles, logs and project documents require explicitly different access rules.
- **Rich HTML content:** supports expressive documents and portable exports, but makes sanitization and source-preserving transformations critical.
- **Database-backed sessions and stored assets:** simplifies persistence/backup consistency, but increases database load, size and sensitivity.
- **Generated contracts:** reduce frontend/backend drift, but do not remove runtime validation or regeneration discipline.
- **Monorepo:** coordinates cross-package changes, at the cost of workspace/build complexity.
- **Self-hosted diagrams/PDF rendering:** avoids normal editing/export dependence on an external diagram service, but introduces vendored assets, browser binaries and patching duties.
- **Responsive web plus native app:** provides mobile-specific behavior/offline access, but requires separate cache, storage, link and SSO testing.
- **Background worker inside the API:** simple to operate for a small deployment, but needs deliberate scaling and duplicate-delivery analysis.

## 12. Building, migrations and operation

Useful repository commands:

```sh
# Regenerate shared API contracts and check shared-library types
pnpm --filter @workspace/api-spec run codegen

# Typecheck the workspace
pnpm run typecheck

# Build workspace packages
pnpm run build

# API tests: inspect fixture/environment requirements before running
pnpm --filter @workspace/api-server test

# Selected browser regressions
pnpm test:project-documents
pnpm test:api-token-access
pnpm test:image-captions
```

These commands are a review reference, **not a record of checks run for this document**. Do not point integration tests at a valuable database. Some tests need their own fixtures, credentials, processes or isolated database.

Production container builds compile the API, MCP service and web UI, then copy runtime assets, migrations and Chromium into the runtime image. Compose has separate options for bundled PostgreSQL and an externally managed database; the external configuration is standalone.

At API startup, migrations run **only if `MIGRATIONS_DIR` is configured**, before the server binds. Development does not take this same path. Drizzle's migration journal controls which SQL files run; a SQL file existing on disk is not enough.

Treat the SQL schema, migration files and migration journal as a coordinated change. Prove both empty-database installation and upgrades from a realistic previous version. Some older prose in `replit.md` describes a separate push-based migration service; current executable startup/Compose files are the stronger evidence.

Important runtime settings include `DATABASE_URL`, `SESSION_SECRET`, `APP_BASE_URL`, `PORT`, `STATIC_DIR`, `MIGRATIONS_DIR`, `TRUST_PROXY`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `CORS_ORIGIN`, and optional seed settings. Do not put actual values in this document, source control, screenshots or review comments.

The default container image runs the API; MCP needs its separate process/service. Its upstream HTTP port must be restricted behind TLS termination/firewalling. Review container user privileges, resource limits, image immutability, database TLS and health/readiness behavior as deployment concerns, not assumed code guarantees.

## 13. Recommended review order

1. Read this overview, then root `package.json` and `pnpm-workspace.yaml`.
2. Read the API entry points and middleware order.
3. Trace local login and session permission handling.
4. Trace an article read/write and its image/history/export paths.
5. Review project/log exceptions and list/count/search authorization.
6. Review SSO, API keys, OAuth, mobile handoff and MCP identity isolation.
7. Review file parsing, imports, backups, restores and media deletion.
8. Review notification secrets, background work and failure handling.
9. Compare OpenAPI definitions, generated code and database migrations.
10. Review tests, then the actual image/runtime/deployment configuration.

## 14. Pre-production evidence checklist

### Access and identity

- [ ] Anonymous/user/editor/admin tests exercise APIs directly, not just hidden UI controls.
- [ ] Ordinary article, personal log and project-document policies work across lists, counts, links, images, history and exports.
- [ ] Old sessions cannot retain unacceptable access after account/role/login-mode changes.
- [ ] SSO browser/native flows reject mismatched issuer/audience/state/nonce/request IDs and replays as appropriate.
- [ ] Email-based account linking is trustworthy for each IdP.
- [ ] API keys and OAuth credentials respect permissions, expiry, read-only scopes and revocation.
- [ ] Development autologin/docs/seed behavior cannot be exposed in production.
- [ ] Recovery/last-admin/last-provider behavior matches the organization's recovery policy.

### Content and data safety

- [ ] Stored-XSS payloads are checked in reader, history, diff, templates and import/export paths.
- [ ] Untrusted URLs, XML, images, archives and diagrams cannot cause unintended network/file access or resource exhaustion.
- [ ] Upload limits and media ownership/reference checks survive save/restore/delete operations.
- [ ] Autosave, concurrent edits and history restore preserve the required data.
- [ ] Backup restoration is proven against an isolated environment; existing data is never the test fixture.
- [ ] Offline cached data retention and device-loss risks are accepted.

### Build and operations

- [ ] Frozen dependency installation, contract regeneration, typechecking and production builds succeed from a clean checkout.
- [ ] Relevant tests are actually executed, with recorded commands/results and no silently skipped critical cases.
- [ ] Dependency, container, vendored-asset and license scans are current.
- [ ] Runtime packages installed outside the root lockfile are reviewed/pinned appropriately.
- [ ] Fresh install and realistic database upgrade both succeed; migration journal entries are complete.
- [ ] Strong secrets replace all example defaults; HTTPS/proxy/cookie/origin settings match the real deployment.
- [ ] Image tags/digests and production configuration identify exactly what was reviewed.
- [ ] Database backups, restore access, SMTP secret rotation, monitoring, resource limits and rollback steps have owners.
- [ ] Browser/native/MCP checks cover the clients that will actually be released.

## 15. How to interpret this guide

This is an architectural explanation and review map. “A control exists” is not the same as “the control covers every path,” and source-level tests are not evidence that the production configuration is correct.

Record review findings with a file/function, a concrete request or reproduction, expected versus observed behavior, impact and a verification step. Before release, attach actual build/test/scan/migration evidence and resolve or explicitly accept the remaining risks.
