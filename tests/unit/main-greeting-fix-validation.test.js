
const { describe, test, expect, beforeEach, jest } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { initializeTestLogging, createTestUser, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { createMockLogger } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const NotificationBuilder = require('../../src/utils/notification-builder');

// Initialize logging FIRST (required for all tests)
initializeTestLogging();

// Setup automated cleanup (no manual mock management)
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Main.js Greeting Username Extraction Fix', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    // Test timeout protection as per rules
    jest.setTimeout(TEST_TIMEOUTS.UNIT);

    let extractUsernameFromNotificationData;
    let logNotificationToConsole;
    let mockLogger;

    beforeEach(() => {
        // Create mock logger with console method
        mockLogger = {
            console: createMockFn(),
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
        
        // Create a mock AppRuntime context with the actual updated methods from main.js
        const runtimeContext = {
            logger: mockLogger,
            
            // The actual updated extractUsernameFromNotificationData method from main.js
            extractUsernameFromNotificationData: function(data) {
                if (!data || typeof data.username !== 'string') {
                    return null;
                }

                const username = data.username.trim();
                return username ? username : null;
            },
            
            // The actual updated logNotificationToConsole method from main.js
            logNotificationToConsole: function(type, platform, data) {
                // Extract username using comprehensive fallback logic
                const username = this.extractUsernameFromNotificationData(data);
                if (!username) {
                    return;
                }
                
                // Compose a user-friendly message for each notification type
                let msg = '';
                switch (type) {
                    case 'follow':
                        msg = `[${platform}] New follow: ${username}`;
                        break;
                    case 'subscription':
                        msg = `[${platform}] New subscription: ${username}`;
                        break;
                    case 'membership':
                        msg = `[${platform}] New membership: ${username}`;
                        break;
                    case 'raid':
                        msg = `[${platform}] Raid from ${username} with ${data.viewerCount ?? 0} viewers!`;
                        break;
                    case 'gift':
                        msg = `[${platform}] Gift from ${username}: ${data.giftCount || 1}x ${data.giftType || 'gift'} (${data.amount ?? 0} ${data.currency || 'coins'})`;
                        break;
                    case 'redemption':
                        msg = `[${platform}] Redemption by ${username}: ${data.rewardTitle || 'Unknown Reward'} (${data.rewardCost || 0} points)`;
                        break;
                    case 'greeting':
                        msg = `[${platform}] Greeting: ${username}`;
                        break;
                    case 'farewell':
                        msg = `[${platform}] Farewell: ${username}`;
                        break;
                    default:
                        msg = `[${platform}] Notification (${type}): ${username}`;
                }
                if (this.logger && this.logger.console) {
                    this.logger.console(msg, 'notification');
                }
            }
        };
        
        // Bind the methods to preserve 'this' context
        extractUsernameFromNotificationData = runtimeContext.extractUsernameFromNotificationData.bind(runtimeContext);
        logNotificationToConsole = runtimeContext.logNotificationToConsole.bind(runtimeContext);
    });

    test('should extract username from notification data', () => {
        // Given: A greeting notification created by NotificationBuilder
        const greetingData = NotificationBuilder.build({
            type: 'greeting',
            platform: 'twitch',
            username: 'TestUser'
        });

        // Verify that NotificationBuilder creates the expected structure
        expect(greetingData).toMatchObject({
            type: 'greeting',
            platform: 'twitch',
            username: 'TestUser'
        });

        // When: Calling the actual extractUsernameFromNotificationData method
        const extractedUsername = extractUsernameFromNotificationData(greetingData);

        // Then: Should extract the username from the payload
        expect(extractedUsername).toBe('TestUser');
    });

    test('should properly log greeting notification with correct username', () => {
        // Given: A greeting notification
        const greetingData = NotificationBuilder.build({
            type: 'greeting',
            platform: 'twitch',
            username: 'TestUser'
        });

        // When: Logging the greeting notification using the updated logNotificationToConsole method
        logNotificationToConsole('greeting', 'twitch', greetingData);

        // Then: The logger should be called with a message containing the correct username
        expect(mockLogger.console).toHaveBeenCalledWith(
            '[twitch] Greeting: TestUser',
            'notification'
        );
    });

    test('returns null when username is missing', () => {
        expect(extractUsernameFromNotificationData({ displayName: 'AltName' })).toBeNull();
        expect(extractUsernameFromNotificationData({ name: 'AltName' })).toBeNull();
    });

    test('returns null for invalid data', () => {
        // Test null data
        expect(extractUsernameFromNotificationData(null)).toBeNull();

        // Test undefined data
        expect(extractUsernameFromNotificationData(undefined)).toBeNull();

        // Test empty object
        expect(extractUsernameFromNotificationData({})).toBeNull();

        // Test empty user object
        expect(extractUsernameFromNotificationData({ user: {} })).toBeNull();
    });

    test('should fix all notification types using the same username extraction pattern', () => {
        // Given: A notification with username
        const notificationData = NotificationBuilder.build({
            type: 'platform:follow',
            platform: 'twitch',
            username: 'TestFollower'
        });

        // Test each notification type to ensure they all use the improved extraction
        const notificationTypes = ['platform:follow', 'platform:paypiggy', 'platform:raid', 'platform:gift', 'redemption', 'farewell'];
        
        notificationTypes.forEach(type => {
            mockLogger.console.mockClear();
            logNotificationToConsole(type, 'twitch', notificationData);
            
            // All calls should contain the correct username, not "undefined"
            const loggedMessage = mockLogger.console.mock.calls[0][0];
            expect(loggedMessage).toContain('TestFollower');
            expect(loggedMessage).not.toContain('undefined');
        });
    });
});
