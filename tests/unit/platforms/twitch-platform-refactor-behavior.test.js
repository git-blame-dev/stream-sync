const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');

const { TwitchPlatform } = require('../../../src/platforms/twitch');

const noOpLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

class StubChatFileLoggingService {
    constructor() {
        this.logRawPlatformData = createMockFn().mockResolvedValue();
    }
}

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

const createPlatform = (configOverrides = {}, depsOverrides = {}) => {
    const config = {
        enabled: true,
        username: 'teststreamer',
        channel: 'teststreamer',
        eventsub_enabled: true,
        dataLoggingEnabled: false,
        ...configOverrides
    };
    const authManager = depsOverrides.authManager || { getState: () => 'READY' };

    return new TwitchPlatform(config, {
        logger: noOpLogger,
        authManager,
        timestampService: { extractTimestamp: () => new Date().toISOString() },
        ChatFileLoggingService: StubChatFileLoggingService,
        ...depsOverrides
    });
};

describe('TwitchPlatform refactor behavior', () => {
    let platform;

    afterEach(() => {
        if (platform?.cleanup) {
            platform.cleanup().catch(() => {});
        }
    });

    it('treats configuration as valid when authManager is READY without client credentials', () => {
        platform = createPlatform({ clientId: undefined, accessToken: undefined });

        const validation = platform.validateConfig();

        expect(validation.isValid).toBe(true);
        expect(validation.errors).toEqual([]);
    });

    it('marks non-ready auth state as a warning instead of an invalid config', () => {
        platform = createPlatform({}, { authManager: { getState: () => 'PENDING' } });

        const validation = platform.validateConfig();

        expect(validation.isValid).toBe(true);
        expect(validation.errors).toEqual([]);
        expect(validation.warnings.some((msg) => msg.toLowerCase().includes('authmanager') && msg.toLowerCase().includes('ready'))).toBe(true);
    });

    it('guards stream-status handlers so consumer errors are captured without throwing', () => {
        platform = createPlatform();
        platform.handlers = {
            onStreamStatus: () => { throw new Error('boom'); }
        };

        expect(() => platform.handleStreamOnlineEvent({ timestamp: '2024-01-01T00:00:00Z' })).not.toThrow();
    });

    it('adds correlation metadata to stream-status events', () => {
        platform = createPlatform();
        let emittedPayload;
        platform.handlers = { onStreamStatus: (payload) => { emittedPayload = payload; } };

        platform.handleStreamOnlineEvent({ timestamp: '2024-01-01T00:00:00Z' });

        expect(emittedPayload).toBeDefined();
        expect(emittedPayload.metadata).toBeDefined();
        expect(emittedPayload.metadata.correlationId).toEqual(expect.any(String));
    });

    it('logs raw platform data for non-chat events when enabled', async () => {
        platform = createPlatform({ dataLoggingEnabled: true });
        const loggingSpy = platform.chatFileLoggingService.logRawPlatformData;

        await platform.handleFollowEvent({
            userId: 'test-123',
            username: 'testuser123',
            displayName: 'Test User 123',
            timestamp: '2024-01-01T00:00:00Z'
        });

        expect(loggingSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects sending messages when EventSub is unavailable', async () => {
        platform = createPlatform();

        await expect(platform.sendMessage('hello')).rejects.toThrow(/eventsub/i);
    });

    it('surfaces a friendly error when EventSub is disconnected before sending', async () => {
        platform = createPlatform();
        const mockEventSub = {
            sendMessage: createMockFn(),
            isConnected: () => false,
            isActive: () => false
        };
        platform.eventSub = mockEventSub;

        await expect(platform.sendMessage('hi')).rejects.toThrow(/unavailable/i);
        expect(mockEventSub.sendMessage).not.toHaveBeenCalled();
    });

    it('keeps emitting chat events when logging fails', async () => {
        platform = createPlatform({ dataLoggingEnabled: true });
        platform._logRawEvent = createMockFn().mockRejectedValue(new Error('disk full'));
        let emittedChat;
        platform.handlers = { onChat: (payload) => { emittedChat = payload; } };

        const unhandled = [];
        const listener = (err) => unhandled.push(err);
        process.on('unhandledRejection', listener);

        try {
            await platform.onMessageHandler(
                '#chan',
                { username: 'testviewer1', 'display-name': 'TestViewer1', 'user-id': 'test-1', mod: false, subscriber: false },
                'Hello world',
                false
            );
            await flushAsync();
        } finally {
            process.off('unhandledRejection', listener);
        }

        expect(emittedChat.message).toEqual({ text: 'Hello world' });
        expect(unhandled).toHaveLength(0);
    });

    it('emits canonical raid payloads without duplicate user fields', async () => {
        platform = createPlatform();
        let emittedRaid;
        platform.handlers = { onRaid: (payload) => { emittedRaid = payload; } };

        await platform.handleRaidEvent({
            username: 'testraider',
            displayName: 'TestRaider',
            userId: 'test-r1',
            viewerCount: 42,
            timestamp: '2024-01-01T00:00:00Z'
        });

        expect(emittedRaid.username).toBe('testraider');
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

        platform = createPlatform({}, {
            TwitchEventSub: createMockFn(() => eventSubStub),
            authManager: { getState: () => 'READY', initialize: createMockFn().mockResolvedValue() }
        });

        await platform.initialize({});
        const listenersAfterFirstInit = eventSubStub.listeners.message?.length || 0;

        await platform.initialize({});
        const listenersAfterSecondInit = eventSubStub.listeners.message?.length || 0;

        await platform.cleanup();

        expect(listenersAfterFirstInit).toBe(1);
        expect(listenersAfterSecondInit).toBe(1);
        expect(eventSubStub.listeners.message || []).toHaveLength(0);
        expect(platform.eventSubListeners).toEqual([]);
    });

    it('does not throw when viewer count stop fails during stream offline', () => {
        platform = createPlatform();
        platform.viewerCountProvider = {
            stopPolling: () => { throw new Error('stop failed'); }
        };

        expect(() => platform.handleStreamOfflineEvent({ timestamp: '2024-01-01T00:00:00Z' })).not.toThrow();
    });
});
