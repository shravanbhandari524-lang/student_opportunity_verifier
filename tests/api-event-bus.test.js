import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createEventBus } from "../lib/api/event-bus.js";

describe("lib/api/event-bus.js", () => {
  it("subscribe registers listener and notify calls it", () => {
    const bus = createEventBus();
    let called = 0;

    const unsubscribe = bus.subscribe("check-1", () => {
      called++;
    });

    assert.equal(bus.listenerCount("check-1"), 1);
    bus.notify("check-1");
    assert.equal(called, 1);

    // Another checkId doesn't trigger listener
    bus.notify("check-2");
    assert.equal(called, 1);

    unsubscribe();
    assert.equal(bus.listenerCount("check-1"), 0);

    bus.notify("check-1");
    assert.equal(called, 1);
  });

  it("handles listener error without breaking notification to other listeners", () => {
    const bus = createEventBus();
    let called2 = 0;

    bus.subscribe("check-err", () => {
      throw new Error("listener error");
    });

    bus.subscribe("check-err", () => {
      called2++;
    });

    bus.notify("check-err");
    assert.equal(called2, 1);
  });

  it("clear removes all registered listeners", () => {
    const bus = createEventBus();
    bus.subscribe("check-a", () => {});
    bus.subscribe("check-b", () => {});
    assert.equal(bus.listenerCount("check-a"), 1);
    assert.equal(bus.listenerCount("check-b"), 1);

    bus.clear();
    assert.equal(bus.listenerCount("check-a"), 0);
    assert.equal(bus.listenerCount("check-b"), 0);
  });
});
