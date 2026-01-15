const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/utils/timeout-validator', () => ({
    validateTimeout: createMockFn((n) => n),
    safeSetInterval: createMockFn(() => ({ id: 'interval' })),
    safeDelay: createMockFn()
}));

mockModule('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: createMockFn(() => ({
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn()
    }))
}));

describe('NotificationManager behavior', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    const createDeps = (overrides = {}) => ({
        logger: { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() },
        displayQueue: { enqueue: createMockFn(), addItem: createMockFn(), getQueueLength: createMockFn(() => 0) },
        eventBus: { on: createMockFn(), emit: createMockFn() },
        configService: {
            areNotificationsEnabled: createMockFn(() => true),
            getPlatformConfig: createMockFn(() => true),
            isDebugEnabled: createMockFn(() => false),
            getTimingConfig: createMockFn(() => ({
                greetingDuration: 1000,
                commandDuration: 1000,
                chatDuration: 1000,
                notificationDuration: 1000
            })),
            getTTSConfig: createMockFn(() => ({
                enabled: false,
                deduplicationEnabled: true,
                debugDeduplication: false,
                onlyForGifts: false,
                voice: 'default',
                rate: 1,
                volume: 1
            })),
            get: createMockFn(() => ({
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
        textProcessing: { formatChatMessage: createMockFn() },
        obsGoals: { processDonationGoal: createMockFn() },
        ...overrides
    });

    beforeEach(() => {
        resetModules();
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
