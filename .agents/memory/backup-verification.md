---
name: Backup verification safety
description: Required isolation for proving backup and restore round trips.
---

Use isolated fixtures for destructive backup/restore verification. Do not restore over current development or production data just to test a backup.

**Why:** The user required proof that backups restore the complete Policies and Procedures feature without replacing their existing application data.

**How to apply:** Exercise the actual export and restore handlers against disposable, isolated storage, and verify rollback and access rules there. A successful archive download alone is not proof of recoverability.