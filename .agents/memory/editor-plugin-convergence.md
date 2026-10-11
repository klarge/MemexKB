---
name: Editor plugin convergence
description: Citation normalization must coexist with automatic trailing-node behavior.
---

Keep automatic trailing paragraphs disabled after the terminal Sources block, while retaining them for other block types.

**Why:** Citation normalization moves Sources to the document end. An automatic trailing-paragraph plugin can then append a paragraph, causing normalization to move Sources again indefinitely and freeze the browser.

**How to apply:** When changing citation normalization or editor extensions, verify convergence using the actual shared StarterKit plugins, not only an isolated normalization plugin. Bound appended transactions in regression tests so a recurrence fails instead of hanging.
