---
name: Netinfo version in Expo 54
description: Which version of @react-native-community/netinfo to use with this Expo project and why.
---

**Rule:** Use `@react-native-community/netinfo@12.0.1` (not 11.4.1) with this project.

**Why:** Expo 54's `expo-doctor` reports that 11.4.1 is expected, but pnpm leaves a `_tmp_NNNN` directory during install that Metro's FallbackWatcher tries to watch, crashing with ENOENT before the bundler starts. Version 12.0.1 installs cleanly and Metro starts successfully; the only consequence is a non-fatal "expected version" warning in the console.

**How to apply:** If the netinfo version is ever updated or a fresh install is needed, stay on 12.x and accept the warning rather than downgrading to 11.4.1.
