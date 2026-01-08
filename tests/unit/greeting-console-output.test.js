
const { initializeTestLogging, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const NotificationBuilder = require('../../src/utils/notification-builder');
const { generateLogMessage, createNotificationData } = require('../helpers/notification-test-utils');

// Initialize logging FIRST (required for all tests)
initializeTestLogging();

// Setup automated cleanup (no manual mock management)
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Greeting Notification Console Output', () => {
    jest.setTimeout(TEST_TIMEOUTS.UNIT);

    test('generates console log text for greeting notifications using NotificationBuilder output', () => {
        const greetingData = NotificationBuilder.build({
            type: 'greeting',
            platform: 'twitch',
            username: 'UserF'
        });

        const logMessage = generateLogMessage('greeting', greetingData);

        expect(logMessage).toBe('Greeting: UserF');
    });

    test('uses builder-provided username to ensure log output never emits "undefined"', () => {
        const greetingData = createNotificationData('greeting', 'twitch', { username: 'FirstTimeChatter' });

        expect(greetingData.username).toBe('FirstTimeChatter');

        const logMessage = generateLogMessage('greeting', greetingData);
        expect(logMessage).toBe('Greeting: FirstTimeChatter');
    });
});
