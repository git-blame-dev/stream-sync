
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
const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');
const { generateLogMessage } = require('../../helpers/notification-test-utils');
const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');
const constants = require('../../../src/core/constants');

initializeTestLogging();

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Terminology Consistency', () => {
    jest.setTimeout(TEST_TIMEOUTS.UNIT);

    const buildRouterHarness = () => {
        const handled = [];
        const runtime = {
            handlePaypiggyNotification: async (platform, username, data) => {
                handled.push({ platform, username, data });
            }
        };
        const eventBus = { subscribe: jest.fn(() => () => {}) };
        const notificationManager = { handleNotification: jest.fn(async () => true) };
        const configService = { areNotificationsEnabled: jest.fn(() => true) };
        const logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };
        const router = new PlatformEventRouter({
            eventBus,
            runtime,
            notificationManager,
            configService,
            logger
        });
        return { handled, router };
    };

    describe('Event routing', () => {
        test('YouTube paypiggy routes through PlatformEventRouter', async () => {
            const { handled, router } = buildRouterHarness();
            const user = createTestUser({ username: 'TestMember', platform: 'youtube' });
            const membershipData = {
                username: user.username,
                userId: 'user-1',
                timestamp: '2024-01-01T00:00:00Z'
            };

            await router.routeEvent({
                platform: 'youtube',
                type: 'platform:paypiggy',
                data: membershipData
            });

            expect(handled).toHaveLength(1);
            expect(handled[0].platform).toBe('youtube');
            expect(handled[0].username).toBe(user.username);
            expect(handled[0].data.userId).toBe('user-1');
            expect(handled[0].data.platform).toBe('youtube');
        });

        test('Twitch subscription routes through PlatformEventRouter', async () => {
            const { handled, router } = buildRouterHarness();
            const user = createTestUser({ username: 'SubUser', platform: 'twitch' });
            const subscriptionData = {
                username: user.username,
                userId: 'user-2',
                timestamp: '2024-01-01T00:00:00Z'
            };

            await router.routeEvent({
                platform: 'twitch',
                type: 'platform:paypiggy',
                data: subscriptionData
            });

            expect(handled).toHaveLength(1);
            expect(handled[0].platform).toBe('twitch');
            expect(handled[0].username).toBe(user.username);
            expect(handled[0].data.userId).toBe('user-2');
            expect(handled[0].data.platform).toBe('twitch');
        });
    });

    describe('Log terminology', () => {
        test('YouTube membership log uses membership terminology', () => {
            const logMessage = generateLogMessage('platform:paypiggy', {
                username: 'TestMember',
                platform: 'youtube',
                rewardTitle: 'Member'
            });
            expect(logMessage).toContain('New member');
            expect(logMessage).toContain('TestMember');
        });

        test('Twitch subscription log uses "subscription"', () => {
            const logMessage = generateLogMessage('platform:paypiggy', {
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
            expect(constants.NOTIFICATION_TYPES).toBeUndefined();
            expect(PlatformEvents.NOTIFICATION_TYPES.RESUB).toBeUndefined();
            expect(PlatformEvents.NOTIFICATION_TYPES.RESUBSCRIPTION).toBeUndefined();
        });
    });
});
