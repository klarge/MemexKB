---
name: Drizzle migration journal
description: How Docker startup discovers and applies database migrations in this project.
---

Every new migration SQL file must also have a matching ordered entry in
`migrations/meta/_journal.json`; Drizzle's runtime migrator reads the journal,
not the directory listing.

**Why:** An unregistered migration is copied into the Docker image but silently
skipped at startup, leaving application code to query columns that older
databases do not have.

**How to apply:** When adding a migration manually, give it the next journal
index and matching tag before building the Docker image. Treat databases created
with schema push rather than the migration runner as a separate baseline/history
issue; do not attempt to replay all baseline migrations against them.