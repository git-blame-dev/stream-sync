const { describe, test, expect } = require('bun:test');
const { createTwitchEventSubWiring } = require('../../../../src/platforms/twitch/eventsub/twitch-eventsub-wiring');

describe('Twitch EventSub wiring', () => {
    const createLogger = () => ({
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
    });

    const createEventSub = ({ useOff = true } = {}) => {
        const listeners = {};
        const add = (event, handler) => {
            listeners[event] = listeners[event] || [];
            listeners[event].push(handler);
        };
        const remove = (event, handler) => {
            listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
        };

        return {
            listeners,
            on: (event, handler) => add(event, handler),
            off: useOff ? (event, handler) => remove(event, handler) : undefined,
            removeListener: useOff ? undefined : (event, handler) => remove(event, handler)
        };
    };

    test('binds handlers and unbinds them using off when available', () => {
        const eventSub = createEventSub({ useOff: true });
        const eventSubListeners = [];
        const wiring = createTwitchEventSubWiring({
            eventSub,
            eventSubListeners,
            logger: createLogger()
        });

        wiring.bindAll({
            message: () => {},
            follow: () => {}
        });

        expect(eventSub.listeners.message).toHaveLength(1);
        expect(eventSub.listeners.follow).toHaveLength(1);
        expect(eventSubListeners).toHaveLength(2);

        wiring.unbindAll();

        expect(eventSub.listeners.message).toHaveLength(0);
        expect(eventSub.listeners.follow).toHaveLength(0);
        expect(eventSubListeners).toEqual([]);
    });

    test('unbinds handlers using removeListener when off is unavailable', () => {
        const eventSub = createEventSub({ useOff: false });
        const eventSubListeners = [];
        const wiring = createTwitchEventSubWiring({
            eventSub,
            eventSubListeners,
            logger: createLogger()
        });

        wiring.bindAll({
            message: () => {},
            follow: () => {}
        });

        expect(eventSub.listeners.message).toHaveLength(1);
        expect(eventSub.listeners.follow).toHaveLength(1);

        wiring.unbindAll();

        expect(eventSub.listeners.message).toHaveLength(0);
        expect(eventSub.listeners.follow).toHaveLength(0);
        expect(eventSubListeners).toEqual([]);
    });
});

