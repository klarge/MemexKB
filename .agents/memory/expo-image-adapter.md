---
name: Expo hardened image adapter compatibility
description: Why the security-safe image parser must retain both filename and cross-realm byte compatibility.
---

Keep the hardened image parser rather than restoring the vulnerable upstream implementation. Its compatibility boundary must accept both local filenames and cross-realm byte arrays.

**Why:** Metro worker inputs can come from another JavaScript realm, making `instanceof Uint8Array` reject valid bytes. Expo's image tools also use the historical filename overload. A browser/TypeScript check can pass while native Hermes export fails on bundled PNG assets.

**How to apply:** When changing the image adapter or its override, run its compatibility checks and a native Android export. Preserve local-file-only access and byte-size limits; do not remove security overrides to make bundling pass.
