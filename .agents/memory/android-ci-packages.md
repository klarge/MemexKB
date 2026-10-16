---
name: Android CI package compatibility
description: Avoid stale SDK setup defaults when maintaining the Android build workflow.
---

Keep Android SDK package requests explicit rather than relying on setup-action defaults.

**Why:** The upstream Android setup action defaulted to installing the obsolete `tools` package, which the SDK repository could no longer provide. This stopped CI before the actual APK build; changing the app's target SDK would not address that bootstrap failure.

**How to apply:** When updating the SDK setup action, verify its default packages against the current repository before removing explicit package inputs. Preserve the SDK versions needed by the app rather than downgrading them to work around an unrelated setup failure.

Validate production native config loading, not just Expo prebuild or TypeScript.
Prefer the config-plugin API re-exported by the app's declared Expo dependency
over directly importing Expo's transitive dependencies.

**Why:** A standalone Android build reached Gradle but failed when Expo Constants
evaluated the offline plugin under pnpm's isolated dependency layout. The earlier
prebuild had not caught the inaccessible direct transitive import.

**How to apply:** Keep a regression check exercising Expo Constants' actual
config-generation subprocess in production mode. Keep `NODE_ENV=production`
scoped to config/prebuild/release-build steps, not dependency installation: the
workspace's native build tools include development dependencies and must remain
installed for the release build.
