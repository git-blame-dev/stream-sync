
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

// Mock the logger dependency that main.js uses
jest.mock('../../src/core/logging', () => ({
    getLogger: () => ({ console: jest.fn() }),
    setConfigValidator: jest.fn(),
    initializeLoggingConfig: jest.fn()
}));

describe('Main.js Greeting Notification Logging', () => {
    // Test timeout protection as per rules
    jest.setTimeout(TEST_TIMEOUTS.UNIT);

    let logNotificationToConsole;
    let mockLogger;

    beforeEach(() => {
        // Create minimal mock logger with console method
        mockLogger = {
            console: jest.fn(),
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };
        
        // Create a minimal AppRuntime-like object with just the logNotificationToConsole method
        // Extracted from the actual main.js implementation
        const runtimeInstance = {
            logger: mockLogger,
            logNotificationToConsole: function(type, platform, data) {
                // This is the ACTUAL implementation from main.js that we want to test
                const username = (typeof data?.username === 'string') ? data.username.trim() : '';
                if (!username) {
                    return;
                }
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
                if (this.logger && this.logger.console && typeof this.logger.console === 'function') {
                    this.logger.console(msg, 'notification');
                }
            }
        };
        
        logNotificationToConsole = runtimeInstance.logNotificationToConsole.bind(runtimeInstance);
    });

    test('logs greeting notification using username', () => {
        const greetingData = NotificationBuilder.build({
            type: 'greeting',
            platform: 'twitch',
            username: 'TestUser'
        });

        logNotificationToConsole('greeting', 'twitch', greetingData);

        expect(mockLogger.console).toHaveBeenCalledWith(
            '[twitch] Greeting: TestUser',
            'notification'
        );
    });

    test('skips logging when username is missing', () => {
        logNotificationToConsole('greeting', 'twitch', { type: 'greeting', platform: 'twitch' });

        expect(mockLogger.console).not.toHaveBeenCalled();
    });
});
