const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { TikTokPlatform } = require('../../../../../src/platforms/tiktok');
const { PlatformEvents } = require('../../../../../src/interfaces/PlatformEvents');

const createPlatform = (configOverrides = {}, dependencyOverrides = {}) => {
    const logger = dependencyOverrides.logger || noOpLogger;
    const notificationManager = dependencyOverrides.notificationManager || {
        emit: createMockFn(),
        on: createMockFn(),
        removeListener: createMockFn(),
        handleNotification: createMockFn().mockResolvedValue()
    };
    const connectionFactory = dependencyOverrides.connectionFactory || {
        createConnection: createMockFn().mockReturnValue({
            on: createMockFn(),
            emit: createMockFn(),
            removeAllListeners: createMockFn(),
            connect: createMockFn().mockResolvedValue(),
            disconnect: createMockFn()
        })
    };

    const TikTokWebSocketClient = dependencyOverrides.TikTokWebSocketClient || createMockFn().mockImplementation(() => ({
        on: createMockFn(),
        off: createMockFn(),
        connect: createMockFn(),
        disconnect: createMockFn(),
        getState: createMockFn().mockReturnValue('DISCONNECTED'),
        isConnecting: false,
        isConnected: false
    }));

    const WebcastEvent = dependencyOverrides.WebcastEvent || { ERROR: 'error', DISCONNECT: 'disconnect' };
    const ControlEvent = dependencyOverrides.ControlEvent || {};

    const config = {
        enabled: true,
        username: 'testUser',
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

describe('TikTokPlatform _handleEventProcessingError', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    describe('non-monetization events', () => {
        it('returns payloadEmitted=false with reason non-monetization for chat errors', () => {
            const platform = createPlatform();

            const result = platform._handleEventProcessingError(
                PlatformEvents.CHAT_MESSAGE,
                { userId: '123', username: 'testUser' },
                new Error('processing failed')
            );

            expect(result.payloadEmitted).toBe(false);
            expect(result.reason).toBe('non-monetization');
        });

        it('returns payloadEmitted=false for follow events', () => {
            const platform = createPlatform();

            const result = platform._handleEventProcessingError(
                PlatformEvents.FOLLOW,
                { userId: '123', username: 'testUser' },
                new Error('processing failed')
            );

            expect(result.payloadEmitted).toBe(false);
            expect(result.reason).toBe('non-monetization');
        });
    });

    describe('monetization events with valid data', () => {
        it('returns payloadEmitted=true for gift errors with valid identity', () => {
            const platform = createPlatform();
            const emittedEvents = [];
            platform.on('platform:event', (e) => emittedEvents.push(e));

            const result = platform._handleEventProcessingError(
                PlatformEvents.GIFT,
                { userId: '123', username: 'testGifter', amount: 100, currency: 'coins' },
                new Error('processing failed')
            );

            expect(result.payloadEmitted).toBe(true);
            expect(emittedEvents).toHaveLength(1);
            expect(emittedEvents[0].data.username).toBe('testGifter');
        });

        it('returns payloadEmitted=true for envelope errors with valid identity', () => {
            const platform = createPlatform();
            const emittedEvents = [];
            platform.on('platform:event', (e) => emittedEvents.push(e));

            const result = platform._handleEventProcessingError(
                PlatformEvents.ENVELOPE,
                { userId: '456', username: 'testEnvelope', amount: 50 },
                new Error('processing failed')
            );

            expect(result.payloadEmitted).toBe(true);
            expect(emittedEvents).toHaveLength(1);
        });
    });

    describe('monetization events with incomplete data', () => {
        it('emits error payload even without identity data', () => {
            const platform = createPlatform();
            const emittedEvents = [];
            platform.on('platform:event', (e) => emittedEvents.push(e));

            const result = platform._handleEventProcessingError(
                PlatformEvents.GIFT,
                {},
                new Error('processing failed')
            );

            expect(result.payloadEmitted).toBe(true);
            expect(emittedEvents).toHaveLength(1);
            expect(emittedEvents[0].data.isError).toBe(true);
        });

        it('emits error payload with partial identity', () => {
            const platform = createPlatform();
            const emittedEvents = [];
            platform.on('platform:event', (e) => emittedEvents.push(e));

            const result = platform._handleEventProcessingError(
                PlatformEvents.GIFT,
                { username: 'partialUser' },
                new Error('processing failed')
            );

            expect(result.payloadEmitted).toBe(true);
            expect(emittedEvents[0].data.isError).toBe(true);
        });
    });

    describe('error payload structure', () => {
        it('includes isError flag in emitted payload', () => {
            const platform = createPlatform();
            const emittedEvents = [];
            platform.on('platform:event', (e) => emittedEvents.push(e));

            platform._handleEventProcessingError(
                PlatformEvents.GIFT,
                { userId: '123', username: 'testGifter' },
                new Error('processing failed')
            );

            expect(emittedEvents[0].data.isError).toBe(true);
            expect(emittedEvents[0].data.platform).toBe('tiktok');
        });

        it('includes identity fields when available', () => {
            const platform = createPlatform();
            const emittedEvents = [];
            platform.on('platform:event', (e) => emittedEvents.push(e));

            platform._handleEventProcessingError(
                PlatformEvents.ENVELOPE,
                { userId: '456', username: 'testEnvelope' },
                new Error('processing failed')
            );

            expect(emittedEvents[0].data.username).toBe('testEnvelope');
            expect(emittedEvents[0].data.userId).toBe('456');
        });
    });
});
