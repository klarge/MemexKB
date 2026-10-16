---
name: Infobox textarea sizing
description: Native textarea sizing, selection, and caret behavior inside ProseMirror infobox node views.
---

Infobox cell textareas must retain a nonzero one-line height even when the
auto-grow measurement runs during the node view's initial mount.

**Why:** At that point the browser can report a zero textarea scroll height.
Persisting that value collapses the interactive control, so a click falls
through to the editor instead of focusing the cell.

**How to apply:** Keep a one-line minimum height in the auto-grow calculation
and cell styling. Preserve mouse-down event isolation on cell controls so
ProseMirror does not reclaim their focus.

Native input behavior must be verified inside the real editor, not only in a
standalone React input.

**Why:** In the React node-view renderer, an attribute-backed controlled input
kept the same DOM element and remained focused but still jumped to the end after
the first character typed in the middle. React's immediate controlled-value
restoration and the editor's separate node-view update were out of step. The
browser also inherited blanket `user-select: none` styling into the fields.

**How to apply:** Give native field edits an immediate React state update while
still synchronizing external editor changes, including undo/redo. Preserve native
text selection. Browser checks should cover mouse-drag highlighting, replacement,
and multiple mid-string keystrokes, not just focusing or filling the whole field.