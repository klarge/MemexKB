---
name: SSO-only login policy
description: Login-method choices and recovery boundaries for accounts using SSO.
---

SSO Only restricts the login method, not the user's role, group permissions, existing sessions, or authorized API-key access. Linking an existing account to SSO must not change its administrator-selected login mode.

**Why:** Local accounts may also be linked to SSO. Inferring exclusive SSO access from that linkage would silently remove legitimate password sign-in.

**How to apply:** Default newly provisioned SSO accounts to exclusive SSO access, leave existing choices unchanged, and require a fresh password when an administrator deliberately enables local login again.

Full-environment restore must preserve SSO-only restrictions and must not generate password recovery links for these accounts. Backups exclude SSO secrets, so an environment containing only SSO-only administrators cannot safely use the application's ordinary restore path until an infrastructure-authorized provider recovery path exists. An empty-user backup can still use initial administrator setup.

**Why:** Generating password recovery links would downgrade the restriction; disabling all restored providers without a recoverable administrator would lock out the environment.

**How to apply:** Keep application-level restores of populated backups without a password-enabled administrator blocked. Do not bypass this by changing a restored user's login mode or exporting SSO secrets.

Do not hold a database transaction open while waiting for session-store regeneration or saving when both share the same connection pool.

**Why:** Concurrent logins can occupy every pool connection with transactions waiting for a session write that itself needs a free connection. A single-user browser pass will not reveal this deadlock.

**How to apply:** Revalidate login eligibility around session persistence without retaining a transaction connection, and exercise shared-pool session I/O with a one-connection test pool.