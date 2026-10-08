---
name: Tiptap list attribute collisions
description: Avoid duplicate HTML attributes when extending the WYSIWYG list schema.
---

Use the editor's native ordered-list type attribute rather than adding a second schema attribute that also renders HTML `type`.

**Why:** The installed Tiptap version already supports ordered-list types. A second attribute rendered to the same HTML key was overwritten by the native null value: the toolbar appeared to accept changes, but saved HTML lost them.

**How to apply:** Inspect installed extension attributes before adding global attributes. For depth-based automatic numbering, leave the native type unset and apply shared editor/display CSS; explicit toolbar choices set the native type on the nearest list only.

The upstream ordered-list renderer omits `type="1"` even when explicitly chosen. Preserve it when automatic nested lists use letters, or save/reopen silently resets Numbers to Automatic. HTML `type` attribute selectors are case-insensitive by default: use a mirrored data attribute to distinguish uppercase types across browsers.
