const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn } = require('../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../helpers/mock-factories');

const { PlatformEvents } = require('../../../../src/interfaces/PlatformEvents');
const { TwitchPlatform } = require('../../../../src/platforms/twitch');

class StubChatFileLoggingService {
    constructor() {
        this.logRawPlatformDataCalls = [];
        this.logRawPlatformData = async (...args) => {
            this.logRawPlatformDataCalls.push(args);
        };
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

describe('TwitchPlatform core behavior', () => {
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

    it('skips EventSub initialization when auth is not ready', async () => {
        const pendingAuth = { getState: () => 'PENDING' };
        platform = createPlatform({}, { authManager: pendingAuth, TwitchEventSub: createMockFn() });

        await platform.initializeEventSub();

        expect(platform.eventSub).toBeNull();
    });

    it('guards stream-status handlers so consumer errors are captured without throwing', () => {
        platform = createPlatform();
        platform.handlers = {
            onStreamStatus: () => { throw new Error('boom'); }
        };

        expect(() => platform.handleStreamOnlineEvent({ started_at: '2024-01-01T00:00:00Z' })).not.toThrow();
    });

    it('adds correlation metadata to stream-status events', () => {
        platform = createPlatform();
        let emittedPayload;
        platform.handlers = { onStreamStatus: (payload) => { emittedPayload = payload; } };

        platform.handleStreamOnlineEvent({ started_at: '2024-01-01T00:00:00Z' });

        expect(emittedPayload).toBeDefined();
        expect(emittedPayload.metadata).toBeDefined();
        expect(emittedPayload.metadata.correlationId).toEqual(expect.any(String));
    });

    it('does not emit stream status when stream online lacks started_at', () => {
        platform = createPlatform();
        const emitted = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === PlatformEvents.STREAM_STATUS) {
                emitted.push(payload.data);
            }
        });

        platform.handleStreamOnlineEvent({});

        expect(emitted).toHaveLength(0);
    });

    it('does not emit stream status when stream offline lacks timestamp', () => {
        platform = createPlatform();
        const emitted = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === PlatformEvents.STREAM_STATUS) {
                emitted.push(payload.data);
            }
        });

        platform.handleStreamOfflineEvent({});

        expect(emitted).toHaveLength(0);
    });

    it('logs raw platform data for non-chat events when enabled', async () => {
        platform = createPlatform({ dataLoggingEnabled: true });

        await platform.handleFollowEvent({
            userId: 'test-123',
            username: 'testuser123',
            displayName: 'Test User 123',
            timestamp: '2024-01-01T00:00:00Z'
        });

        expect(platform.chatFileLoggingService.logRawPlatformDataCalls).toHaveLength(1);
    });

    it('rejects sending messages when EventSub is unavailable', async () => {
        platform = createPlatform();

        await expect(platform.sendMessage('hello')).rejects.toThrow(/eventsub/i);
    });

    it('surfaces a friendly error when EventSub is disconnected before sending', async () => {
        platform = createPlatform();
        const sendMessageCalls = [];
        const mockEventSub = {
            sendMessage: (msg) => sendMessageCalls.push(msg),
            isConnected: () => false,
            isActive: () => false
        };
        platform.eventSub = mockEventSub;

        await expect(platform.sendMessage('hi')).rejects.toThrow(/unavailable/i);
        expect(sendMessageCalls).toHaveLength(0);
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
            await platform.onMessageHandler({
                chatter_user_id: 'test-1',
                chatter_user_name: 'testviewer1',
                broadcaster_user_id: 'broadcaster-1',
                message: { text: 'Hello world' },
                badges: {},
                timestamp: '2024-01-01T00:00:00Z'
            });
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
        const listenersAfterFirstInit = eventSubStub.listeners.chatMessage?.length || 0;

        await platform.initialize({});
        const listenersAfterSecondInit = eventSubStub.listeners.chatMessage?.length || 0;

        await platform.cleanup();

        expect(listenersAfterFirstInit).toBe(1);
        expect(listenersAfterSecondInit).toBe(1);
        expect(eventSubStub.listeners.chatMessage || []).toHaveLength(0);
        expect(platform.eventSubListeners).toEqual([]);
    });

    it('does not throw when viewer count stop fails during stream offline', () => {
        platform = createPlatform();
        platform.viewerCountProvider = {
            stopPolling: () => { throw new Error('stop failed'); }
        };

        expect(() => platform.handleStreamOfflineEvent({ timestamp: '2024-01-01T00:00:00Z' })).not.toThrow();
    });

    it('sends messages successfully when EventSub is connected and active', async () => {
        platform = createPlatform();
        const sendMessageCalls = [];
        const mockEventSub = {
            sendMessage: async (msg) => { sendMessageCalls.push(msg); },
            isConnected: () => true,
            isActive: () => true
        };
        platform.eventSub = mockEventSub;

        await platform.sendMessage('test message');

        expect(sendMessageCalls).toHaveLength(1);
        expect(sendMessageCalls[0]).toBe('test message');
    });

    it('returns connection state with EventSub active status', () => {
        platform = createPlatform();
        const mockEventSub = {
            isConnected: () => true,
            isActive: () => true
        };
        platform.eventSub = mockEventSub;

        const state = platform.getConnectionState();

        expect(state.status).toBe('connected');
        expect(state.eventSubActive).toBe(true);
        expect(state.platform).toBe('twitch');
    });

    it('returns stats with EventSub connection state', () => {
        platform = createPlatform();
        const mockEventSub = {
            isConnected: () => true,
            isActive: () => true
        };
        platform.eventSub = mockEventSub;

        const stats = platform.getStats();

        expect(stats.platform).toBe('twitch');
        expect(stats.connected).toBe(true);
        expect(stats.eventsub).toBe(true);
    });

    it('validates configuration and returns warnings for pending auth', () => {
        platform = createPlatform({}, { authManager: { getState: () => 'PENDING' } });

        const validation = platform.validateConfig();

        expect(validation.isValid).toBe(true);
        expect(validation.warnings.length).toBeGreaterThan(0);
    });

    it('returns configured status based on validation result', () => {
        platform = createPlatform();

        const isConfigured = platform.isConfigured();

        expect(isConfigured).toBe(true);
    });

    it('initializes viewer count provider when stream comes online', () => {
        platform = createPlatform();
        const startPollingCalls = [];
        const mockProvider = {
            startPolling: () => startPollingCalls.push(true)
        };
        platform.viewerCountProvider = mockProvider;
        platform.handlers = { onStreamStatus: () => {} };

        platform.handleStreamOnlineEvent({ started_at: '2024-01-01T00:00:00Z' });

        expect(startPollingCalls).toHaveLength(1);
    });

    it('returns zero viewer count when provider is not initialized', async () => {
        platform = createPlatform();
        platform.viewerCountProvider = null;

        const count = await platform.getViewerCount();

        expect(count).toBe(0);
    });

    it('returns zero viewer count when provider throws', async () => {
        platform = createPlatform();
        platform.viewerCountProvider = {
            getViewerCount: async () => { throw new Error('API error'); }
        };

        const count = await platform.getViewerCount();

        expect(count).toBe(0);
    });

    it('cleans up EventSub and resets connection state', async () => {
        platform = createPlatform();
        const cleanupCalls = [];
        const disconnectCalls = [];
        const mockEventSub = {
            removeAllListeners: () => {},
            cleanup: async () => { cleanupCalls.push(true); },
            disconnect: async () => { disconnectCalls.push(true); }
        };
        platform.eventSub = mockEventSub;
        platform.viewerCountProvider = { stopPolling: () => {} };

        await platform.cleanup();

        expect(cleanupCalls).toHaveLength(1);
        expect(disconnectCalls).toHaveLength(1);
        expect(platform.eventSub).toBeNull();
        expect(platform.isConnected).toBe(false);
    });

    it('emits connection events on EventSub state changes', () => {
        platform = createPlatform();
        const emitted = [];
        platform.on('platform:event', (payload) => {
            if (payload.type === PlatformEvents.PLATFORM_CONNECTION) {
                emitted.push(payload.data);
            }
        });

        platform._handleEventSubConnectionChange(true, { reason: 'session_welcome' });

        expect(emitted).toHaveLength(1);
        expect(emitted[0].status).toBe('connected');
        expect(platform.isConnected).toBe(true);
    });

    it('returns connection status with timestamp', async () => {
        platform = createPlatform();

        const status = await platform.getConnectionStatus();

        expect(status.platform).toBe('twitch');
        expect(status.status).toBe('disconnected');
        expect(status.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});
