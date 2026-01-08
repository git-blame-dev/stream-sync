
jest.mock('../../../src/core/logging', () => ({
    setConfigValidator: jest.fn(),
    setDebugMode: jest.fn(),
    initializeLoggingConfig: jest.fn(),
    initializeConsoleOverride: jest.fn(),
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    },
    getLogger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

const { initializeTestLogging, createTestUser, TEST_TIMEOUTS } = require('../../helpers/test-setup');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const { createTestAppRuntime } = require('../../helpers/runtime-test-harness');
const { generateLogMessage } = require('../../helpers/notification-test-utils');
const constants = require('../../../src/core/constants');

initializeTestLogging();

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Terminology Consistency', () => {
    jest.setTimeout(TEST_TIMEOUTS.UNIT);

    const buildAppRuntime = () => createTestAppRuntime({
        general: { enabled: true },
        youtube: { enabled: true },
        twitch: { enabled: true },
        tiktok: { enabled: true }
    });

    describe('Event routing', () => {
        test('YouTube paypiggy routes to handlePaypiggyNotification with membership wording', async () => {
            const { runtime } = buildAppRuntime();
            const user = createTestUser({ username: 'TestMember', platform: 'youtube' });
            const membershipData = { type: 'paypiggy', platform: 'youtube', username: user.username };

            const paypiggySpy = jest.spyOn(runtime, 'handlePaypiggyNotification').mockResolvedValue();

            await runtime.handleNotificationEvent('youtube', 'paypiggy', membershipData);

            expect(paypiggySpy).toHaveBeenCalledWith('youtube', user.username, membershipData);
        });

        test('Twitch subscription routes to handlePaypiggyNotification', async () => {
            const { runtime } = buildAppRuntime();
            const user = createTestUser({ username: 'SubUser', platform: 'twitch' });
            const subscriptionData = { type: 'paypiggy', platform: 'twitch', username: user.username };

            const paypiggySpy = jest.spyOn(runtime, 'handlePaypiggyNotification').mockResolvedValue();

            await runtime.handleNotificationEvent('twitch', 'paypiggy', subscriptionData);

            expect(paypiggySpy).toHaveBeenCalledWith('twitch', user.username, subscriptionData);
        });
    });

    describe('Log terminology', () => {
        test('YouTube membership log uses membership terminology', () => {
            const logMessage = generateLogMessage('paypiggy', {
                username: 'TestMember',
                platform: 'youtube',
                rewardTitle: 'Member'
            });
            expect(logMessage).toContain('New member');
            expect(logMessage).toContain('TestMember');
        });

        test('Twitch subscription log uses "subscription"', () => {
            const logMessage = generateLogMessage('paypiggy', {
                username: 'TwitchSub',
                platform: 'twitch',
                tier: 'Tier1',
                months: 3
            });
            expect(logMessage.toLowerCase()).toContain('subscriber');
            expect(logMessage).toContain('TwitchSub');
        });
    });

    describe('Alias removal', () => {
        test('resubscription aliases are not exposed in configs or priorities', () => {
            expect(constants.NOTIFICATION_CONFIGS.resub).toBeUndefined();
            expect(constants.NOTIFICATION_CONFIGS.resubscription).toBeUndefined();
            expect(constants.PRIORITY_LEVELS.RESUB).toBeUndefined();
            expect(constants.NOTIFICATION_TYPES.RESUB).toBeUndefined();
            expect(constants.NOTIFICATION_TYPES.RESUBSCRIPTION).toBeUndefined();
        });
    });
});
