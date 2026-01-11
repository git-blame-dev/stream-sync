
jest.unmock('../../../src/platforms/tiktok');
jest.unmock('../../../src/services/PlatformEventRouter');

const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');
const { TikTokPlatform } = require('../../../src/platforms/tiktok');
const testClock = require('../../helpers/test-clock');

describe('TikTokPlatform unified event contract (expected behavior)', () => {
    let platform;
    let mockEventBus;
    let runtime;

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
            handleChatMessage: jest.fn(),
            handleFollowNotification: jest.fn(),
            handleGiftNotification: jest.fn(),
            handlePaypiggyNotification: jest.fn(),
            handleRaidNotification: jest.fn()
        };

        new PlatformEventRouter({
            eventBus: mockEventBus,
            runtime,
            notificationManager: { handleNotification: jest.fn() },
            configService: { areNotificationsEnabled: jest.fn(() => true) },
            logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
        });

        // Use production initialization with proper mocking
        const mockLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
        const mockDependencies = {
            logger: mockLogger,
            connectionFactory: {
                createConnection: jest.fn().mockReturnValue({
                    connect: jest.fn().mockResolvedValue(),
                    disconnect: jest.fn().mockResolvedValue(),
                    on: jest.fn(),
                    removeAllListeners: jest.fn()
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
                extractTimestamp: jest.fn(() => new Date(testClock.now()).toISOString())
            }
        };

        platform = new TikTokPlatform({ enabled: false, username: 'user' }, {
            ...mockDependencies,
            eventBus: mockEventBus
        });

        // Inject handlers that route to EventBus (production pattern)
        const platformHandlers = {
            onChat: (data) => mockEventBus.emit('platform:event', { platform: 'tiktok', type: 'chat', data }),
            onFollow: (data) => mockEventBus.emit('platform:event', { platform: 'tiktok', type: 'follow', data }),
            onGift: (data) => mockEventBus.emit('platform:event', { platform: 'tiktok', type: 'gift', data }),
            onShare: (data) => mockEventBus.emit('platform:event', { platform: 'tiktok', type: 'share', data })
        };

        // Initialize platform with handlers (production pattern)
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
            createTime: testClock.now()
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
            user: {
                userId: 'tt-gift-1',
                uniqueId: 'gifter',
                nickname: 'Gifter'
            },
            giftType: 'Rose',
            giftCount: 2,
            amount: 20,
            currency: 'coins',
            unitAmount: 10,
            timestamp,
            msgId: 'gift-msg-1',
            repeatCount: 2,
            giftDetails: { giftName: 'Rose', diamondCount: 10, giftType: 0 }
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

        const shareEvent = emitted.find((entry) => entry.type === 'share');

        expect(shareEvent).toBeDefined();
        expect(shareEvent.data).toEqual(sharePayload);
    });

    it('emits platform:event for chat without relying on bridge shims', async () => {
        const emitted = [];
        mockEventBus.subscribe('platform:event', (payload) => emitted.push(payload));

        // Do not call bridge shims
        await platform._handleChatMessage({
            user: {
                userId: 'tt-user-2',
                uniqueId: 'user-no-bridge',
                nickname: 'NoBridgeUser'
            },
            comment: 'hello from no bridge',
            createTime: testClock.now()
        });

        const chatEvent = emitted.find((entry) => entry.type === 'chat');
        expect(chatEvent).toBeDefined();
        expect(chatEvent.data?.message?.text).toContain('hello from no bridge');
    });

    it('emits local platform:event for routed events', () => {
        const emitted = [];
        platform.on('platform:event', (payload) => emitted.push(payload));

        const payload = { platform: 'tiktok', message: { text: 'hello' } };
        platform._emitPlatformEvent('chat', payload);

        expect(emitted).toEqual([
            {
                platform: 'tiktok',
                type: 'chat',
                data: payload
            }
        ]);
    });
});
