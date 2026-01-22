const { describe, it, expect, beforeEach, afterEach, beforeAll } = require('bun:test');
const { createMockFn, restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');
const { unmockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');
const { noOpLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const { expectNoTechnicalArtifacts } = require('../../helpers/assertion-helpers');
const { createTwitchFollowEvent } = require('../../helpers/twitch-test-data');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

unmockModule('../../../src/platforms/twitch');
unmockModule('../../../src/platforms/twitch-eventsub');
unmockModule('../../../src/utils/retry-system');
unmockModule('../../../src/core/logging');
unmockModule('../../../src/utils/platform-connection-state');
unmockModule('../../../src/utils/api-clients/twitch-api-client');
unmockModule('../../../src/utils/viewer-count-providers');

describe('Twitch Platform', () => {
    beforeAll(() => {
        restoreAllModuleMocks();
        resetModules();
    });

    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    let TwitchPlatform;
    let mockTwitchEventSub;
    let mockAuthManager;
    let mockApiClient;
    let mockViewerCountProvider;
    let mockLogger;
    let mockApp;
    let platform;
    let config;
    let platformHandlers;
    let mockEventBus;
    let router;
    let runtime;

    beforeEach(() => {
        mockLogger = noOpLogger;
        mockAuthManager = {
            getState: createMockFn().mockReturnValue('READY'),
            getAccessToken: createMockFn().mockResolvedValue('mock-access-token'),
            refreshToken: createMockFn().mockResolvedValue('new-access-token'),
            validateToken: createMockFn().mockResolvedValue(true),
            initialize: createMockFn().mockResolvedValue()
        };
        mockApiClient = {
            getChannelInfo: createMockFn().mockResolvedValue({ id: '123456', name: 'testchannel' }),
            getViewerCount: createMockFn().mockResolvedValue(1500),
            sendChatMessage: createMockFn().mockResolvedValue()
        };
        mockViewerCountProvider = {
            getViewerCount: createMockFn().mockResolvedValue(1500),
            startPolling: createMockFn(),
            stopPolling: createMockFn()
        };
        mockApp = {
            handleChatMessage: createMockFn(),
            handleFollowNotification: createMockFn(),
            handlePaypiggyNotification: createMockFn(),
            updateViewerCount: createMockFn()
        };

        mockTwitchEventSub = {
            initialize: createMockFn().mockResolvedValue(),
            connect: createMockFn().mockResolvedValue(),
            disconnect: createMockFn().mockResolvedValue(),
            on: createMockFn(),
            emit: createMockFn(),
            isConnected: createMockFn().mockReturnValue(true),
            sendMessage: createMockFn().mockResolvedValue()
        };

        const { TwitchPlatform: RealTwitchPlatform } = require('../../../src/platforms/twitch');
        TwitchPlatform = RealTwitchPlatform;

        config = {
            enabled: true,
            username: 'testuser',
            channel: 'testchannel',
            eventsub_enabled: true,
            dataLoggingEnabled: false,
            viewerCountEnabled: true
        };

        platform = new TwitchPlatform(config, {
            TwitchEventSub: createMockFn().mockImplementation(() => mockTwitchEventSub),
            authManager: mockAuthManager,
            notificationBridge: mockApp,
            logger: mockLogger,
            timestampService: {
                extractTimestamp: createMockFn(() => new Date().toISOString())
            }
        });

        platformHandlers = {
            onChat: createMockFn(),
            onFollow: createMockFn(),
            onPaypiggy: createMockFn(),
            onGift: createMockFn(),
            onGiftPaypiggy: createMockFn(),
            onRaid: createMockFn(),
            onStreamStatus: createMockFn()
        };

        mockEventBus = {
            emitted: [],
            emit: createMockFn((type, payload) => mockEventBus.emitted.push({ type, payload }))
        };

        runtime = {
            handleChatMessage: createMockFn(),
            handleFollowNotification: createMockFn(),
            handlePaypiggyNotification: createMockFn(),
            handleGiftNotification: createMockFn(),
            handleRaidNotification: createMockFn()
        };

        mockEventBus.handlers = {};
        mockEventBus.subscribe = (eventName, handler) => {
            mockEventBus.handlers[eventName] = mockEventBus.handlers[eventName] || [];
            mockEventBus.handlers[eventName].push(handler);
            return () => {
                mockEventBus.handlers[eventName] = mockEventBus.handlers[eventName].filter(h => h !== handler);
            };
        };
        mockEventBus.emit = (eventName, payload) => {
            (mockEventBus.handlers[eventName] || []).forEach(handler => handler(payload));
            mockEventBus.emitted.push({ eventName, payload });
        };

        platform.apiClient = mockApiClient;
        platform.viewerCountProvider = mockViewerCountProvider;
        platform.handlers = platformHandlers;

        const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');
        router = new PlatformEventRouter({
            eventBus: mockEventBus,
            runtime,
            notificationManager: mockApp,
            configService: { areNotificationsEnabled: createMockFn(() => true) },
            logger: mockLogger
        });
    });

    describe('when initializing', () => {
        it('should accept valid configuration for user stream connection', () => {
            const validConfig = {
                enabled: true,
                username: 'testuser',
                channel: 'testchannel',
                eventsub_enabled: true
            };

            const testPlatform = new TwitchPlatform(validConfig, { authManager: mockAuthManager });
            const validation = testPlatform.validateConfig();

            expect(validation.isValid).toBe(true);
            expect(validation.errors).toEqual([]);
        });

        it('should prevent connection when critical configuration is missing', () => {
            const invalidConfig = {};

            const invalidPlatform = new TwitchPlatform(invalidConfig, { authManager: mockAuthManager });
            const validation = invalidPlatform.validateConfig();

            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('username: Username is required for Twitch authentication');
            expectNoTechnicalArtifacts(validation.errors.join(' '));
        });

        it('should ensure user experience fails gracefully without auth dependencies', () => {
            expect(() => {
                new TwitchPlatform(config, {});
            }).toThrow('TwitchPlatform requires authManager via dependency injection');
        });
    });

    describe('when initializing EventSub for real-time events', () => {
        it('should enable real-time event notifications when user has EventSub configured', async () => {
            platform.config.eventsub_enabled = true;
            mockAuthManager.getState.mockReturnValue('READY');

            await platform.initializeEventSub();

            expect(platform.config.eventsub_enabled).toBe(true);
            expect(mockAuthManager.getState).toHaveBeenCalled();
        });

        it('should operate without real-time events when user disables EventSub', async () => {
            platform.config.eventsub_enabled = false;

            await platform.initializeEventSub();

            expect(platform.eventsub).toBeUndefined();
        });

        it('should delay EventSub until authentication completes for user security', async () => {
            mockAuthManager.getState.mockReturnValue('PENDING');

            await platform.initializeEventSub();

            expect(platform.eventsub).toBeUndefined();
        });
    });

    describe('when connecting', () => {
        it('should establish connection successfully', async () => {
            const handlers = {
                onChatMessage: createMockFn(),
                onFollowNotification: createMockFn(),
                onPaypiggyNotification: createMockFn()
            };

            await platform.initialize(handlers);

            expect(mockTwitchEventSub.initialize).toHaveBeenCalled();
            expect(platform.handlers).toEqual(handlers);
        });

        it('should handle connection errors gracefully', async () => {
            const connectionError = new Error('Connection failed');
            mockTwitchEventSub.initialize.mockRejectedValue(connectionError);

            const handlers = {};

            await platform.initialize(handlers);

            expect(platform.eventsub).toBeUndefined();
        });

        it('should prepare to receive all user events after connection', async () => {
            const handlers = {
                onChatMessage: createMockFn(),
                onFollowNotification: createMockFn(),
                onPaypiggyNotification: createMockFn()
            };

            await platform.initialize(handlers);

            expect(platform.handlers).toBeDefined();
            expect(platform.handlers.onChatMessage).toBeDefined();
            expect(platform.handlers.onFollowNotification).toBeDefined();
            expect(platform.handlers.onPaypiggyNotification).toBeDefined();
        });
    });

    describe('when handling chat messages', () => {
        it('should display chat messages to viewers in real-time', async () => {
            const chatMessage = 'Hello world!';
            const chatUser = 'chatuser';

            await platform.onMessageHandler({
                chatter_user_id: 'chat-user-1',
                chatter_user_name: chatUser,
                broadcaster_user_id: 'broadcaster-1',
                message: { text: chatMessage },
                badges: {},
                timestamp: '2024-01-01T00:00:00Z'
            });

            const messageCall = mockApp.handleChatMessage.mock.calls[0];
            if (messageCall) {
                const [platformName, messageData] = messageCall;
                expect(platformName).toBe('twitch');
                expect(messageData.message).toBe('Hello world!');
                expect(messageData.username).toBe('chatuser');
                expectNoTechnicalArtifacts(messageData.message);
                expectNoTechnicalArtifacts(messageData.username);
            }
        });

        it('should prevent echo when bot sends its own messages', async () => {
            const selfMessage = 'Bot response';

            await platform.onMessageHandler({
                chatter_user_id: 'broadcaster-1',
                chatter_user_name: 'testuser',
                broadcaster_user_id: 'broadcaster-1',
                message: { text: selfMessage },
                badges: {},
                timestamp: '2024-01-01T00:00:01Z'
            });

            const messageCount = mockApp.handleChatMessage.mock.calls.length;
            expect(messageCount).toBe(0);
        });

        it('should preserve emojis and special characters for user expression', async () => {
            const messageWithEmojis = 'Hello 🌟 world! 🎉';

            await platform.onMessageHandler({
                chatter_user_id: 'chat-user-2',
                chatter_user_name: 'chatuser',
                broadcaster_user_id: 'broadcaster-1',
                message: { text: messageWithEmojis },
                badges: {},
                timestamp: '2024-01-01T00:00:02Z'
            });

            const messageCall = mockApp.handleChatMessage.mock.calls[0];
            if (messageCall) {
                const [, messageData] = messageCall;
                expect(messageData.message).toBe(messageWithEmojis);
                expect(messageData.message).toContain('🌟');
                expect(messageData.message).toContain('🎉');
                expectNoTechnicalArtifacts(messageData.username);
            }
        });
    });

    describe('when handling follow events', () => {
        it('should display follow notification to user when someone follows', async () => {
            const followEvent = createTwitchFollowEvent({
                username: 'newfollower',
                userId: 'follow-user-1',
                displayName: 'New Follower',
                timestamp: new Date().toISOString()
            });

            await platform.handleFollowEvent(followEvent);

            expect(platformHandlers.onFollow).toHaveBeenCalledTimes(1);
            const payload = platformHandlers.onFollow.mock.calls[0][0];
            expect(payload.platform).toBe('twitch');
            expect(payload.username).toBe('newfollower');
            expectNoTechnicalArtifacts(payload.username);
            expect(payload.timestamp).toBeDefined();
        });

        it('should maintain stability when receiving malformed follow events', async () => {
            const incompleteEvent = {};

            await platform.handleFollowEvent(incompleteEvent);

            expect(platform).toBeDefined();
            expect(mockApp.handleFollowNotification.mock.calls.length).toBe(0);
        });
    });

    describe('when handling subscription events', () => {
        it('should display subscription notification when viewer subscribes', async () => {
            const subEvent = {
                username: 'subscriber',
                userId: 'sub-user-1',
                tier: '1000',
                timestamp: '2024-01-01T00:00:00Z'
            };

            await platform.handlePaypiggyEvent(subEvent);

            expect(platformHandlers.onPaypiggy).toHaveBeenCalledTimes(1);
            const payload = platformHandlers.onPaypiggy.mock.calls[0][0];
            expect(payload.platform).toBe('twitch');
            expect(payload.username).toBe('subscriber');
            expectNoTechnicalArtifacts(payload.username);
            expect(payload.tier).toBe('1000');
        });

        it('should display gift subscription events with gifter name', async () => {
            const giftSubscriptionEvent = {
                username: 'gifter',
                userId: 'gifter-user-1',
                tier: '2000',
                timestamp: '2024-01-01T00:00:00Z'
            };

            await platform.handlePaypiggyEvent(giftSubscriptionEvent);

            expect(platformHandlers.onPaypiggy).toHaveBeenCalledTimes(1);
            const payload = platformHandlers.onPaypiggy.mock.calls[0][0];
            expect(payload.username).toBe('gifter');
            expectNoTechnicalArtifacts(payload.username);
            expect(payload.tier).toBe('2000');
        });

        it('should route resubscription events through the subscription handler', async () => {
            const resubEvent = {
                username: 'resubber',
                displayName: 'Resub User',
                userId: 'user123',
                tier: '3000',
                message: 'Back again!',
                months: 10,
                timestamp: '2024-01-01T00:00:00Z'
            };

            await platform.handlePaypiggyMessageEvent(resubEvent);

            expect(platformHandlers.onPaypiggy).toHaveBeenCalledTimes(1);
            const payload = platformHandlers.onPaypiggy.mock.calls[0][0];
            expect(payload.username).toBe('resubber');
            expect(payload.message).toBe('Back again!');
            expect(payload.months).toBe(10);
        });

        it('should route subscription gift events through the giftpaypiggy handler', async () => {
            const giftEvent = {
                username: 'gifter',
                displayName: 'Gifter',
                userId: 'gift123',
                tier: '1000',
                giftCount: 3,
                timestamp: '2024-01-02T00:00:00Z'
            };

            await platform.handlePaypiggyGiftEvent(giftEvent);

            expect(platformHandlers.onGiftPaypiggy).toHaveBeenCalledTimes(1);
            const payload = platformHandlers.onGiftPaypiggy.mock.calls[0][0];
            expect(payload.username).toBe('gifter');
            expect(payload.giftCount).toBe(3);
            expect(payload.tier).toBe('1000');
        });

        it('emits error payload when gift subscription is missing giftCount', async () => {
            const giftEvent = {
                username: 'gifter',
                displayName: 'Gifter',
                userId: 'gift123',
                tier: '1000',
                timestamp: '2024-01-02T00:00:00Z'
            };

            await platform.handlePaypiggyGiftEvent(giftEvent);

            expect(platformHandlers.onGiftPaypiggy).toHaveBeenCalledTimes(1);
            const payload = platformHandlers.onGiftPaypiggy.mock.calls[0][0];
            expect(payload).toMatchObject({
                platform: 'twitch',
                username: 'gifter',
                userId: 'gift123'
            });
            expect(payload).not.toHaveProperty('giftCount');
            expect(payload.timestamp).toEqual(expect.any(String));
        });
    });

    describe('when handling EventSub lifecycle', () => {
        it('should set connection flags on EventSub connect/disconnect events', async () => {
            await platform.initialize(platformHandlers);

            const connectedHandler = mockTwitchEventSub.on.mock.calls.find(call => call[0] === 'eventSubConnected')[1];
            const disconnectedHandler = mockTwitchEventSub.on.mock.calls.find(call => call[0] === 'eventSubDisconnected')[1];

            await connectedHandler();
            expect(platform.isConnected).toBe(true);
            expect(platform.isConnecting).toBe(false);
            const connectedState = platform.getConnectionState();
            expect(connectedState.status).toBe('connected');

            await disconnectedHandler();
            mockTwitchEventSub.isConnected.mockReturnValue(false);
            expect(platform.isConnected).toBe(false);
            expect(platform.isConnecting).toBe(false);
            const disconnectedState = platform.getConnectionState();
            expect(['disconnected', 'connecting'].includes(disconnectedState.status)).toBe(true);
        });

        it('emits platform connection events for EventSub lifecycle', async () => {
            await platform.initialize(platformHandlers);

            const emitSpy = spyOn(platform, 'emit');
            const connectedHandler = mockTwitchEventSub.on.mock.calls.find(call => call[0] === 'eventSubConnected')[1];

            await connectedHandler({ reason: 'session_welcome' });

            const connectionEvent = emitSpy.mock.calls.find(call => call[0] === 'platform:event');
            expect(connectionEvent).toBeDefined();
            expect(connectionEvent[1].type).toBe('platform:connection');
            expect(platformHandlers.onStreamStatus).not.toHaveBeenCalled();
        });
    });

    describe('when bot sends messages to chat', () => {
        it('should deliver bot messages to viewers', async () => {
            platform.eventSub = mockTwitchEventSub;
            const botMessage = 'Hello chat!';

            await platform.sendMessage(botMessage);

            expect(mockTwitchEventSub.sendMessage.mock.calls[0][0]).toBe('Hello chat!');
            expectNoTechnicalArtifacts(botMessage);
        });

        it('should handle message delivery failures gracefully', async () => {
            platform.eventSub = mockTwitchEventSub;
            const sendError = new Error('Network timeout');
            mockTwitchEventSub.sendMessage.mockRejectedValue(sendError);

            await expect(platform.sendMessage('test')).rejects.toThrow('Network timeout');
        });

        it('should surface a user-friendly error when EventSub is not initialized', async () => {
            platform.eventSub = null;

            await expect(platform.sendMessage('hello')).rejects.toThrow('EventSub connection is not initialized');
        });

        it('should block sending when EventSub connection is inactive', async () => {
            platform.eventSub = {
                isConnected: createMockFn().mockReturnValue(false),
                isActive: createMockFn().mockReturnValue(false)
            };

            await expect(platform.sendMessage('hello')).rejects.toThrow('EventSub connection is not active');
        });
    });

    describe('when managing connection state', () => {
        it('should reflect connecting, connected, and disconnected states', () => {
            platform.isConnecting = true;
            let state = platform.getConnectionState();
            expect(state.status).toBe('connecting');

            platform.isConnecting = false;
            mockTwitchEventSub.isConnected.mockReturnValue(true);
            platform.eventSub = mockTwitchEventSub;
            state = platform.getConnectionState();
            expect(state.status).toBe('connected');

            platform.eventSub = null;
            state = platform.getConnectionState();
            expect(state.status).toBe('disconnected');
        });
    });

    describe('when routing events through PlatformEventRouter', () => {
        it('should route chat events end-to-end via platform:event', async () => {
            platform.handlers = {
                onChat: (data) => mockEventBus.emit('platform:event', { platform: 'twitch', type: 'platform:chat-message', data })
            };

            await platform.onMessageHandler({
                chatter_user_id: 'u1',
                chatter_user_name: 'user1',
                broadcaster_user_id: 'broadcaster-1',
                message: { text: 'hello' },
                badges: {},
                timestamp: '2024-01-01T00:00:03Z'
            });

            expect(runtime.handleChatMessage).toHaveBeenCalledTimes(1);
            const payload = runtime.handleChatMessage.mock.calls[0][1];
            expect(payload.message).toBeDefined();
            expect(mockEventBus.emitted.find(e => e.eventName === 'platform:event')).toBeDefined();
        });

        it('should route follow events end-to-end via platform:event', async () => {
            platform.handlers = {
                onFollow: (data) => mockEventBus.emit('platform:event', { platform: 'twitch', type: 'platform:follow', data })
            };
            const followEvent = { username: 'follower', userId: 'follower-id', timestamp: new Date().toISOString() };

            await platform.handleFollowEvent(followEvent);

            expect(runtime.handleFollowNotification).toHaveBeenCalledTimes(1);
            const payload = runtime.handleFollowNotification.mock.calls[0][2];
            expect(payload.username).toBe('follower');
            expect(mockEventBus.emitted.find(e => e.eventName === 'platform:event')).toBeDefined();
        });
    });

    describe('when handling stream status', () => {
        it('should start viewer polling on stream online and stop on offline', () => {
            platform.handleStreamOnlineEvent({ started_at: '2024-01-01T00:00:00Z' });
            expect(mockViewerCountProvider.startPolling).toHaveBeenCalled();

            platform.handleStreamOfflineEvent({ timestamp: '2024-01-01T00:00:00Z' });
            expect(mockViewerCountProvider.stopPolling).toHaveBeenCalled();
        });
    });

    describe('when handling raw EventSub messages', () => {
        it('should process follow notification and emit event', async () => {
            const followListener = createMockFn();
            platform.on('follow', followListener);

            const followEvent = createTwitchFollowEvent({
                username: 'notifyUser',
                userId: '999'
            });
            platform.emit('follow', followEvent);

            expect(followListener).toHaveBeenCalledTimes(1);
            const followPayload = followListener.mock.calls[0][0];
            expect(followPayload.username).toBe('notifyUser');
        });
    });

    describe('when getting viewer count', () => {
        it('should provide accurate viewer count to streamer', async () => {
            mockViewerCountProvider.getViewerCount.mockResolvedValue(1500);

            const count = await platform.getViewerCount();

            expect(count).toBe(1500);
        });

        it('should show zero viewers when count unavailable', async () => {
            mockViewerCountProvider.getViewerCount.mockRejectedValue(new Error('API error'));

            const count = await platform.getViewerCount();

            expect(count).toBe(0);
        });
    });

    describe('when getting statistics', () => {
        it('should return platform statistics', () => {
            const stats = platform.getStats();
            expect(stats.platform).toBe('twitch');
            expect(stats.enabled).toBe(true);
            expect(stats.connected).toBe(false);
        });

        it('should include connection information in stats', () => {
            platform.eventSub = mockTwitchEventSub;
            mockTwitchEventSub.isConnected.mockReturnValue(true);

            const stats = platform.getStats();
            expect(stats.connected).toBe(true);
        });
    });

    describe('when checking configuration', () => {
        it('should return true for valid configuration', () => {
            const isConfigured = platform.isConfigured();
            expect(isConfigured).toBe(true);
        });

        it('should return false for invalid configuration', () => {
            const invalidPlatform = new TwitchPlatform({}, { authManager: mockAuthManager });
            const isConfigured = invalidPlatform.isConfigured();
            expect(isConfigured).toBe(false);
        });
    });

    describe('when cleaning up', () => {
        it('should disconnect EventSub and clean up resources', async () => {
            platform.eventSub = mockTwitchEventSub;

            await platform.cleanup();

            expect(mockTwitchEventSub.disconnect).toHaveBeenCalled();
            expect(platform.eventSub).toBeNull();
            expect(platform.handlers).toEqual({});
        });

        it('should handle cleanup errors gracefully', async () => {
            platform.eventSub = mockTwitchEventSub;
            mockTwitchEventSub.disconnect.mockRejectedValue(new Error('Cleanup failed'));

            await expect(platform.cleanup()).resolves.toBeUndefined();

            expect(platform.isPlannedDisconnection).toBe(true);
        });

        it('should mark disconnection as planned during cleanup', async () => {
            expect(platform.isPlannedDisconnection).toBe(false);

            await platform.cleanup();

            expect(platform.isPlannedDisconnection).toBe(true);
        });
    });

    describe('when logging raw platform data', () => {
        it('should complete without error when logging is enabled', async () => {
            platform.config.dataLoggingEnabled = true;
            platform.config.dataLoggingVerbose = true;
            const eventData = { type: 'chat', message: 'test' };

            await expect(platform.logRawPlatformData('chat', eventData)).resolves.toBeUndefined();
        });

        it('should complete without error when logging is disabled', async () => {
            platform.config.dataLoggingEnabled = false;
            const eventData = { type: 'chat', message: 'test' };

            await expect(platform.logRawPlatformData('chat', eventData)).resolves.toBeUndefined();
        });
    });

    describe('error handling', () => {
        it('should handle authentication errors', async () => {
            mockAuthManager.getState.mockReturnValue('PENDING');
            mockAuthManager.initialize.mockRejectedValue(new Error('Auth failed'));

            await expect(platform.initialize({})).rejects.toThrow('Auth failed');
        });

        it('should handle EventSub initialization errors gracefully', async () => {
            mockTwitchEventSub.initialize.mockRejectedValue(new Error('EventSub init failed'));

            await expect(platform.initializeEventSub()).resolves.toBeUndefined();

            expect(platform.eventsub).toBeUndefined();
        });

        it('should handle message processing errors', async () => {
            let error = null;
            try {
                await platform.onMessageHandler({
                    chatter_user_name: 'test',
                    message: { text: 'message' },
                    timestamp: '2024-01-01T00:00:04Z'
                });
            } catch (e) {
                error = e;
            }

            expect(error).toBeNull();
            expect(platform).toBeDefined();
        });
    });

    describe('when managing API client', () => {
        it('should initialize API client correctly', () => {
            expect(platform.apiClient).toBe(mockApiClient);
        });

        it('should use API client for channel information', async () => {
            const channelInfo = await platform.apiClient.getChannelInfo('testchannel');
            expect(channelInfo).toEqual({ id: '123456', name: 'testchannel' });
        });
    });

    describe('when managing viewer count provider', () => {
        it('should initialize viewer count provider correctly', () => {
            expect(platform.viewerCountProvider).toBe(mockViewerCountProvider);
        });

        it('should start polling when enabled', () => {
            platform.config.viewerCountEnabled = true;
            platform.initializeViewerCountProvider();

            expect(mockViewerCountProvider.startPolling).toHaveBeenCalled();
        });

        it('should stop polling during cleanup', async () => {
            platform.viewerCountProvider = mockViewerCountProvider;

            await platform.cleanup();

            expect(mockViewerCountProvider.stopPolling).toHaveBeenCalled();
        });
    });
}); 
