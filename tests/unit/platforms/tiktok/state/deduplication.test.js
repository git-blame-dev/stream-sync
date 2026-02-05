const { describe, it, expect, afterEach, beforeEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const {
    useFakeTimers,
    useRealTimers,
    setSystemTime,
    advanceTimersByTime
} = require('../../../../helpers/bun-timers');
const { TikTokPlatform } = require('../../../../../src/platforms/tiktok');

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

describe('TikTokPlatform _shouldSkipDuplicatePlatformMessage', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    describe('basic deduplication', () => {
        it('returns isDuplicate=false for new messages', () => {
            const platform = createPlatform();

            const result = platform._shouldSkipDuplicatePlatformMessage({ common: { msgId: 'msg-1' } });

            expect(result.isDuplicate).toBe(false);
        });

        it('returns isDuplicate=true for duplicate messages within TTL', () => {
            const platform = createPlatform();

            platform._shouldSkipDuplicatePlatformMessage({ common: { msgId: 'msg-1' } });
            const result = platform._shouldSkipDuplicatePlatformMessage({ common: { msgId: 'msg-1' } });

            expect(result.isDuplicate).toBe(true);
        });

        it('returns isDuplicate=false for messages without msgId', () => {
            const platform = createPlatform();

            const result = platform._shouldSkipDuplicatePlatformMessage({ someOtherField: 'value' });

            expect(result.isDuplicate).toBe(false);
        });
    });

    describe('ttl expiry', () => {
        beforeEach(() => {
            useFakeTimers();
            setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
        });

        afterEach(() => {
            useRealTimers();
        });

        it('emits share again after the TTL elapses', async () => {
            const platform = createPlatform({}, { deduplicationTtlMs: 1000 });
            const shareEvents = [];
            platform.handlers = {
                ...platform.handlers,
                onShare: (data) => shareEvents.push(data)
            };

            const sharePayload = {
                user: {
                    userId: 'test-user-id-ttl',
                    uniqueId: 'test-user-ttl',
                    nickname: 'test-user-ttl'
                },
                displayType: 'share',
                common: { createTime: Date.parse('2025-01-15T12:00:00.000Z'), msgId: 'test-msg-ttl-1' }
            };

            await platform.handleTikTokSocial(sharePayload);
            await platform.handleTikTokSocial(sharePayload);

            expect(shareEvents).toHaveLength(1);

            advanceTimersByTime(1001);

            await platform.handleTikTokSocial(sharePayload);

            expect(shareEvents).toHaveLength(2);
        });
    });

    describe('cache cleanup with injectable threshold', () => {
        it('performs cleanup when cache exceeds maxCacheSize', () => {
            const platform = createPlatform({}, { deduplicationMaxCacheSize: 3 });

            platform._shouldSkipDuplicatePlatformMessage({ common: { msgId: 'msg-1' } });
            platform._shouldSkipDuplicatePlatformMessage({ common: { msgId: 'msg-2' } });
            platform._shouldSkipDuplicatePlatformMessage({ common: { msgId: 'msg-3' } });
            const result = platform._shouldSkipDuplicatePlatformMessage({ common: { msgId: 'msg-4' } });

            expect(result.cleanupPerformed).toBe(true);
        });

        it('does not perform cleanup when cache is within threshold', () => {
            const platform = createPlatform({}, { deduplicationMaxCacheSize: 10 });

            platform._shouldSkipDuplicatePlatformMessage({ common: { msgId: 'msg-1' } });
            platform._shouldSkipDuplicatePlatformMessage({ common: { msgId: 'msg-2' } });
            const result = platform._shouldSkipDuplicatePlatformMessage({ common: { msgId: 'msg-3' } });

            expect(result.cleanupPerformed).toBe(false);
        });

        it('uses default maxCacheSize of 2000 when not specified', () => {
            const platform = createPlatform();

            expect(platform.deduplicationConfig.maxCacheSize).toBe(2000);
        });

        it('uses injectable maxCacheSize when specified', () => {
            const platform = createPlatform({}, { deduplicationMaxCacheSize: 50 });

            expect(platform.deduplicationConfig.maxCacheSize).toBe(50);
        });
    });
});
