---
name: Board drag gestures
description: Why board click suppression and touch activation must be coordinated.
---

Keep click suppression at board scope, and clear it on the next deliberate interaction rather than on a timer.

**Why:** Moving a sortable card between columns remounts its component. A card-local flag can disappear before the drag's trailing click, and a touch compatibility click can arrive after a timeout has expired.

**How to apply:** Any future changes to card drag or detail-opening behavior must retain suppression across remounts, completion, and cancellation, without swallowing the next intentional click.

Pointer and touch drag activation must be disjoint.

**Why:** Pointer events also include touch. A distance-based pointer sensor can capture the touch before the delayed touch sensor does, defeating the hold gesture and native scrolling.

**How to apply:** Preserve the six-pixel pointer threshold for mouse/pen, reserve touch for delayed activation, and avoid disabling touch scrolling across the full card surface.

Protect filtered dragging with a full reorder-payload assertion and a mutation check, not only card counts after reload.

**Why:** An omitted card can still appear after reload because the server leaves it in place. Presence alone therefore gives false confidence that the frontend retained hidden-card reorder state.

**How to apply:** Keep checks for complete payload membership, hidden-card relative order and persisted positions together. Demonstrate that replacing full reorder state with filtered IDs fails the intended assertion.