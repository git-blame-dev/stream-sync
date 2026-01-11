jest.unmock('../../../src/platforms/tiktok');

const { TikTokPlatform } = require('../../../src/platforms/tiktok');
const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');

const createLogger = () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
});

const createPlatform = (configOverrides = {}, dependencyOverrides = {}) => {
    const logger = dependencyOverrides.logger || createLogger();
    const notificationManager = dependencyOverrides.notificationManager || {
        emit: jest.fn(),
        on: jest.fn(),
        removeListener: jest.fn(),
        handleNotification: jest.fn().mockResolvedValue()
    };
    const connectionFactory = dependencyOverrides.connectionFactory || {
        createConnection: jest.fn().mockReturnValue({
            on: jest.fn(),
            emit: jest.fn(),
            removeAllListeners: jest.fn(),
            connect: jest.fn(),
            disconnect: jest.fn()
        })
    };

    const TikTokWebSocketClient = dependencyOverrides.TikTokWebSocketClient || jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        off: jest.fn(),
        connect: jest.fn(),
        disconnect: jest.fn(),
        getState: jest.fn().mockReturnValue('DISCONNECTED'),
        isConnecting: false,
        isConnected: false
    }));

    const WebcastEvent = dependencyOverrides.WebcastEvent || { ERROR: 'error', DISCONNECT: 'disconnect' };
    const ControlEvent = dependencyOverrides.ControlEvent || {};

    const config = {
        enabled: true,
        username: 'tester',
        giftAggregationEnabled: true,
        ...configOverrides
    };

    return new TikTokPlatform(config, {
        logger,
        notificationManager,
        TikTokWebSocketClient,
        WebcastEvent,
        ControlEvent,
        connectionFactory,
        ...dependencyOverrides
    });
};

describe('TikTokPlatform behavior alignment', () => {
    describe('gift handling', () => {
        it('emits a user-facing error when gift count is zero and does not throw', async () => {
            const platform = createPlatform();
            const errors = [];
            const routedGifts = [];
            platform.on('platform:event', (payload) => {
                if (payload.type === 'error') {
                    errors.push(payload);
                }
            });
            platform.handlers = {
                ...platform.handlers,
                onGift: (data) => routedGifts.push(data)
            };

            await expect(
                platform.handleTikTokGift({
                    repeatCount: 0,
                    giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0 },
                    msgId: 'gift-zero',
                    user: {
                        uniqueId: 'alice',
                        nickname: 'Alice',
                        userId: 'alice-id'
                    }
                })
            ).resolves.toBeUndefined();

            expect(errors.length).toBe(1);
            expect(errors[0]).toMatchObject({
                type: 'error',
                platform: 'tiktok',
                data: expect.objectContaining({
                    type: PlatformEvents.ERROR,
                    platform: 'tiktok',
                    recoverable: true,
                    context: expect.objectContaining({
                        reason: 'gift-count-invalid'
                    })
                })
            });
            expect(routedGifts).toHaveLength(1);
            expect(routedGifts[0]).toMatchObject({
                platform: 'tiktok',
                username: 'alice',
                userId: 'alice-id',
                giftType: 'Rose',
                isError: true
            });
            expect(routedGifts[0]).not.toHaveProperty('giftCount');
            expect(routedGifts[0]).not.toHaveProperty('amount');
            expect(routedGifts[0]).not.toHaveProperty('currency');
        });
    });

    describe('connection lifecycle events', () => {
        it('emits connected and disconnected events with correlation metadata', async () => {
            const platform = createPlatform();
            const connectedEvents = [];
            const disconnectedEvents = [];

            platform.on('platform:event', (payload) => {
                if (payload.type === 'chat-connected') {
                    connectedEvents.push(payload);
                }
                if (payload.type === 'chat-disconnected') {
                    disconnectedEvents.push(payload);
                }
            });

            await platform._handleConnection();
            await platform._handleDisconnection('test-close');

            expect(connectedEvents.length).toBe(1);
            expect(connectedEvents[0]).toMatchObject({
                type: 'chat-connected',
                platform: 'tiktok',
                data: expect.objectContaining({
                    type: PlatformEvents.CHAT_CONNECTED,
                    platform: 'tiktok',
                    metadata: expect.objectContaining({
                        correlationId: expect.any(String)
                    })
                })
            });

            expect(disconnectedEvents.length).toBe(1);
            expect(disconnectedEvents[0]).toMatchObject({
                type: 'chat-disconnected',
                platform: 'tiktok',
                data: expect.objectContaining({
                    type: PlatformEvents.CHAT_DISCONNECTED,
                    platform: 'tiktok',
                    reason: 'test-close',
                    metadata: expect.objectContaining({
                        correlationId: expect.any(String)
                    })
                })
            });
        });
    });

    describe('gift aggregation and routing', () => {
        it('emits aggregated gift payload with correct schema', async () => {
            const platform = createPlatform();
            const routedEvents = [];
            const errors = [];

            // Inject handlers to capture events
            platform.handlers = {
                ...platform.handlers,
                onGift: (data) => routedEvents.push({ type: 'gift', platform: 'tiktok', data })
            };

            platform.on('platform:event', (payload) => {
                if (payload.type === 'error') {
                    errors.push(payload);
                }
            });

            await platform._handleGift({
                giftType: 'Rose',
                giftCount: 3,
                amount: 3,
                currency: 'coins',
                unitAmount: 1,
                timestamp: new Date().toISOString(),
                msgId: 'gift-agg-1',
                repeatCount: 3,
                aggregatedCount: 3,
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0 },
                user: { userId: 'alice-id', uniqueId: 'alice' },
                enhancedGiftData: {
                    giftType: 'Rose',
                    giftCount: 3,
                    amount: 3,
                    currency: 'coins',
                    isAggregated: true
                }
            });

            expect(errors).toEqual([]);
            expect(routedEvents.length).toBe(1);

            const routed = routedEvents[0];
            expect(routed.type).toBe('gift');
            expect(routed.platform).toBe('tiktok');

            const payload = routed.data;
            expect(payload.type).toBe(PlatformEvents.GIFT);
            expect(payload.userId).toBe('alice-id');
            expect(payload.username).toBe('alice');
            expect(payload.giftType).toBe('Rose');
            expect(payload.amount).toBe(3);
            expect(payload.currency).toBe('coins');
            expect(payload.aggregatedCount).toBe(3);
            expect(payload.isAggregated).toBe(true);
            expect(payload.metadata).toBeUndefined();
        });

    });

    describe('connection state and viewer count', () => {
        it('caches viewer count and emits viewer-count event', async () => {
            const events = [];
            const platform = createPlatform({}, {
                WebcastEvent: {
                    ROOM_USER: 'room_user',
                    ERROR: 'error',
                    DISCONNECT: 'disconnect',
                    CHAT: 'chat',
                    GIFT: 'gift',
                    FOLLOW: 'follow',
                    SOCIAL: 'social'
                },
                connectionFactory: { createConnection: jest.fn() }
            });

            const listeners = {};
            const connection = {
                on: jest.fn((event, handler) => { listeners[event] = handler; }),
                off: jest.fn(),
                connect: jest.fn(),
                disconnect: jest.fn(),
                removeAllListeners: jest.fn(),
                isConnecting: false,
                isConnected: false
            };

            platform.connection = connection;

            // Inject handler to capture viewer count events
            platform.handlers = {
                ...platform.handlers,
                onViewerCount: (data) => events.push({ type: 'viewer-count', platform: 'tiktok', data })
            };

            platform.setupEventListeners();

            await listeners['room_user']?.({ viewerCount: 42 });

            expect(platform.cachedViewerCount).toBe(42);
            const viewerEvent = events.find((evt) => evt.type === 'viewer-count');
            expect(viewerEvent).toBeDefined();
            expect(viewerEvent.data.count).toBe(42);
        });

    });

    describe('dependency validation', () => {
        it('fails fast when TikTokWebSocketClient is missing', () => {
            const logger = createLogger();
            expect(() => new TikTokPlatform({ enabled: true, username: 'tester' }, {
                WebcastEvent: { ERROR: 'error', DISCONNECT: 'disconnect' },
                ControlEvent: {},
                connectionFactory: { createConnection: jest.fn() },
                logger
            })).toThrow(/TikTokWebSocketClient/i);
        });

        it('fails fast when WebcastEvent is missing', () => {
            const logger = createLogger();
            expect(() => new TikTokPlatform({ enabled: true, username: 'tester' }, {
                TikTokWebSocketClient: jest.fn(),
                ControlEvent: {},
                connectionFactory: { createConnection: jest.fn() },
                logger
            })).toThrow(/WebcastEvent/i);
        });
    });
});
