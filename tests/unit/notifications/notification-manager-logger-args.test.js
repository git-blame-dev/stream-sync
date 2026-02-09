const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { createConfigFixture } = require('../../helpers/config-fixture');
const { PRIORITY_LEVELS } = require('../../../src/core/constants');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

describe('NotificationManager logger argument order', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let NotificationManager;
    let spyLogger;
    let mockConstants;
    let mockDisplayQueue;
    let config;

    beforeEach(() => {
        spyLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn(),
            console: createMockFn()
        };

        mockConstants = {
            PRIORITY_LEVELS,
            NOTIFICATION_CONFIGS: {
                'platform:gift': {
                    priority: PRIORITY_LEVELS.GIFT,
                    duration: 5000,
                    settingKey: 'giftsEnabled',
                    commandKey: 'gifts'
                }
            }
        };

        mockDisplayQueue = {
            addItem: createMockFn(),
            processQueue: createMockFn()
        };

        config = createConfigFixture({
            general: {
                giftsEnabled: true,
                debugEnabled: true
            }
        });

        NotificationManager = require('../../../src/notifications/NotificationManager');
    });

    function createManager(overrides = {}) {
        const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
        return new NotificationManager({
            displayQueue: mockDisplayQueue,
            logger: spyLogger,
            eventBus: mockEventBus,
            config,
            constants: mockConstants,
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() },
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            ...overrides
        });
    }

    describe('spam detection logging', () => {
        it('logs suppression message with platform as source when spam blocks a gift', async () => {
            const mockSpamDetector = {
                handleDonationSpam: createMockFn().mockReturnValue({ shouldShow: false })
            };
            const manager = createManager({ donationSpamDetector: mockSpamDetector });

            await manager.handleNotificationInternal('platform:gift', 'tiktok', {
                userId: 'test-user-1',
                username: 'TestUser',
                giftType: 'Rose',
                giftCount: 1,
                amount: 10,
                currency: 'coins'
            }, false);

            const spamCall = spyLogger.debug.mock.calls.find(
                ([msg]) => typeof msg === 'string' && msg.includes('Spam gift suppressed')
            );
            expect(spamCall).toBeDefined();
            const [message, source] = spamCall;
            expect(message).toContain('TestUser');
            expect(source).toBe('tiktok');
        });

        it('logs error with platform as source when spam detection throws', async () => {
            const mockSpamDetector = {
                handleDonationSpam: createMockFn().mockImplementation(() => {
                    throw new Error('spam detector failure');
                })
            };
            const manager = createManager({ donationSpamDetector: mockSpamDetector });

            await manager.handleNotificationInternal('platform:gift', 'youtube', {
                userId: 'test-user-2',
                username: 'TestUser',
                giftType: 'Super Chat',
                giftCount: 1,
                amount: 5,
                currency: 'USD'
            }, false);

            const warnCall = spyLogger.warn.mock.calls.find(
                ([msg]) => typeof msg === 'string' && msg.includes('Error in spam detection')
            );
            expect(warnCall).toBeDefined();
            const [message, source] = warnCall;
            expect(message).toContain('spam detector failure');
            expect(source).toBe('youtube');
        });
    });

    describe('debug notification logging', () => {
        it('logs generated message with platform as source when debug enabled', async () => {
            const manager = createManager();

            await manager.handleNotificationInternal('platform:gift', 'twitch', {
                userId: 'test-user-3',
                username: 'TestUser',
                giftType: 'Sub Gift',
                giftCount: 1,
                amount: 5,
                currency: 'USD'
            }, false);

            const platformLogCall = spyLogger.info.mock.calls.find(
                ([, src]) => src === 'twitch'
            );
            expect(platformLogCall).toBeDefined();
            const [message, source] = platformLogCall;
            expect(message).toContain('TestUser');
            expect(source).toBe('twitch');
        });
    });
});
