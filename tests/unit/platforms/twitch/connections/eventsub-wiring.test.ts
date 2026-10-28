import { describe, test, expect } from "bun:test";
import { noOpLogger } from "../../../../helpers/mock-factories";
import { createTwitchEventSubWiring } from "../../../../../src/platforms/twitch/connections/wiring.ts";

type Listener = (...args: unknown[]) => void;
type ListenerStore = Record<string, Listener[]>;
type BoundListener = { eventName: string; handler: Listener };

describe("Twitch EventSub wiring", () => {
  test("rolls back only newly bound exact callbacks when a later bind throws", () => {
    const listeners = new Map<string, Listener>();
    const store: BoundListener[] = [];
    const first = () => {};
    const existing = () => {};
    const failure = new Error("synthetic bind failure");
    const removed: BoundListener[] = [];
    const wiring = createTwitchEventSubWiring({ logger: noOpLogger, eventSubListeners: store, eventSub: {
      on: (event, handler) => { if (event === "second") throw failure; listeners.set(event, handler); },
      off: (eventName, handler) => { removed.push({ eventName, handler }); if (listeners.get(eventName) === handler) listeners.delete(eventName); },
    } });
    wiring.bind("existing", existing);
    expect(() => wiring.bindAll({ first, second: () => {} })).toThrow(failure);
    expect(removed).toEqual([{ eventName: "first", handler: first }]);
    expect([...listeners.keys()]).toEqual(["existing"]);
    expect(store).toEqual([{ eventName: "existing", handler: existing }]);
  });

  test("retains failed rollback entries and preserves the original bind failure despite diagnostics", () => {
    const store: BoundListener[] = [];
    const first = () => {};
    const failure = new Error("synthetic bind failure");
    let removalFails = true;
    const wiring = createTwitchEventSubWiring({
      logger: { ...noOpLogger, error: () => { throw new Error("synthetic diagnostic failure"); } },
      eventSubListeners: store, eventSub: {
        on: (event) => { if (event === "second") throw failure; },
        off: () => { if (removalFails) throw new Error("synthetic removal failure"); },
      },
    });
    expect(() => wiring.bindAll({ first, second: () => {} })).toThrow(failure);
    expect(store).toEqual([{ eventName: "first", handler: first }]);
    removalFails = false;
    wiring.unbindAll();
    expect(store).toEqual([]);
  });

  test("retains listeners without a removal API until a later retry can remove them", () => {
    const store: BoundListener[] = [];
    const handler = () => {};
    const eventSub: { on: () => void; off?: (event: string, listener: Listener) => void } = { on: () => {} };
    const wiring = createTwitchEventSubWiring({ logger: noOpLogger, eventSubListeners: store, eventSub });
    wiring.bind("test", handler);
    wiring.unbindAll();
    expect(store).toEqual([{ eventName: "test", handler }]);
    const removed: BoundListener[] = [];
    eventSub.off = (eventName, callback) => { removed.push({ eventName, handler: callback }); };
    wiring.unbindAll();
    expect(removed).toEqual([{ eventName: "test", handler }]);
    expect(store).toEqual([]);
  });

  test("unbind attempts independent removals and retains only failures for retry", () => {
    const store: BoundListener[] = [];
    const first = () => {};
    const second = () => {};
    let fail = true;
    const removed: string[] = [];
    const wiring = createTwitchEventSubWiring({ logger: noOpLogger, eventSubListeners: store, eventSub: {
      on: () => {},
      off: (event) => { if (event === "first" && fail) throw new Error("synthetic removal failure"); removed.push(event); },
    } });
    wiring.bindAll({ first, second });
    wiring.unbindAll();
    expect(removed).toEqual(["second"]);
    expect(store).toEqual([{ eventName: "first", handler: first }]);
    fail = false;
    wiring.unbindAll();
    expect(removed).toEqual(["second", "first"]);
    expect(store).toEqual([]);
  });

  const createEventSub = ({ useOff = true } = {}) => {
    const listeners: ListenerStore = {};
    const add = (event: string, handler: Listener): void => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
    };
    const remove = (event: string, handler: Listener): void => {
      listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
    };

    const eventSub = {
      listeners,
      on: (event: string, handler: Listener) => add(event, handler),
    };

    return useOff
      ? { ...eventSub, off: (event: string, handler: Listener) => remove(event, handler) }
      : { ...eventSub, removeListener: (event: string, handler: Listener) => remove(event, handler) };
  };

  test("binds handlers and unbinds them using off when available", () => {
    const eventSub = createEventSub({ useOff: true });
    const eventSubListeners: BoundListener[] = [];
    const wiring = createTwitchEventSubWiring({
      eventSub,
      eventSubListeners,
      logger: noOpLogger,
    });

    wiring.bindAll({
      message: () => {},
      follow: () => {},
    });

    expect(eventSub.listeners.message).toHaveLength(1);
    expect(eventSub.listeners.follow).toHaveLength(1);
    expect(eventSubListeners).toHaveLength(2);

    wiring.unbindAll();

    expect(eventSub.listeners.message).toHaveLength(0);
    expect(eventSub.listeners.follow).toHaveLength(0);
    expect(eventSubListeners).toEqual([]);
  });

  test("unbinds handlers using removeListener when off is unavailable", () => {
    const eventSub = createEventSub({ useOff: false });
    const eventSubListeners: BoundListener[] = [];
    const wiring = createTwitchEventSubWiring({
      eventSub,
      eventSubListeners,
      logger: noOpLogger,
    });

    wiring.bindAll({
      message: () => {},
      follow: () => {},
    });

    expect(eventSub.listeners.message).toHaveLength(1);
    expect(eventSub.listeners.follow).toHaveLength(1);

    wiring.unbindAll();

    expect(eventSub.listeners.message).toHaveLength(0);
    expect(eventSub.listeners.follow).toHaveLength(0);
    expect(eventSubListeners).toEqual([]);
  });

  test("tracks listeners internally when eventSubListeners is not provided", () => {
    const eventSub = createEventSub({ useOff: true });
    const wiring = createTwitchEventSubWiring({
      eventSub,
      logger: noOpLogger,
    });

    wiring.bindAll({
      message: () => {},
      follow: () => {},
    });

    expect(eventSub.listeners.message).toHaveLength(1);
    expect(eventSub.listeners.follow).toHaveLength(1);

    wiring.unbindAll();

    expect(eventSub.listeners.message).toHaveLength(0);
    expect(eventSub.listeners.follow).toHaveLength(0);
  });
});
