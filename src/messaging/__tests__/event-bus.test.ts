import { describe, expect, it } from "vitest";
import { createEventBus } from "../event-bus";

describe("createEventBus", () => {
  it("delivers emitted events to subscribed listeners", () => {
    const bus = createEventBus();
    const received: number[] = [];

    bus.subscribe<number>("count", (value) => received.push(value));
    bus.emit("count", 1);
    bus.emit("count", 2);

    expect(received).toEqual([1, 2]);
  });

  it("stops delivering events after unsubscribe", () => {
    const bus = createEventBus();
    const received: number[] = [];

    const unsubscribe = bus.subscribe<number>("count", (value) =>
      received.push(value),
    );
    unsubscribe();
    bus.emit("count", 1);

    expect(received).toEqual([]);
  });

  it("does nothing when no listeners are subscribed", () => {
    const bus = createEventBus();
    expect(() => bus.emit("unknown", "value")).not.toThrow();
  });
});
