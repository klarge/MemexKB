import { PointerSensor, TouchSensor, type PointerSensorOptions, type TouchSensorOptions } from "@dnd-kit/core";
import type { PointerEvent, TouchEvent } from "react";

export function isInteractiveCardTarget(target: EventTarget | null, activator: EventTarget | null): boolean {
  if (!(target instanceof Element) || !(activator instanceof Element)) return false;
  const control = target.closest(
    "button, a, input, textarea, select, label, [contenteditable]:not([contenteditable='false']), [role='button'], [role='link'], [data-no-drag]",
  );
  // The card itself has a button role for keyboard detail opening.
  return !!control && control !== activator && activator.contains(control);
}

// PointerSensor also receives touch pointer events. Let only TouchSensor handle
// those, so a swipe scrolls and a deliberate hold activates dragging.
export class BoardPointerSensor extends PointerSensor {
  static activators = [{
    eventName: "onPointerDown" as const,
    handler(event: PointerEvent, options: PointerSensorOptions) {
      if (event.nativeEvent.pointerType === "touch" || isInteractiveCardTarget(event.target, event.currentTarget)) return false;
      return PointerSensor.activators[0].handler(event, options);
    },
  }];
}

export class BoardTouchSensor extends TouchSensor {
  static activators = [{
    eventName: "onTouchStart" as const,
    handler(event: TouchEvent, options: TouchSensorOptions) {
      if (isInteractiveCardTarget(event.target, event.currentTarget)) return false;
      return TouchSensor.activators[0].handler(event, options);
    },
  }];
}

// Board-scoped rather than card-scoped: cross-column moves remount cards.
// A completed/cancelled drag stays blocked until a NEW intentional interaction,
// not a timer (which could expire before a touch compatibility click arrives).
export class CardDragClickGuard {
  private dragging = false;
  private suppressClick = false;

  beginDrag() { this.dragging = true; this.suppressClick = true; }
  finishDrag() { this.dragging = false; }
  beginInteraction() { if (!this.dragging) this.suppressClick = false; }
  canOpen(keyboard = false) { return !this.dragging && (keyboard || !this.suppressClick); }
}