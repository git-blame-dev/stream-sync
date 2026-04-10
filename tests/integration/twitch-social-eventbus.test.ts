const { describe, test, afterEach, expect } = require('bun:test');
const EventEmitter = require('events');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService.js');
const { TwitchPlatform } = require('../../src/platforms/twitch');
const { PlatformEvents } = require('../../src/interfaces/PlatformEvents');
const { createTwitchConfigFixture } = require('../helpers/config-fixture');
const { noOpLogger } = require('../helpers/mock-factories');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const createEventBus = () => {
    const emitter = new EventEmitter();
    return {
        emit: emitter.emit.bind(emitter),
        subscribe: (event, handler) => {
            emitter.on(event, handler);
            return () => emitter.off(event, handler);
        }
    };
};

const waitForPlatformEvent = (eventBus) => new Promise((resolve) => {
    const unsubscribe = eventBus.subscribe('platform:event', (event) => {
        unsubscribe();
        resolve(event);
    });
});

const createPlatform = () => new TwitchPlatform(createTwitchConfigFixture({ enabled: true }), {
    logger: noOpLogger,
    twitchAuth: {
        isReady: () => true,
        getUserId: createMockFn(() => 'test-user-id')
    }
});

describe('Twitch social event bus routing (integration)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('emits follow events through lifecycle handlers', async () => {
        const eventBus = createEventBus();
        const lifecycle = new PlatformLifecycleService({
            config: { twitch: { enabled: true } },
            eventBus,
            logger: noOpLogger
        });
        const platform = createPlatform();
        platform.handlers = lifecycle.createDefaultEventHandlers('twitch');

        const eventPromise = waitForPlatformEvent(eventBus);

        try {
            await platform.handleFollowEvent({
                username: 'test-user-follow',
                userId: 'test-user-id-follow',
                timestamp: '2024-01-01T00:00:00.000Z'
            });

            const event = await eventPromise;

            expect(event.type).toBe(PlatformEvents.FOLLOW);
            expect(event.platform).toBe('twitch');
            expect(event.data.username).toBe('test-user-follow');
            expect(event.data.userId).toBe('test-user-id-follow');
            expect(event.data.timestamp).toBe('2024-01-01T00:00:00.000Z');
        } finally {
            lifecycle.dispose();
        }
    });

    test('emits raid events through lifecycle handlers', async () => {
        const eventBus = createEventBus();
        const lifecycle = new PlatformLifecycleService({
            config: { twitch: { enabled: true } },
            eventBus,
            logger: noOpLogger
        });
        const platform = createPlatform();
        platform.handlers = lifecycle.createDefaultEventHandlers('twitch');

        const eventPromise = waitForPlatformEvent(eventBus);

        try {
            await platform.handleRaidEvent({
                username: 'test-user-raider',
                userId: 'test-user-id-raider',
                viewerCount: 42,
                timestamp: '2024-01-01T00:00:00.000Z'
            });

            const event = await eventPromise;

            expect(event.type).toBe(PlatformEvents.RAID);
            expect(event.platform).toBe('twitch');
            expect(event.data.username).toBe('test-user-raider');
            expect(event.data.userId).toBe('test-user-id-raider');
            expect(event.data.viewerCount).toBe(42);
            expect(event.data.timestamp).toBe('2024-01-01T00:00:00.000Z');
        } finally {
            lifecycle.dispose();
        }
    });
});
