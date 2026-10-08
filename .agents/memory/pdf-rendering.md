---
name: PDF reader fidelity
description: Why article PDF exports use browser layout and how responsive CSS behaves on paper.
---

Article PDFs should look like the HTML reader, not a plain-text or Markdown
conversion. Preserve this requirement when extending content types or exports.

**Why:** The user explicitly required exported PDFs to render and look like the
HTML page after manual drawing left article text in a narrow right-hand column.

**How to apply:** Use reader HTML/styles as the source of truth and visually
inspect a multi-page PDF containing infoboxes, lists, tables, and images.

Chromium evaluates width media queries against printable page width, even when
screen media and a desktop viewport are selected. The reader's mobile flex
layout can therefore activate on A4 and create large blank pages or reorder
infoboxes. A screenshot of the HTML alone does not prove PDF pagination works.

**Why:** Screen emulation still activated the narrow-screen layout inside the
generated PDF; rasterized pages exposed unexpected fragmentation.

**How to apply:** Keep print-specific desktop-flow overrides scoped to the export
document, and inspect actual PDF page images after changing responsive styles.
Variable-font PDFs can use distinct Type3 font resources without bold/italic
metadata flags; verify rendered styles, not only font-name/flag assumptions.
