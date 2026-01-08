jest.mock('../../../src/utils/timeout-validator', () => ({
    validateTimeout: jest.fn((n) => n),
    safeSetInterval: jest.fn(() => ({ id: 'interval' })),
    safeDelay: jest.fn()
}));

jest.mock('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: jest.fn(() => ({
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    }))
}));

describe('NotificationManager behavior', () => {
    const createDeps = (overrides = {}) => ({
        logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        displayQueue: { enqueue: jest.fn(), addItem: jest.fn(), getQueueLength: jest.fn(() => 0) },
        eventBus: { on: jest.fn(), emit: jest.fn() },
        configService: {
            areNotificationsEnabled: jest.fn(() => true),
            getPlatformConfig: jest.fn(() => true),
            isDebugEnabled: jest.fn(() => false),
            getTimingConfig: jest.fn(() => ({
                greetingDuration: 1000,
                commandDuration: 1000,
                chatDuration: 1000,
                notificationDuration: 1000
            })),
            getTTSConfig: jest.fn(() => ({
                enabled: false,
                deduplicationEnabled: true,
                debugDeduplication: false,
                onlyForGifts: false,
                voice: 'default',
                rate: 1,
                volume: 1
            })),
            get: jest.fn(() => ({
                userSuppressionEnabled: false,
                maxNotificationsPerUser: 5,
                suppressionWindowMs: 60000,
                suppressionDurationMs: 300000,
                suppressionCleanupIntervalMs: 300000
            }))
        },
        constants: {
            PRIORITY_LEVELS: { DEFAULT: 0, FOLLOW: 1, GIFT: 2, ENVELOPE: 3, MEMBER: 4, CHEER: 5, RAID: 6, SHARE: 7, REDEMPTION: 8, GIFTPAYPIGGY: 9, COMMAND: 10, GREETING: 11, CHAT: 12 },
            NOTIFICATION_CONFIGS: { follow: { settingKey: 'followsEnabled', commandKey: 'follows', hasSpecialProcessing: false } }
        },
        textProcessing: { formatChatMessage: jest.fn() },
        obsGoals: { processDonationGoal: jest.fn() },
        ...overrides
    });

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
    });

    it('throws when required dependencies are missing', () => {
        const NotificationManager = require('../../../src/notifications/NotificationManager');
        expect(() => new NotificationManager({})).toThrow('logger dependency');
        expect(() => new NotificationManager({ logger: {} })).toThrow('constants dependency');
    });

    it('throws when configService is missing', () => {
        const NotificationManager = require('../../../src/notifications/NotificationManager');
        const deps = createDeps({ configService: null });
        expect(() => new NotificationManager(deps)).toThrow('ConfigService dependency');
    });

    it('logs initialization and starts suppression cleanup', () => {
        const { safeSetInterval } = require('../../../src/utils/timeout-validator');
        const NotificationManager = require('../../../src/notifications/NotificationManager');
        const deps = createDeps();

        const manager = new NotificationManager(deps);

        expect(deps.logger.debug).toHaveBeenCalled();
        const initCall = deps.logger.debug.mock.calls.find(([message]) => (
            typeof message === 'string' && message.includes('Initializing with pure service-based architecture')
        ));
        expect(initCall).toBeDefined();
        expect(safeSetInterval).not.toHaveBeenCalled();
        expect(manager.suppressionConfig.enabled).toBe(false);
    });
});
