const {
    initializeTestLogging,
    TEST_TIMEOUTS
} = require('../../helpers/test-setup');

const {
    setupAutomatedCleanup
} = require('../../helpers/mock-lifecycle');

const { createNotificationData } = require('../../helpers/notification-test-utils');

initializeTestLogging();

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('NotificationStrings Resubscription Formatting', () => {
    test('renders resubscription copy without Tier 1 label', () => {
        const data = {
            username: 'example_user_13',
            tier: '1000',
            months: 3,
            isRenewal: true
        };

        const result = createNotificationData('paypiggy', 'twitch', data, data);

        expect(result.displayMessage).toBe('example_user_13 renewed subscription for 3 months!');
        expect(result.displayMessage).not.toContain('Tier');
    });

    test('includes tier label for premium resubscriptions', () => {
        const data = {
            username: 'premium_user',
            tier: '2000',
            months: 12,
            isRenewal: true
        };

        const result = createNotificationData('paypiggy', 'twitch', data, data);

        expect(result.displayMessage).toBe('premium_user renewed subscription for 12 months! (Tier 2)');
    });

    test('omits months when missing for resubscription events', () => {
        const data = {
            username: 'mystery_user',
            tier: '1000',
            isRenewal: true
        };

        const result = createNotificationData('paypiggy', 'twitch', data, data);

        expect(result.displayMessage).toBe('mystery_user renewed subscription!');
    });
}, TEST_TIMEOUTS.FAST);
