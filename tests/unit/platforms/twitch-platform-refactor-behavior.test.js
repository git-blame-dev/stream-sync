
const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { unmockModule, requireActual, restoreAllModuleMocks, resetModules } = require('../../helpers/bun-module-mocks');

unmockModule('../../../src/platforms/twitch');

const { TwitchPlatform } = requireActual('../../../src/platforms/twitch');

const createLogger = () => ({
    info: createMockFn(),
    warn: createMockFn(),
    error: createMockFn(),
    debug: createMockFn()
});

class StubChatFileLoggingService {
    constructor() {
        this.logRawPlatformData = createMockFn().mockResolvedValue();
    }
}

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

describe('TwitchPlatform refactor behavior', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    const baseConfig = {
        enabled: true,
        username: 'streamer',
        channel: 'streamer',
        eventsub_enabled: true,
        dataLoggingEnabled: false
    };

    const buildPlatform = (overrides = {}) => {
        const logger = overrides.logger || createLogger();
        const authManager = overrides.authManager || { getState: () => 'READY' };

        return new TwitchPlatform(
            { ...baseConfig, ...overrides.config },
            {
                ...overrides.dependencies,
                authManager,
                logger,
                timestampService: overrides.dependencies?.timestampService || {
                    extractTimestamp: createMockFn(() => new Date().toISOString())
                },
                ChatFileLoggingService: StubChatFileLoggingService
            }
        );
    };

    it('treats configuration as valid when authManager is READY without client credentials', () => {
        const platform = buildPlatform({
            config: { clientId: undefined, accessToken: undefined }
        });

        const validation = platform.validateConfig();

        expect(validation.isValid).toBe(true);
        expect(validation.errors).toEqual([]);
    });

    it('marks non-ready auth state as a warning instead of an invalid config', () => {
        const platform = buildPlatform({
            authManager: { getState: () => 'PENDING' }
        });

        const validation = platform.validateConfig();

        expect(validation.isValid).toBe(true);
        expect(validation.errors).toEqual([]);
        expect(validation.warnings.some(msg => msg.toLowerCase().includes('authmanager') && msg.toLowerCase().includes('ready'))).toBe(true);
    });

    it('guards stream-status handlers so consumer errors are captured without throwing', () => {
        const logger = createLogger();
        const platform = buildPlatform({ logger });

        platform.handlers = {
            onStreamStatus: () => {
                throw new Error('boom');
            }
        };

        expect(() => platform.handleStreamOnlineEvent({ timestamp: '2024-01-01T00:00:00Z' })).not.toThrow();
        expect(logger.error.mock.calls.length).toBeGreaterThan(0);
    });

    it('adds correlation metadata to stream-status events', () => {
        const platform = buildPlatform();
        let emittedPayload;
        platform.handlers = {
            onStreamStatus: (payload) => {
                emittedPayload = payload;
            }
        };

        platform.handleStreamOnlineEvent({ timestamp: '2024-01-01T00:00:00Z' });

        expect(emittedPayload).toBeDefined();
        expect(emittedPayload.metadata).toBeDefined();
        expect(emittedPayload.metadata.correlationId).toEqual(expect.any(String));
    });

    it('logs raw platform data for non-chat events when enabled', async () => {
        const platform = buildPlatform({
            config: { dataLoggingEnabled: true }
        });
        const loggingSpy = platform.chatFileLoggingService.logRawPlatformData;

        await platform.handleFollowEvent({
            userId: '123',
            username: 'user123',
            displayName: 'User 123',
            timestamp: '2024-01-01T00:00:00Z'
        });

        expect(loggingSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects sending messages when EventSub is unavailable', async () => {
        const platform = buildPlatform();

        await expect(platform.sendMessage('hello')).rejects.toThrow(/eventsub/i);
    });

    it('surfaces a friendly error when EventSub is disconnected before sending', async () => {
        const platform = buildPlatform();
        const errorReports = [];
        platform.errorHandler.handleMessageSendError = (err, context) => errorReports.push({ err, context });
        const mockEventSub = {
            sendMessage: createMockFn(),
            isConnected: () => false,
            isActive: () => false
        };
        platform.eventSub = mockEventSub;

        await expect(platform.sendMessage('hi')).rejects.toThrow(/unavailable/i);

        expect(errorReports.length).toBe(1);
        expect(mockEventSub.sendMessage).not.toHaveBeenCalled();
    });

    it('keeps emitting chat events and handles logging rejections', async () => {
        const platform = buildPlatform({
            config: { dataLoggingEnabled: true }
        });
        const loggingError = new Error('disk full');
        platform._logRawEvent = createMockFn().mockRejectedValue(loggingError);
        const loggingIssues = [];
        platform.errorHandler.handleDataLoggingError = (err, type) => loggingIssues.push({ err, type });
        let emittedChat;

        platform.handlers = {
            onChat: (payload) => {
                emittedChat = payload;
            }
        };

        const unhandled = [];
        const listener = (err) => unhandled.push(err);
        process.on('unhandledRejection', listener);

        try {
            await platform.onMessageHandler(
                '#chan',
                { username: 'viewer1', 'display-name': 'Viewer1', 'user-id': '1', mod: false, subscriber: false },
                'Hello world',
                false
            );
            await flushAsync();
        } finally {
            process.off('unhandledRejection', listener);
        }

        expect(emittedChat.message).toEqual({ text: 'Hello world' });
        expect(loggingIssues.length).toBe(1);
        expect(unhandled).toHaveLength(0);
    });

    it('emits canonical raid payloads without duplicate user fields', async () => {
        const platform = buildPlatform();
        let emittedRaid;
        platform.handlers = {
            onRaid: (payload) => {
                emittedRaid = payload;
            }
        };

        await platform.handleRaidEvent({
            username: 'raider',
            displayName: 'Raider',
            userId: 'r1',
            viewerCount: 42,
            timestamp: '2024-01-01T00:00:00Z'
        });

        expect(emittedRaid.username).toBe('raider');
        expect(emittedRaid.raider).toBeUndefined();
    });

    it('cleans up EventSub listeners and prevents double-binding on reinitialize', async () => {
        const eventSubStub = (() => {
            const listeners = {};
            return {
                listeners,
                on: createMockFn((event, handler) => {
                    listeners[event] = listeners[event] || [];
                    listeners[event].push(handler);
                }),
                off: createMockFn((event, handler) => {
                    listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
                }),
                removeListener: createMockFn((event, handler) => {
                    listeners[event] = (listeners[event] || []).filter((h) => h !== handler);
                }),
                removeAllListeners: createMockFn(() => {
                    Object.keys(listeners).forEach((key) => delete listeners[key]);
                }),
                initialize: createMockFn().mockResolvedValue(),
                cleanup: createMockFn().mockResolvedValue(),
                disconnect: createMockFn().mockResolvedValue(),
                isConnected: createMockFn(() => true)
            };
        })();

        const platform = buildPlatform({
            dependencies: {
                TwitchEventSub: createMockFn(() => eventSubStub)
            },
            authManager: {
                getState: () => 'READY',
                initialize: createMockFn().mockResolvedValue()
            }
        });

        await platform.initialize({});
        const listenersAfterFirstInit = eventSubStub.listeners.message.length;

        await platform.initialize({});
        const listenersAfterSecondInit = eventSubStub.listeners.message.length;

        await platform.cleanup();

        expect(listenersAfterFirstInit).toBe(1);
        expect(listenersAfterSecondInit).toBe(1);
        expect(eventSubStub.listeners.message || []).toHaveLength(0);
        expect(platform.eventSubListeners).toEqual([]);
    });

    it('reports viewer count stop failures without crashing during stream offline', () => {
        const platform = buildPlatform();
        const stopError = new Error('stop failed');
        const cleanupIssues = [];
        platform.errorHandler.handleCleanupError = (err, resource) => cleanupIssues.push({ err, resource });
        platform.viewerCountProvider = {
            stopPolling: () => {
                throw stopError;
            }
        };

        expect(() => platform.handleStreamOfflineEvent({ timestamp: '2024-01-01T00:00:00Z' })).not.toThrow();
        expect(cleanupIssues.length).toBe(1);
    });
});
