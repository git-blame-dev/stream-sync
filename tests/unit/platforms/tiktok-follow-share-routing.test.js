const { describe, it, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const EventEmitter = require('events');
const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');

function createAppRuntimeMocks() {
    const handled = [];
    return {
        handled,
        runtime: {
            handleFollowNotification: (platform, username, payload) => {
                handled.push({ type: 'platform:follow', platform, username, payload });
            },
            handleShareNotification: (platform, username, payload) => {
                handled.push({ type: 'platform:share', platform, username, payload });
            }
        }
    };
}

function createMockEventBus() {
    const bus = new EventEmitter();
    bus.subscribe = (eventName, handler) => {
        bus.on(eventName, handler);
        return () => bus.off(eventName, handler);
    };
    return bus;
}

describe('TikTok follow/share routing', () => {
    it('routes follow events through platform:event to PlatformEventRouter', async () => {
        const eventBus = createMockEventBus();
        const { runtime, handled } = createAppRuntimeMocks();
        new PlatformEventRouter({
            eventBus,
            runtime,
            notificationManager: { handleNotification: createMockFn() },
            configService: { areNotificationsEnabled: createMockFn(() => true) },
            logger: noOpLogger
        });

        await eventBus.emit('platform:event', {
            type: 'platform:follow',
            platform: 'tiktok',
            data: { username: 'Follower', userId: 'user-1', timestamp: new Date().toISOString(), metadata: {} }
        });

        expect(handled).toHaveLength(1);
        expect(handled[0].type).toBe('platform:follow');
        expect(handled[0].username).toBeDefined();
    });

    it('routes share events through platform:event to PlatformEventRouter', () => {
        const eventBus = createMockEventBus();
        const { runtime, handled } = createAppRuntimeMocks();
        new PlatformEventRouter({
            eventBus,
            runtime,
            notificationManager: { handleNotification: createMockFn() },
            configService: { areNotificationsEnabled: createMockFn(() => true) },
            logger: noOpLogger
        });
        const emitted = [];
        eventBus.subscribe('platform:event', (payload) => emitted.push(payload));

        eventBus.emit('platform:event', {
            type: 'platform:share',
            platform: 'tiktok',
            data: { username: 'Sharer', userId: 'user-2', timestamp: new Date().toISOString(), metadata: {} }
        });

        expect(emitted.find((p) => p.type === 'platform:share')).toBeDefined();
        expect(handled).toHaveLength(1);
        expect(handled[0].type).toBe('platform:share');
    });
});
