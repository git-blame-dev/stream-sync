const { describe, test, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const {
    cleanupTikTokEventListeners,
    setupTikTokEventListeners
} = require('../../../../../src/platforms/tiktok/events/event-router');

describe('TikTok event router connection lifecycle', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const createPlatformHarness = (overrides = {}) => {
        const listeners = {};
        const emitted = [];
        const retryCalls = [];
        const disconnectionEvents = [];

        const connection = {
            on: createMockFn((eventName, handler) => {
                listeners[eventName] = handler;
            }),
            removeAllListeners: createMockFn()
        };

        const platform = {
            listenersConfigured: false,
            connection,
            WebcastEvent: {
                CHAT: 'chat',
                GIFT: 'gift',
                FOLLOW: 'follow',
                SOCIAL: 'social',
                ROOM_USER: 'roomUser',
                ENVELOPE: 'envelope',
                SUBSCRIBE: 'subscribe',
                SUPER_FAN: 'superfan',
                ERROR: 'error',
                DISCONNECT: 'disconnect',
                STREAM_END: 'streamEnd'
            },
            ControlEvent: {
                CONNECTED: 'connected',
                DISCONNECTED: 'disconnected',
                ERROR: 'control-error'
            },
            platformName: 'tiktok',
            timestampService: null,
            selfMessageDetectionService: null,
            config: { enabled: true, dataLoggingEnabled: false },
            logger: noOpLogger,
            errorHandler: {
                handleConnectionError: createMockFn(),
                handleEventProcessingError: createMockFn(),
                handleCleanupError: createMockFn()
            },
            constructor: {
                resolveEventTimestampMs: createMockFn(() => null)
            },
            _logIncomingEvent: createMockFn().mockResolvedValue(),
            _emitPlatformEvent: (type, payload) => emitted.push({ type, payload }),
            _handleStandardEvent: createMockFn().mockResolvedValue(),
            _handleStreamEnd: createMockFn().mockImplementation(async () => {
                disconnectionEvents.push({ handler: 'streamEnd' });
            }),
            handleConnectionIssue: createMockFn().mockImplementation(async () => {
                disconnectionEvents.push({ handler: 'connectionIssue' });
            }),
            handleConnectionError: createMockFn(),
            handleRetry: createMockFn().mockImplementation(() => {
                retryCalls.push({ source: 'handleRetry' });
                return { action: 'retry-queued' };
            }),
            queueRetry: createMockFn().mockImplementation(() => {
                retryCalls.push({ source: 'queueRetry' });
                return { queued: true };
            }),
            handleTikTokGift: createMockFn().mockResolvedValue(),
            handleTikTokFollow: createMockFn().mockResolvedValue(),
            handleTikTokSocial: createMockFn().mockResolvedValue(),
            connectionActive: false,
            cachedViewerCount: 0,
            connectionTime: 0,
            _getTimestamp: createMockFn(() => '2025-01-02T03:04:05.000Z'),
            _handleChatMessage: createMockFn().mockResolvedValue(),
            ...overrides
        };

        return { platform, connection, listeners, emitted, retryCalls, disconnectionEvents };
    };

    describe('error event deduplication', () => {
        test('retry should only be queued once when both error events fire', async () => {
            const { platform, listeners, retryCalls } = createPlatformHarness({
                connectionActive: true
            });

            setupTikTokEventListeners(platform);

            const error = new Error('connection-lost');

            // Both events fire (as can happen in real scenarios)
            listeners[platform.ControlEvent.ERROR](error);
            listeners[platform.WebcastEvent.ERROR](error);

            // Should only queue retry once, not twice
            expect(retryCalls.length).toBe(1);
        });
    });

    describe('rawData listener cleanup', () => {
        test('rawData listener should be removed during cleanup', () => {
            const removeAllListeners = createMockFn();
            const platform = {
                connection: { removeAllListeners },
                listenersConfigured: true,
                WebcastEvent: {
                    CHAT: 'chat',
                    GIFT: 'gift',
                    FOLLOW: 'follow',
                    ROOM_USER: 'roomUser',
                    ENVELOPE: 'envelope',
                    SUBSCRIBE: 'subscribe',
                    SUPER_FAN: 'superfan',
                    SOCIAL: 'social',
                    ERROR: 'error',
                    DISCONNECT: 'disconnect',
                    STREAM_END: 'streamEnd'
                },
                ControlEvent: {
                    CONNECTED: 'connected',
                    DISCONNECTED: 'disconnected',
                    ERROR: 'control-error'
                },
                errorHandler: { handleCleanupError: createMockFn() }
            };

            cleanupTikTokEventListeners(platform);

            // Collect all event types that were cleaned up
            const cleanedEvents = removeAllListeners.mock.calls.map((call) => call[0]);

            // rawData should be included in cleanup
            expect(cleanedEvents).toContain('rawData');
        });
    });

    describe('DISCONNECT resets listenersConfigured', () => {
        test('listenersConfigured should be set to false on DISCONNECT', async () => {
            // Start with listenersConfigured: false so setupTikTokEventListeners actually runs
            const { platform, listeners } = createPlatformHarness({
                connectionActive: true
            });

            setupTikTokEventListeners(platform);

            // Verify listeners were configured
            expect(platform.listenersConfigured).toBe(true);

            // Trigger DISCONNECT
            listeners[platform.WebcastEvent.DISCONNECT]();

            // listenersConfigured should be false so reconnect can reattach listeners
            expect(platform.listenersConfigured).toBe(false);
        });
    });

    describe('DISCONNECT triggers proper handling', () => {
        test('DISCONNECT should trigger handleConnectionIssue', async () => {
            // Start with listenersConfigured: false so setup runs
            const { platform, listeners, disconnectionEvents } = createPlatformHarness({
                connectionActive: true
            });

            setupTikTokEventListeners(platform);

            // Trigger DISCONNECT
            await listeners[platform.WebcastEvent.DISCONNECT]();

            // Should call handleConnectionIssue (not just log)
            // The mock handleConnectionIssue pushes to disconnectionEvents
            expect(disconnectionEvents.length).toBeGreaterThan(0);
            expect(disconnectionEvents[0].handler).toBe('connectionIssue');

            // Verify handleConnectionIssue was called
            expect(platform.handleConnectionIssue.mock.calls.length).toBe(1);
        });
    });

    describe('routes both DISCONNECTED and STREAM_END events', () => {
        test('event-router routes both events to handlers', async () => {
            const { platform, listeners } = createPlatformHarness({
                connectionActive: true
            });

            setupTikTokEventListeners(platform);

            // Simulate 4404: websocket emits both disconnected and streamEnd
            listeners[platform.ControlEvent.DISCONNECTED]({ code: 4404, reason: 'stream not live' });
            await listeners[platform.WebcastEvent.STREAM_END]({ code: 4404 });

            // Event-router routes both events to handlers
            // Deduplication is the platform's responsibility (tested in tiktok-connection-lifecycle.test.js)
            expect(platform.handleConnectionIssue.mock.calls.length).toBe(1);
            expect(platform._handleStreamEnd.mock.calls.length).toBe(1);
        });
    });
});
