---
name: Infobox textarea sizing
description: Preventing collapsed multiline infobox inputs in ProseMirror node views.
---

Infobox cell textareas must retain a nonzero one-line height even when the
auto-grow measurement runs during the node view's initial mount.

**Why:** At that point the browser can report a zero textarea scroll height.
Persisting that value collapses the interactive control, so a click falls
through to the editor instead of focusing the cell.

**How to apply:** Keep a one-line minimum height in the auto-grow calculation
and cell styling. Preserve mouse-down event isolation on cell controls so
ProseMirror does not reclaim their focus.