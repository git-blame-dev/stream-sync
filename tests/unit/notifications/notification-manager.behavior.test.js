const { describe, expect, it, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('NotificationManager behavior', () => {
    let originalNodeEnv;

    beforeEach(() => {
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        restoreAllMocks();
    });

    const createDeps = (overrides = {}) => ({
        logger: { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() },
        displayQueue: { enqueue: createMockFn(), addItem: createMockFn(), getQueueLength: createMockFn(() => 0) },
        eventBus: { on: createMockFn(), emit: createMockFn(), subscribe: createMockFn() },
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

    it('throws when logger dependency is missing', () => {
        expect(() => new NotificationManager({})).toThrow('logger dependency');
    });

    it('throws when constants dependency is missing', () => {
        const deps = createDeps({ constants: undefined });
        expect(() => new NotificationManager(deps)).toThrow('constants dependency');
    });

    it('throws when configService dependency is missing', () => {
        const deps = createDeps({ configService: null });
        expect(() => new NotificationManager(deps)).toThrow('ConfigService dependency');
    });

    it('throws when displayQueue dependency is missing', () => {
        const deps = createDeps({ displayQueue: null });
        expect(() => new NotificationManager(deps)).toThrow('displayQueue dependency');
    });

    it('throws when eventBus dependency is missing', () => {
        const deps = createDeps({ eventBus: null });
        expect(() => new NotificationManager(deps)).toThrow('EventBus dependency');
    });

    it('disables suppression cleanup in test environment', () => {
        const deps = createDeps();
        const manager = new NotificationManager(deps);
        expect(manager.suppressionConfig.enabled).toBe(false);
    });

    it('initializes with valid dependencies', () => {
        const deps = createDeps();
        const manager = new NotificationManager(deps);
        expect(manager).toBeInstanceOf(NotificationManager);
        expect(manager.displayQueue).toBe(deps.displayQueue);
        expect(manager.configService).toBe(deps.configService);
    });
});
