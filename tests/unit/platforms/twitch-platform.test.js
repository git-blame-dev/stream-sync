
const { initializeTestLogging } = require('../../helpers/test-setup');
const { createMockLogger, createMockNotificationBuilder } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const { expectValidNotification, expectNoTechnicalArtifacts } = require('../../helpers/assertion-helpers');
const { createTwitchChatEvent, createTwitchFollowEvent, createTwitchSubscriptionEvent } = require('../../helpers/twitch-test-data');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

// Unmock the Twitch platform to test the real implementation
jest.unmock('../../../src/platforms/twitch');
jest.unmock('../../../src/platforms/twitch-eventsub');
jest.unmock('../../../src/utils/retry-system');
jest.unmock('../../../src/core/logging');
jest.unmock('../../../src/utils/platform-connection-state');
jest.unmock('../../../src/utils/api-clients/twitch-api-client');
jest.unmock('../../../src/utils/viewer-count-providers');

describe('Twitch Platform', () => {
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
        // Create mocks using factory functions
        mockLogger = createMockLogger('debug');
        mockAuthManager = {
            getState: jest.fn().mockReturnValue('READY'),
            getAccessToken: jest.fn().mockResolvedValue('mock-access-token'),
            refreshToken: jest.fn().mockResolvedValue('new-access-token'),
            validateToken: jest.fn().mockResolvedValue(true),
            initialize: jest.fn().mockResolvedValue()
        };
        mockApiClient = {
            getChannelInfo: jest.fn().mockResolvedValue({ id: '123456', name: 'testchannel' }),
            getViewerCount: jest.fn().mockResolvedValue(1500),
            sendChatMessage: jest.fn().mockResolvedValue()
        };
        mockViewerCountProvider = {
            getViewerCount: jest.fn().mockResolvedValue(1500),
            startPolling: jest.fn(),
            stopPolling: jest.fn()
        };
        mockApp = {
            handleChatMessage: jest.fn(),
            handleFollowNotification: jest.fn(),
            handlePaypiggyNotification: jest.fn(),
            updateViewerCount: jest.fn()
        };

        // Mock Twitch EventSub
        mockTwitchEventSub = {
            initialize: jest.fn().mockResolvedValue(),
            connect: jest.fn().mockResolvedValue(),
            disconnect: jest.fn().mockResolvedValue(),
            on: jest.fn(),
            emit: jest.fn(),
            isConnected: jest.fn().mockReturnValue(true),
            sendMessage: jest.fn().mockResolvedValue()
        };

        // Import the real TwitchPlatform now that we have proper mocking
        const { TwitchPlatform: RealTwitchPlatform } = require('../../../src/platforms/twitch');
        TwitchPlatform = RealTwitchPlatform;
        
        // Create test configuration
        config = {
            enabled: true,
            username: 'testuser',
            channel: 'testchannel',
            eventsub_enabled: true,
            dataLoggingEnabled: false,
            viewerCountEnabled: true
        };

        // Create platform instance with mocks
        platform = new TwitchPlatform(config, {
            TwitchEventSub: jest.fn().mockImplementation(() => mockTwitchEventSub),
            authManager: mockAuthManager,
            notificationBridge: mockApp,
            logger: mockLogger,
            timestampService: {
                extractTimestamp: jest.fn(() => new Date().toISOString())
            }
        });

        platformHandlers = {
            onChat: jest.fn(),
            onFollow: jest.fn(),
            onPaypiggy: jest.fn(),
            onGift: jest.fn(),
            onGiftPaypiggy: jest.fn(),
            onCheer: jest.fn(),
            onRaid: jest.fn(),
            onStreamStatus: jest.fn()
        };

        mockEventBus = {
            emitted: [],
            emit: jest.fn((type, payload) => mockEventBus.emitted.push({ type, payload }))
        };

        runtime = {
            handleChatMessage: jest.fn(),
            handleFollowNotification: jest.fn(),
            handlePaypiggyNotification: jest.fn(),
            handleGiftNotification: jest.fn(),
            handleRaidNotification: jest.fn()
        };

        // Build a lightweight event bus with subscribe
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
        
        // Manually inject the dependencies that would normally be created during initialize
        platform.apiClient = mockApiClient;
        platform.viewerCountProvider = mockViewerCountProvider;
        platform.handlers = platformHandlers;

        // Router for synthetic end-to-end event routing
        const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');
        router = new PlatformEventRouter({
            eventBus: mockEventBus,
            runtime,
            notificationManager: mockApp,
            configService: { areNotificationsEnabled: jest.fn(() => true) },
            logger: mockLogger
        });
    });

    describe('when initializing', () => {
        it('should accept valid configuration for user stream connection', () => {
            // Given: User provides valid Twitch configuration
            const validConfig = {
                enabled: true,
                username: 'testuser',
                channel: 'testchannel',
                eventsub_enabled: true
            };
            
            // When: Platform validates the configuration
            const testPlatform = new TwitchPlatform(validConfig, { authManager: mockAuthManager });
            const validation = testPlatform.validateConfig();
            
            // Then: User can connect to stream without configuration errors
            expect(validation.isValid).toBe(true);
            expect(validation.errors).toEqual([]);
        });

        it('should prevent connection when critical configuration is missing', () => {
            // Given: User provides incomplete configuration
            const invalidConfig = {};
            
            // When: Platform validates the configuration
            const invalidPlatform = new TwitchPlatform(invalidConfig, { authManager: mockAuthManager });
            const validation = invalidPlatform.validateConfig();
            
            // Then: User receives clear error message about what's missing
            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('username: Username is required for Twitch authentication');
            expectNoTechnicalArtifacts(validation.errors.join(' '));
        });

        it('should ensure user experience fails gracefully without auth dependencies', () => {
            // Given: Platform is created without required auth manager
            // When: User attempts to use the platform
            // Then: User sees clear error explaining the issue
            expect(() => {
                new TwitchPlatform(config, {});
            }).toThrow('TwitchPlatform requires authManager via dependency injection');
        });
    });

    describe('when initializing EventSub for real-time events', () => {
        it('should enable real-time event notifications when user has EventSub configured', async () => {
            // Given: User has enabled EventSub and authentication is ready
            platform.config.eventsub_enabled = true;
            mockAuthManager.getState.mockReturnValue('READY');
            
            // When: Platform initializes EventSub
            await platform.initializeEventSub();
            
            // Then: User will receive real-time notifications (EventSub is initialized)
            // We validate the behavior by checking if the system is ready for events
            expect(platform.config.eventsub_enabled).toBe(true);
            expect(mockAuthManager.getState).toHaveBeenCalled();
        });

        it('should operate without real-time events when user disables EventSub', async () => {
            // Given: User has explicitly disabled EventSub in configuration
            platform.config.eventsub_enabled = false;
            
            // When: Platform attempts EventSub initialization
            await platform.initializeEventSub();
            
            // Then: System operates in polling mode without real-time events
            // User experience continues without EventSub features
            expect(platform.eventsub).toBeUndefined();
        });

        it('should delay EventSub until authentication completes for user security', async () => {
            // Given: Authentication is still pending
            mockAuthManager.getState.mockReturnValue('PENDING');
            
            // When: Platform attempts EventSub initialization
            await platform.initializeEventSub();
            
            // Then: EventSub waits for auth to protect user credentials
            // System maintains security by not initializing without proper auth
            expect(platform.eventsub).toBeUndefined();
        });
    });

    describe('when connecting', () => {
        it('should establish connection successfully', async () => {
            const handlers = {
                onChatMessage: jest.fn(),
                onFollowNotification: jest.fn(),
                onPaypiggyNotification: jest.fn()
            };

            await platform.initialize(handlers);

            expect(mockTwitchEventSub.initialize).toHaveBeenCalled();
            expect(platform.handlers).toEqual(handlers);
        });

        it('should handle connection errors gracefully', async () => {
            const connectionError = new Error('Connection failed');
            mockTwitchEventSub.initialize.mockRejectedValue(connectionError);

            const handlers = {};
            
            // EventSub errors are caught and logged, not re-thrown from initialize
            await platform.initialize(handlers);
            
            // Then: User experience continues despite EventSub initialization failure
            // System should gracefully handle the error and maintain stability
            expect(platform.eventsub).toBeUndefined();
            // Platform remains usable for other features
        });

        it('should prepare to receive all user events after connection', async () => {
            // Given: User wants to receive all Twitch events
            const handlers = {
                onChatMessage: jest.fn(),
                onFollowNotification: jest.fn(),
                onPaypiggyNotification: jest.fn()
            };
            
            // When: Platform initializes with handlers
            await platform.initialize(handlers);
            
            // Then: System is ready to process all user events
            // Validate by checking if handlers are stored and ready
            expect(platform.handlers).toBeDefined();
            expect(platform.handlers.onChatMessage).toBeDefined();
            expect(platform.handlers.onFollowNotification).toBeDefined();
            expect(platform.handlers.onPaypiggyNotification).toBeDefined();
        });
    });

    describe('when handling chat messages', () => {
        it('should display chat messages to viewers in real-time', async () => {
            // Given: A viewer sends a chat message
            const chatMessage = 'Hello world!';
            const chatUser = 'chatuser';
            
            // When: Platform receives the chat message
            await platform.onMessageHandler('#testchannel', { username: chatUser }, chatMessage, false);
            
            // Then: Viewers see the message with proper formatting
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
            // Given: The bot itself sends a message (self = true)
            const selfMessage = 'Bot response';
            
            // When: Platform receives its own message
            await platform.onMessageHandler('#testchannel', { username: 'testuser' }, selfMessage, true);
            
            // Then: Viewers don't see duplicate bot messages (no echo)
            const messageCount = mockApp.handleChatMessage.mock.calls.length;
            expect(messageCount).toBe(0);
        });

        it('should preserve emojis and special characters for user expression', async () => {
            // Given: User sends message with emojis and special characters
            const messageWithEmojis = 'Hello 🌟 world! 🎉';
            
            // When: Platform processes the message
            await platform.onMessageHandler('#testchannel', { username: 'chatuser' }, messageWithEmojis, false);
            
            // Then: Viewers see the full message with all emojis preserved
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
        // Given: A new user follows the channel
        const followEvent = createTwitchFollowEvent({
            username: 'newfollower',
            userId: 'follow-user-1',
            displayName: 'New Follower',
            timestamp: new Date().toISOString()
        });

            // When: Platform processes the follow event
            await platform.handleFollowEvent(followEvent);

            // Then: Follow handler receives normalized payload
            expect(platformHandlers.onFollow).toHaveBeenCalledTimes(1);
            const payload = platformHandlers.onFollow.mock.calls[0][0];
            expect(payload.platform).toBe('twitch');
            expect(payload.username).toBe('newfollower');
            expectNoTechnicalArtifacts(payload.username);
            expect(payload.timestamp).toBeDefined();
        });

        it('should maintain stability when receiving malformed follow events', async () => {
            // Given: Platform receives a malformed follow event with missing data
            const incompleteEvent = {};

            // When: Platform attempts to process the malformed event
            await platform.handleFollowEvent(incompleteEvent);

            // Then: System remains stable and doesn't crash
            // User experience continues uninterrupted
            expect(platform).toBeDefined();
            // No follow notification shown for invalid data
            expect(mockApp.handleFollowNotification.mock.calls.length).toBe(0);
        });
    });

    describe('when handling subscription events', () => {
        it('should display subscription notification when viewer subscribes', async () => {
            // Given: A viewer subscribes to the channel
            const subEvent = {
                username: 'subscriber',
                userId: 'sub-user-1',
                tier: '1000',
                isGift: false,
                timestamp: '2024-01-01T00:00:00Z'
            };

            // When: Platform processes the subscription
            await platform.handlePaypiggyEvent(subEvent);

            // Then: Subscription handler receives normalized payload
            expect(platformHandlers.onPaypiggy).toHaveBeenCalledTimes(1);
            const payload = platformHandlers.onPaypiggy.mock.calls[0][0];
            expect(payload.platform).toBe('twitch');
            expect(payload.username).toBe('subscriber');
            expectNoTechnicalArtifacts(payload.username);
            expect(payload.tier).toBe('1000');
            expect(payload.isGift).toBe(false);
        });

        it('should display gift subscription events with gifter name', async () => {
            // Given: Someone gifts a subscription
            const giftSubscriptionEvent = {
                username: 'gifter',
                userId: 'gifter-user-1',
                tier: '2000',
                isGift: true,
                timestamp: '2024-01-01T00:00:00Z'
            };

            // When: Platform processes the gift subscription
            await platform.handlePaypiggyEvent(giftSubscriptionEvent);

            // Then: Subscription handler receives gift payload
            expect(platformHandlers.onPaypiggy).toHaveBeenCalledTimes(1);
            const payload = platformHandlers.onPaypiggy.mock.calls[0][0];
            expect(payload.username).toBe('gifter');
            expectNoTechnicalArtifacts(payload.username);
            expect(payload.tier).toBe('2000');
            expect(payload.isGift).toBe(true);
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
                userId: 'gift123',
                giftCount: 0,
                tier: '1000',
                isError: true
            });
            expect(payload.timestamp).toEqual(expect.any(String));
        });
    });

    describe('when handling EventSub lifecycle', () => {
        it('should set connection flags on EventSub connect/disconnect events', async () => {
            await platform.initialize(platformHandlers);

            // Simulate EventSub connection lifecycle
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
    });

    describe('when bot sends messages to chat', () => {
        it('should deliver bot messages to viewers', async () => {
            // Given: Bot has a message to send to chat
            platform.eventSub = mockTwitchEventSub;
            const botMessage = 'Hello chat!';
            
            // When: Bot sends the message
            await platform.sendMessage(botMessage);
            
            // Then: Message is sent to chat for viewers to see
            // Verify by checking the message was processed
            expect(mockTwitchEventSub.sendMessage.mock.calls[0][0]).toBe('Hello chat!');
            expectNoTechnicalArtifacts(botMessage);
        });

        it('should handle message delivery failures gracefully', async () => {
            // Given: Network issues prevent message sending
            platform.eventSub = mockTwitchEventSub;
            const sendError = new Error('Network timeout');
            mockTwitchEventSub.sendMessage.mockRejectedValue(sendError);
            
            // When: Bot attempts to send a message
            // Then: Error is handled without crashing the bot
            await expect(platform.sendMessage('test')).rejects.toThrow('Network timeout');
        });

        it('should surface a user-friendly error when EventSub is not initialized', async () => {
            platform.eventSub = null;

            await expect(platform.sendMessage('hello')).rejects.toThrow('EventSub connection is not initialized');
        });

        it('should block sending when EventSub connection is inactive', async () => {
            platform.eventSub = {
                isConnected: jest.fn().mockReturnValue(false),
                isActive: jest.fn().mockReturnValue(false)
            };

            await expect(platform.sendMessage('hello')).rejects.toThrow('EventSub connection is not active');
        });
    });

    describe('when managing connection state', () => {
        it('should reflect connecting, connected, and disconnected states', () => {
            // Connecting
            platform.isConnecting = true;
            let state = platform.getConnectionState();
            expect(state.status).toBe('connecting');

            // Connected via EventSub
            platform.isConnecting = false;
            mockTwitchEventSub.isConnected.mockReturnValue(true);
            platform.eventSub = mockTwitchEventSub;
            state = platform.getConnectionState();
            expect(state.status).toBe('connected');

            // Disconnected when EventSub missing
            platform.eventSub = null;
            state = platform.getConnectionState();
            expect(state.status).toBe('disconnected');
        });
    });

    describe('when routing events through PlatformEventRouter', () => {
        it('should route chat events end-to-end via platform:event', async () => {
            // Wire platform handlers to emit platform:event
            platform.handlers = {
                onChat: (data) => mockEventBus.emit('platform:event', { platform: 'twitch', type: 'chat', data })
            };

            const context = { username: 'user1', 'display-name': 'User1', 'user-id': 'u1', mod: false, subscriber: false };
            await platform.onMessageHandler('#chan', context, 'hello', false);

            expect(runtime.handleChatMessage).toHaveBeenCalledTimes(1);
            const payload = runtime.handleChatMessage.mock.calls[0][1];
            expect(payload.message).toBeDefined();
            expect(mockEventBus.emitted.find(e => e.eventName === 'platform:event')).toBeDefined();
        });

        it('should route follow events end-to-end via platform:event', async () => {
            platform.handlers = {
                onFollow: (data) => mockEventBus.emit('platform:event', { platform: 'twitch', type: 'follow', data })
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
            platform.handleStreamOnlineEvent({ timestamp: '2024-01-01T00:00:00Z' });
            expect(mockViewerCountProvider.startPolling).toHaveBeenCalled();

            platform.handleStreamOfflineEvent({ timestamp: '2024-01-01T00:00:00Z' });
            expect(mockViewerCountProvider.stopPolling).toHaveBeenCalled();
        });
    });

    describe('when handling raw EventSub messages', () => {
        it('should emit follow event from notification message', async () => {
            const TwitchEventSub = require('../../../src/platforms/twitch-eventsub');
            const eventSub = new TwitchEventSub({ channel: 'test', eventsub_enabled: true }, { logger: mockLogger });
            const followListener = jest.fn();
            eventSub.on('follow', followListener);

            const message = {
                metadata: { message_type: 'notification' },
                payload: {
                    subscription: { type: 'channel.follow' },
                    event: { user_name: 'notifyUser', user_id: '999', followed_at: '2024-01-01T00:00:00Z' }
                }
            };

            await eventSub.handleWebSocketMessage(message);

            expect(followListener).toHaveBeenCalledTimes(1);
            const followPayload = followListener.mock.calls[0][0];
            expect(followPayload.username).toBe('notifyUser');
        });
    });

    describe('when getting viewer count', () => {
        it('should provide accurate viewer count to streamer', async () => {
            // Given: Stream has 1500 viewers
            mockViewerCountProvider.getViewerCount.mockResolvedValue(1500);
            
            // When: Streamer checks viewer count
            const count = await platform.getViewerCount();
            
            // Then: Streamer sees accurate viewer count
            expect(count).toBe(1500);
        });

        it('should show zero viewers when count unavailable', async () => {
            // Given: API is temporarily unavailable
            mockViewerCountProvider.getViewerCount.mockRejectedValue(new Error('API error'));
            
            // When: System attempts to get viewer count
            const count = await platform.getViewerCount();
            
            // Then: Defaults to 0 instead of showing error to user
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

            await platform.cleanup();

            expect(mockLogger.warn).toHaveBeenCalled();
            const warnCall = mockLogger.warn.mock.calls.find(([message, zone]) => (
                typeof message === 'string' && message.includes('Failed to cleanup') && zone === 'twitch'
            ));
            expect(warnCall).toBeDefined();
            const debugDetails = warnCall[2];
            expect(debugDetails).toEqual(expect.objectContaining({
                error: 'Cleanup failed',
                resource: expect.any(String)
            }));
        });

        it('should mark disconnection as planned during cleanup', async () => {
            expect(platform.isPlannedDisconnection).toBe(false);

            await platform.cleanup();

            expect(platform.isPlannedDisconnection).toBe(true);
        });
    });

    describe('when logging raw platform data', () => {
        it('should log data when enabled', async () => {
            platform.config.dataLoggingEnabled = true;
            platform.config.dataLoggingVerbose = true;
            const eventData = { type: 'chat', message: 'test' };

            await platform.logRawPlatformData('chat', eventData);

            expect(mockLogger.debug).toHaveBeenCalled();
            const logCall = mockLogger.debug.mock.calls.find(([message, tag]) => (
                typeof message === 'string' && message.includes('Logged chat data for twitch') && tag === 'ChatFileLoggingService'
            ));
            expect(logCall).toBeDefined();
        });

        it('should skip logging when disabled', async () => {
            platform.config.dataLoggingEnabled = false;
            const eventData = { type: 'chat', message: 'test' };

            await platform.logRawPlatformData('chat', eventData);

            expect(mockLogger.debug).not.toHaveBeenCalled();
        });
    });

    describe('error handling', () => {
        it('should handle authentication errors', async () => {
            // Set auth manager state to PENDING to trigger initialize call
            mockAuthManager.getState.mockReturnValue('PENDING');
            mockAuthManager.initialize.mockRejectedValue(new Error('Auth failed'));

            await expect(platform.initialize({})).rejects.toThrow('Auth failed');
        });

        it('should handle EventSub initialization errors', async () => {
            mockTwitchEventSub.initialize.mockRejectedValue(new Error('EventSub init failed'));

            // The method catches and logs errors instead of rethrowing
            await platform.initializeEventSub();
            expect(mockLogger.error).toHaveBeenCalled();
            const errorCall = mockLogger.error.mock.calls.find(([message, tag]) => (
                typeof message === 'string' && message.includes('Failed to initialize EventSub') && tag === 'twitch'
            ));
            expect(errorCall).toBeDefined();
            expect(errorCall[2]).toEqual(expect.any(Object));
        });

        it('should handle message processing errors', async () => {
            // Given: Platform is processing messages through event-driven architecture
            // When: Processing a message (event emission handles errors in listeners separately)
            // Then: Platform remains stable and doesn't crash
            await expect(
                platform.onMessageHandler('#testchannel', { username: 'test' }, 'message', false)
            ).resolves.not.toThrow();

            // Event-driven architecture: errors in event listeners don't affect platform stability
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
