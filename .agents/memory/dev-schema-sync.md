---
name: Development schema synchronization
description: Why the local API workflow can run newer schema code before its database has new columns or tables.
---

The API development workflow does not set `MIGRATIONS_DIR`, so its startup migration runner is intentionally skipped. New schema code can therefore fail locally until the development database is brought in line with the checked-in schema/migrations.

**Why:** Production uses the ordered Drizzle migration journal during image startup, while development schema synchronization follows the workspace database flow. Database drift can otherwise appear as runtime query failures immediately after a server restart.

**How to apply:** After adding a migration, confirm the development database has the corresponding schema before browser-testing code that reads it. Keep the migration SQL and journal entry correct for production; do not assume a workflow restart applies migrations in development.