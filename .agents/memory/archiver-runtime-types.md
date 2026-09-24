---
name: Archiver runtime types
description: Why ZIP export should not switch to the callable archiver API described by installed declarations.
---

The installed Archiver runtime exports a ZIP constructor as a class, while the available TypeScript declarations model the older callable API and omit that class.

**Why:** Changing export code to call the library's default export solely to satisfy TypeScript would compile but fail at runtime: the module is an object, not a callable function.

**How to apply:** When maintaining archive export, verify the runtime shape rather than relying on the older declarations. Keep the constructor typed locally unless the runtime package and its declarations are deliberately brought into alignment.