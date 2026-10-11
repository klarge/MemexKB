---
name: Personal task due dates
description: Product parity with card dates and consent for task reminder emails.
---

Personal task dates belong in the task Edit dialog and should behave like project-card dates, including Home's Upcoming Due Dates and reminder emails.

**Why:** The user explicitly requested parity with project-card due dates.

**How to apply:** Preserve calendar dates across time zones and include incomplete personal tasks independently of project availability or the active-task preview limit.

Task reminder emails are a separate opt-in category, sharing the existing due-soon reminder interval rather than silently adopting a user's card-reminder opt-in.

**Why:** Adding a new kind of notification must not automatically subscribe existing users to additional emails.

**How to apply:** Retain existing preferences during upgrades and when older clients omit a newly introduced preference.
