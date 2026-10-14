---
name: Native reader link normalization
description: Rendered offline anchors can behave differently from direct link-parser unit tests.
---

Verify internal links through the real native reader renderer, not just the link-parser helper. Trusted relative anchors need the configured server as their document base, including any self-hosted mount path.

**Why:** A browser check of the native components classified a relative policy-to-procedure link as external even though the direct parser tests passed. The renderer normalizes URLs before invoking the application's link callback; its document context can differ from the saved server.

**How to apply:** Resolve supported document anchors against the trusted server before rendering and supply an explicit document base to both normal content and table-cell renderers. Keep source/heading fragment behavior intact. A web-renderer check does not prove Android device behavior.
