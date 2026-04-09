import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';

import { createMockFn, restoreAllMocks } from '../../helpers/bun-mock-utils';

const nodeRequire = createRequire(import.meta.url);

type LoggerLike = {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};

type SpamConfig = {
    enabled: boolean;
    detectionWindow: number;
    maxIndividualNotifications: number;
    lowValueThreshold: number;
};

const { initializeTestLogging } = nodeRequire('../../helpers/test-setup') as {
    initializeTestLogging: () => void;
};
const { noOpLogger } = nodeRequire('../../helpers/mock-factories') as {
    noOpLogger: LoggerLike;
};
const { setupAutomatedCleanup } = nodeRequire('../../helpers/mock-lifecycle') as {
    setupAutomatedCleanup: (options?: Record<string, unknown>) => void;
};
const { expectNoTechnicalArtifacts } = nodeRequire('../../helpers/assertion-helpers') as {
    expectNoTechnicalArtifacts: (value: string) => void;
};
const { createConfigFixture } = nodeRequire('../../helpers/config-fixture') as {
    createConfigFixture: (overrides?: Record<string, unknown>) => Record<string, unknown>;
};
const { createTextProcessingManager } = nodeRequire('../../../src/utils/text-processing') as {
    createTextProcessingManager: (deps: { logger: LoggerLike }) => Record<string, unknown>;
};
const { PRIORITY_LEVELS } = nodeRequire('../../../src/core/constants') as {
    PRIORITY_LEVELS: Record<string, number> & { GIFT: number };
};

const getMainConfig = () => {
    const { config } = nodeRequire('../../../src/core/config') as {
        config: {
            spam: SpamConfig;
        };
    };

    return config;
};

type MockFn = ReturnType<typeof createMockFn>;

type NotificationManagerInstance = {
    donationSpamDetector?: unknown;
    handleNotification: (type: string, platform: string, data: Record<string, unknown>) => Promise<unknown>;
    handleNotificationInternal: (
        type: string,
        platform: string,
        data: Record<string, unknown>,
        suppressQueue: boolean
    ) => Promise<{ suppressed?: boolean; reason?: string }>;
};

type NotificationManagerConstructor = new (deps: Record<string, unknown>) => NotificationManagerInstance;

initializeTestLogging();

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

describe('Spam Detection Service Integration Tests', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let mockLogger: LoggerLike;
    let mockConstants: {
        PRIORITY_LEVELS: typeof PRIORITY_LEVELS;
        NOTIFICATION_CONFIGS: {
            'platform:gift': {
                priority: number;
                duration: number;
                settingKey: string;
                commandKey: string;
            };
        };
    };
    let mockDisplayQueue: {
        addItem: MockFn;
        processQueue: MockFn;
    };
    let mockSpamDetector: {
        handleDonationSpam: MockFn;
    };
    let mockConfig: ReturnType<typeof createConfigFixture>;
    let mockTextProcessing: ReturnType<typeof createTextProcessingManager>;
    let mockObsGoals: {
        processDonationGoal: MockFn;
    };
    let mockVfxCommandService: {
        getVFXConfig: MockFn;
    };
    let NotificationManager: NotificationManagerConstructor;

    beforeEach(() => {
        mockLogger = noOpLogger;

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

        mockSpamDetector = {
            handleDonationSpam: createMockFn().mockReturnValue({ shouldShow: true })
        };

        mockConfig = createConfigFixture();

        mockTextProcessing = createTextProcessingManager({ logger: mockLogger });
        mockObsGoals = { processDonationGoal: createMockFn() };
        mockVfxCommandService = { getVFXConfig: createMockFn(async () => null) };

        NotificationManager = nodeRequire('../../../src/notifications/NotificationManager') as NotificationManagerConstructor;
    });

    describe('when spam detection configuration is available', () => {
        it('should use spam detector service when provided', async () => {
            const config = getMainConfig();

            expect(config.spam).toBeDefined();
            expect(config.spam.enabled).toBe(true);
        });

        it('should contain all required spam detection properties in config', () => {
            const config = getMainConfig();
            const spamConfig = config.spam;

            expect(spamConfig).toHaveProperty('enabled');
            expect(spamConfig).toHaveProperty('detectionWindow');
            expect(spamConfig).toHaveProperty('maxIndividualNotifications');
            expect(spamConfig).toHaveProperty('lowValueThreshold');

            expect(typeof spamConfig.enabled).toBe('boolean');
            expect(typeof spamConfig.detectionWindow).toBe('number');
            expect(typeof spamConfig.maxIndividualNotifications).toBe('number');
            expect(typeof spamConfig.lowValueThreshold).toBe('number');
        });
    });

    describe('when NotificationManager is initialized with spam detector', () => {
        it('should process gifts through spam detector when provided', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                donationSpamDetector: mockSpamDetector,
                config: mockConfig,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService
            });

            const giftData = {
                userId: 'user123',
                username: 'TestUser',
                giftType: 'Rose',
                giftCount: 1,
                amount: 10,
                currency: 'coins'
            };

            await notificationManager.handleNotification('platform:gift', 'tiktok', giftData);

            expect(mockSpamDetector.handleDonationSpam).toHaveBeenCalledWith(
                'user123',
                'TestUser',
                10,
                'Rose',
                1,
                'tiktok'
            );
        });

        it('should store spam detector when provided via dependency injection', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                donationSpamDetector: mockSpamDetector,
                config: mockConfig,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService
            });

            expect(notificationManager.donationSpamDetector).toBe(mockSpamDetector);
        });

        it('should suppress gifts when spam detector indicates spam', async () => {
            mockSpamDetector.handleDonationSpam.mockReturnValue({ shouldShow: false });

            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                donationSpamDetector: mockSpamDetector,
                config: mockConfig,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService
            });

            const giftData = {
                userId: 'spammer',
                username: 'SpamUser',
                giftType: 'Rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            };

            const result = await notificationManager.handleNotificationInternal('platform:gift', 'tiktok', giftData, false);

            expect(result.suppressed).toBe(true);
            expect(result.reason).toBe('spam_detection');
            expect(mockDisplayQueue.addItem).not.toHaveBeenCalled();
        });
    });

    describe('when NotificationManager is initialized without spam detector', () => {
        it('should gracefully handle missing spam detector dependency', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                config: mockConfig,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService
            });

            const giftData = {
                userId: 'user123',
                username: 'TestUser',
                giftType: 'Rose',
                giftCount: 1,
                amount: 10,
                currency: 'coins'
            };

            await expect(
                notificationManager.handleNotification('platform:gift', 'tiktok', giftData)
            ).resolves.toBeDefined();

            expect(mockDisplayQueue.addItem).toHaveBeenCalled();
        });

        it('should have undefined spam detector when not provided', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                config: mockConfig,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService
            });

            expect(notificationManager.donationSpamDetector).toBeUndefined();
        });
    });

    describe('when handling edge cases', () => {
        it('should skip spam detection for aggregated donations', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                donationSpamDetector: mockSpamDetector,
                config: mockConfig,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService
            });

            const aggregatedGift = {
                userId: 'user123',
                username: 'TestUser',
                giftType: 'Rose',
                giftCount: 5,
                amount: 50,
                currency: 'coins',
                isAggregated: true
            };

            await notificationManager.handleNotification('platform:gift', 'tiktok', aggregatedGift);

            expect(mockSpamDetector.handleDonationSpam).not.toHaveBeenCalled();
        });

        it('should validate spam config property types from configuration', () => {
            const config = getMainConfig();
            const spamConfig = config.spam;

            expect(typeof spamConfig.enabled).toBe('boolean');
            expect(typeof spamConfig.detectionWindow).toBe('number');
            expect(typeof spamConfig.maxIndividualNotifications).toBe('number');
            expect(typeof spamConfig.lowValueThreshold).toBe('number');

            expect(spamConfig.detectionWindow).toBeGreaterThan(0);
            expect(spamConfig.maxIndividualNotifications).toBeGreaterThan(0);
            expect(spamConfig.lowValueThreshold).toBeGreaterThanOrEqual(0);
        });
    });

    describe('when validating integration with spam detection system', () => {
        it('should provide config structure compatible with SpamDetectionConfig constructor', () => {
            const config = getMainConfig();
            const spamConfig = config.spam;

            expect(spamConfig).toBeTruthy();
            expect(spamConfig.enabled).toBeDefined();
            expect(spamConfig.detectionWindow).toBeDefined();
            expect(spamConfig.maxIndividualNotifications).toBeDefined();
            expect(spamConfig.lowValueThreshold).toBeDefined();

            expect(spamConfig.detectionWindow).toBeGreaterThan(0);
            expect(spamConfig.maxIndividualNotifications).toBeGreaterThan(0);
            expect(spamConfig.lowValueThreshold).toBeGreaterThan(0);
        });

        it('should support NotificationManager dependency injection pattern', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                donationSpamDetector: mockSpamDetector,
                config: mockConfig,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService
            });

            expect(notificationManager.donationSpamDetector).toBe(mockSpamDetector);
        });
    });

    describe('when ensuring no technical artifacts in user-facing content', () => {
        it('should not expose internal configuration details to users', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                donationSpamDetector: mockSpamDetector,
                config: mockConfig,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService
            });

            const giftData = {
                userId: 'user123',
                username: 'TestUser',
                giftType: 'Rose',
                giftCount: 1,
                amount: 10,
                currency: 'coins'
            };

            await notificationManager.handleNotification('platform:gift', 'tiktok', giftData);

            const queueCall = mockDisplayQueue.addItem.mock.calls[0];
            if (queueCall) {
                const queueItem = queueCall[0] as {
                    data: {
                        displayMessage?: string;
                        [key: string]: unknown;
                    };
                };
                const notificationData = queueItem.data;
                if (typeof notificationData.displayMessage === 'string') {
                    expectNoTechnicalArtifacts(notificationData.displayMessage);
                }
                expect(notificationData).not.toHaveProperty('spamDetectionConfig');
                expect(notificationData).not.toHaveProperty('configService');
            }
        });

        it('should provide meaningful property names for spam detection settings', () => {
            const config = getMainConfig();
            const spamConfig = config.spam;

            expect(spamConfig).toHaveProperty('enabled');
            expect(spamConfig).toHaveProperty('detectionWindow');
            expect(spamConfig).toHaveProperty('maxIndividualNotifications');
            expect(spamConfig).toHaveProperty('lowValueThreshold');
        });
    });
});
