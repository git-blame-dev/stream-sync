import { describe, test, expect } from "bun:test";
import { noOpLogger } from "../../../../helpers/mock-factories";
import { createTwitchEventSubWiring } from "../../../../../src/platforms/twitch/connections/wiring.ts";

type Listener = (...args: unknown[]) => void;
type ListenerStore = Record<string, Listener[]>;
type BoundListener = { eventName: string; handler: Listener };

describe("Twitch EventSub wiring", () => {
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
