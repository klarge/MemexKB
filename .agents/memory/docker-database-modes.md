---
name: Docker database modes
description: Why local and external PostgreSQL Docker Compose deployments use separate files.
---

Keep external-database Compose independent rather than layering it over the local-Postgres Compose file.

**Why:** The default app has a health-gated dependency on its local database. Merging an override onto it can retain or accidentally start that database; a standalone external configuration leaves the longstanding local default intact without fragile dependency-reset syntax.

**How to apply:** When changing Docker app runtime settings, consider both deployment modes. Run the external file by itself, never alongside the local file.