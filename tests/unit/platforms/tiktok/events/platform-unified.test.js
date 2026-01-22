const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');

const PlatformEventRouter = require('../../../../../src/services/PlatformEventRouter');
const { PlatformEvents } = require('../../../../../src/interfaces/PlatformEvents');
const { TikTokPlatform } = require('../../../../../src/platforms/tiktok');
const testClock = require('../../../../helpers/test-clock');

describe('TikTokPlatform unified event contract (expected behavior)', () => {
    let platform;
    let mockEventBus;
    let runtime;

    afterEach(() => {
        restoreAllMocks();
    });

    beforeEach(() => {
        mockEventBus = {
            emitted: [],
            handlers: {},
            emit(eventName, payload) {
                (this.handlers[eventName] || []).forEach((handler) => handler(payload));
                this.emitted.push({ eventName, payload });
            },
            subscribe(eventName, handler) {
                this.handlers[eventName] = this.handlers[eventName] || [];
                this.handlers[eventName].push(handler);
                return () => {
                    this.handlers[eventName] = this.handlers[eventName].filter((h) => h !== handler);
                };
            }
        };

        runtime = {
            handleChatMessage: createMockFn(),
            handleFollowNotification: createMockFn(),
            handleGiftNotification: createMockFn(),
            handlePaypiggyNotification: createMockFn(),
            handleRaidNotification: createMockFn()
        };

        new PlatformEventRouter({
            eventBus: mockEventBus,
            runtime,
            notificationManager: { handleNotification: createMockFn() },
            configService: { areNotificationsEnabled: createMockFn(() => true) },
            logger: noOpLogger
        });

        const mockDependencies = {
            logger: noOpLogger,
            connectionFactory: {
                createConnection: createMockFn().mockReturnValue({
                    connect: createMockFn().mockResolvedValue(),
                    disconnect: createMockFn().mockResolvedValue(),
                    on: createMockFn(),
                    removeAllListeners: createMockFn()
                })
            },
            TikTokWebSocketClient: class MockConnection {
                constructor() {}
                connect() { return Promise.resolve(); }
                disconnect() { return Promise.resolve(); }
                on() {}
                removeAllListeners() {}
            },
            WebcastEvent: {
                CHAT: 'chat',
                GIFT: 'gift',
                FOLLOW: 'follow',
                SOCIAL: 'social',
                ROOM_USER: 'roomUser',
                ERROR: 'error',
                DISCONNECT: 'disconnect'
            },
            ControlEvent: {},
            timestampService: {
                extractTimestamp: createMockFn(() => new Date(testClock.now()).toISOString())
            }
        };

        platform = new TikTokPlatform({ enabled: false, username: 'user' }, {
            ...mockDependencies,
            eventBus: mockEventBus
        });

        const platformHandlers = {
            onChat: (data) => mockEventBus.emit('platform:event', { platform: 'tiktok', type: PlatformEvents.CHAT_MESSAGE, data }),
            onFollow: (data) => mockEventBus.emit('platform:event', { platform: 'tiktok', type: PlatformEvents.FOLLOW, data }),
            onGift: (data) => mockEventBus.emit('platform:event', { platform: 'tiktok', type: PlatformEvents.GIFT, data }),
            onShare: (data) => mockEventBus.emit('platform:event', { platform: 'tiktok', type: PlatformEvents.SHARE, data })
        };

        platform.handlers = { ...platform.handlers, ...platformHandlers };
    });

    it('routes chat events through platform:event to PlatformEventRouter', async () => {
        await platform._handleChatMessage({
            user: {
                userId: 'tt-user-1',
                uniqueId: 'user1',
                nickname: 'User1'
            },
            comment: 'hello world',
            common: { createTime: testClock.now() }
        });

        expect(runtime.handleChatMessage).toHaveBeenCalledTimes(1);
        expect(mockEventBus.emitted.find((e) => e.eventName === 'platform:event')).toBeDefined();
    });

    it('routes follow events through platform:event to PlatformEventRouter', async () => {
        await platform._handleFollow({ user: { userId: 'tt-follow-1', uniqueId: 'follower', nickname: 'Follower' } });

        expect(runtime.handleFollowNotification).toHaveBeenCalledTimes(1);
        expect(mockEventBus.emitted.find((e) => e.eventName === 'platform:event')).toBeDefined();
    });

    it('routes gift events through platform:event to PlatformEventRouter', async () => {
        const timestamp = new Date(testClock.now()).toISOString();
        await platform._handleGift({
            platform: 'tiktok',
            userId: 'tt-gift-1',
            username: 'gifter',
            giftType: 'Rose',
            giftCount: 2,
            repeatCount: 2,
            amount: 20,
            currency: 'coins',
            unitAmount: 10,
            timestamp,
            id: 'gift-msg-1'
        });

        expect(runtime.handleGiftNotification).toHaveBeenCalledTimes(1);
        expect(mockEventBus.emitted.find((e) => e.eventName === 'platform:event')).toBeDefined();
    });

    it('emits share events through platform:event when only default handlers are available', () => {
        const emitted = [];
        platform.handlers = platform._createDefaultHandlers();
        mockEventBus.subscribe('platform:event', (payload) => emitted.push(payload));

        const sharePayload = { username: 'user123', actionType: 'share' };
        platform.handlers.onShare(sharePayload);

        const shareEvent = emitted.find((entry) => entry.type === PlatformEvents.SHARE);

        expect(shareEvent).toBeDefined();
        expect(shareEvent.data).toEqual(sharePayload);
    });

    it('emits platform:event for chat without relying on bridge shims', async () => {
        const emitted = [];
        mockEventBus.subscribe('platform:event', (payload) => emitted.push(payload));

        await platform._handleChatMessage({
            user: {
                userId: 'tt-user-2',
                uniqueId: 'user-no-bridge',
                nickname: 'NoBridgeUser'
            },
            comment: 'hello from no bridge',
            common: { createTime: testClock.now() }
        });

        const chatEvent = emitted.find((entry) => entry.type === PlatformEvents.CHAT_MESSAGE);
        expect(chatEvent).toBeDefined();
        expect(chatEvent.data?.message?.text).toContain('hello from no bridge');
    });

    it('emits local platform:event for routed events', () => {
        const emitted = [];
        platform.on('platform:event', (payload) => emitted.push(payload));

        const payload = { platform: 'tiktok', message: { text: 'hello' } };
        platform._emitPlatformEvent(PlatformEvents.CHAT_MESSAGE, payload);

        expect(emitted).toEqual([
            {
                platform: 'tiktok',
                type: PlatformEvents.CHAT_MESSAGE,
                data: payload
            }
        ]);
    });
});
