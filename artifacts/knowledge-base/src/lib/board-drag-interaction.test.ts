import assert from "node:assert/strict";
import test from "node:test";
import { BoardPointerSensor, BoardTouchSensor, CardDragClickGuard, isInteractiveCardTarget } from "./board-drag-interaction";

test("a click with no activated drag stays eligible to open details", () => {
  const guard = new CardDragClickGuard();
  guard.beginInteraction();
  assert.equal(guard.canOpen(), true);
  // Movement below the sensor threshold does not call beginDrag.
  assert.equal(guard.canOpen(), true);
});

test("drag completion and cancellation suppress trailing clicks until a new interaction", () => {
  for (const _outcome of ["completed", "cancelled"]) {
    const guard = new CardDragClickGuard();
    guard.beginInteraction();
    guard.beginDrag();
    assert.equal(guard.canOpen(), false);
    assert.equal(guard.canOpen(true), false);
    // A card can remount into a new column without replacing this board guard.
    guard.beginInteraction();
    assert.equal(guard.canOpen(), false);
    guard.finishDrag();
    assert.equal(guard.canOpen(), false);
    assert.equal(guard.canOpen(), false, "a delayed compatibility click must still be suppressed");
    assert.equal(guard.canOpen(true), true, "intentional keyboard opening works after a drag");
    guard.beginInteraction();
    assert.equal(guard.canOpen(), true, "the next deliberate pointer/touch click is not swallowed");
  }
});

test("pointer and touch activation do not compete, and interactive descendants are excluded", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Element");
  class FakeElement {
    constructor(public control: FakeElement | null = null, public inside = true) {}
    closest() { return this.control; }
    contains(other: FakeElement) { return other.inside; }
  }
  Object.defineProperty(globalThis, "Element", { value: FakeElement, configurable: true });
  try {
    const card = new FakeElement();
    card.control = card;
    const title = new FakeElement(card);
    const control = new FakeElement();
    control.control = control;
    assert.equal(isInteractiveCardTarget(title as any, card as any), false);
    assert.equal(isInteractiveCardTarget(control as any, card as any), true);
    let pointerActivations = 0;
    let touchActivations = 0;
    const pointer = BoardPointerSensor.activators[0].handler;
    const touch = BoardTouchSensor.activators[0].handler;
    const event = (target: FakeElement, pointerType = "mouse") => ({
      target, currentTarget: card,
      nativeEvent: { target, pointerType, isPrimary: true, button: 0, touches: [{ identifier: 1 }] },
    }) as any;
    assert.equal(pointer(event(title, "mouse"), { onActivation: () => pointerActivations++ }), true);
    assert.equal(pointer(event(title, "pen"), { onActivation: () => pointerActivations++ }), true);
    assert.equal(pointer(event(title, "touch"), { onActivation: () => pointerActivations++ }), false);
    assert.equal(touch(event(title, "touch"), { onActivation: () => touchActivations++ }), true);
    assert.equal(pointer(event(control), {}), false);
    assert.equal(touch(event(control, "touch"), {}), false);
    assert.equal(pointerActivations, 2);
    assert.equal(touchActivations, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, "Element", original);
    else Reflect.deleteProperty(globalThis, "Element");
  }
});