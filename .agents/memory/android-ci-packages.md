---
name: Android CI package compatibility
description: Avoid stale SDK setup defaults when maintaining the Android build workflow.
---

Keep Android SDK package requests explicit rather than relying on setup-action defaults.

**Why:** The upstream Android setup action defaulted to installing the obsolete `tools` package, which the SDK repository could no longer provide. This stopped CI before the actual APK build; changing the app's target SDK would not address that bootstrap failure.

**How to apply:** When updating the SDK setup action, verify its default packages against the current repository before removing explicit package inputs. Preserve the SDK versions needed by the app rather than downgrading them to work around an unrelated setup failure.
