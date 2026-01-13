const EventEmitter = require('events');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');
const NotificationManager = require('../../src/notifications/NotificationManager');
const { createTestAppRuntime } = require('../helpers/runtime-test-harness');
const { createMockDisplayQueue, createMockLogger } = require('../helpers/mock-factories');
const { expectNoTechnicalArtifacts } = require('../helpers/assertion-helpers');
const { createTextProcessingManager } = require('../../src/utils/text-processing');

describe('TikTok gift platform flow (smoke)', () => {
    const createEventBus = () => {
        const emitter = new EventEmitter();
        return {
            emit: emitter.emit.bind(emitter),
            on: emitter.on.bind(emitter),
            subscribe: (event, handler) => {
                emitter.on(event, handler);
                return () => emitter.off(event, handler);
            }
        };
    };

    const createConfigService = (config) => ({
        areNotificationsEnabled: jest.fn().mockReturnValue(true),
        getPlatformConfig: jest.fn().mockReturnValue(true),
        getNotificationSettings: jest.fn().mockReturnValue({ enabled: true, duration: 4000 }),
        get: jest.fn((section) => {
            if (!section) {
                return config;
            }
            return config[section] || {};
        }),
        isDebugEnabled: jest.fn().mockReturnValue(false),
        getTTSConfig: jest.fn().mockReturnValue({ enabled: false }),
        isEnabled: jest.fn().mockReturnValue(true)
    });

    const assertNonEmptyString = (value) => {
        expect(typeof value).toBe('string');
        expect(value.trim()).not.toBe('');
    };

    const assertUserFacingOutput = (data, { username, keyword }) => {
        assertNonEmptyString(data.displayMessage);
        assertNonEmptyString(data.ttsMessage);
        assertNonEmptyString(data.logMessage);

        expectNoTechnicalArtifacts(data.displayMessage);
        expectNoTechnicalArtifacts(data.ttsMessage);
        expectNoTechnicalArtifacts(data.logMessage);

        if (username) {
            expect(data.displayMessage).toContain(username);
            expect(data.ttsMessage).toContain(username);
            expect(data.logMessage).toContain(username);
        }
        if (keyword) {
            const normalizedKeyword = keyword.toLowerCase();
            expect(data.displayMessage.toLowerCase()).toContain(normalizedKeyword);
            expect(data.ttsMessage.toLowerCase()).toContain(normalizedKeyword);
            expect(data.logMessage.toLowerCase()).toContain(normalizedKeyword);
        }
    };

    it('routes gift through lifecycle, router, and runtime', async () => {
        const eventBus = createEventBus();
        const logger = createMockLogger('debug', { captureConsole: true });
        const displayQueue = createMockDisplayQueue();
        const textProcessing = createTextProcessingManager({ logger });
        const configSnapshot = {
            general: {
                debugEnabled: false,
                giftsEnabled: true,
                paypiggiesEnabled: true,
                userSuppressionEnabled: false,
                maxNotificationsPerUser: 5,
                suppressionWindowMs: 60000,
                suppressionDurationMs: 300000,
                suppressionCleanupIntervalMs: 300000,
                streamDetectionEnabled: false,
                streamRetryInterval: 15,
                streamMaxRetries: 3,
                continuousMonitoringInterval: 60
            },
            tiktok: { enabled: true, notificationsEnabled: true },
            obs: { enabled: false },
            tts: { enabled: false }
        };
        const configService = createConfigService(configSnapshot);
        const notificationManager = new NotificationManager({
            displayQueue,
            logger,
            eventBus,
            configService,
            constants: require('../../src/core/constants'),
            textProcessing,
            obsGoals: { processDonationGoal: jest.fn() },
            vfxCommandService: { getVFXConfig: jest.fn().mockResolvedValue(null) },
            ttsService: { speak: jest.fn() },
            userTrackingService: { isFirstMessage: jest.fn().mockResolvedValue(false) }
        });

        const streamDetector = {
            startStreamDetection: jest.fn(async (_platformName, _config, connectCallback) => connectCallback())
        };
        const platformLifecycleService = new PlatformLifecycleService({
            config: { tiktok: { enabled: true } },
            eventBus,
            logger,
            streamDetector
        });

        const { runtime } = createTestAppRuntime(configSnapshot, {
            eventBus,
            configService,
            notificationManager,
            displayQueue,
            logger,
            platformLifecycleService
        });

        class MockTikTokPlatform {
            async initialize(handlers) {
                handlers.onGift({
                    username: 'TikFan',
                    userId: 'tt-gift-1',
                    giftType: 'Rose',
                    giftCount: 3,
                    repeatCount: 3,
                    amount: 3,
                    currency: 'coins',
                    id: 'tt-gift-event-1',
                    timestamp: '2024-01-01T00:00:00.000Z'
                });
            }

            on() {}

            cleanup() {
                return Promise.resolve();
            }
        }

        try {
            await platformLifecycleService.initializeAllPlatforms({ tiktok: MockTikTokPlatform });
            await platformLifecycleService.waitForBackgroundInits();
            await new Promise(setImmediate);

            expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
            const queued = displayQueue.addItem.mock.calls[0][0];
            expect(queued.type).toBe('platform:gift');
            expect(queued.platform).toBe('tiktok');
            expect(queued.data.username).toBe('TikFan');
            expect(queued.data.giftCount).toBe(3);
            expect(queued.data.repeatCount).toBe(3);
            expect(queued.data.currency).toBe('coins');
            assertUserFacingOutput(queued.data, {
                username: 'TikFan',
                keyword: 'Rose'
            });
        } finally {
            runtime.platformEventRouter?.dispose();
            platformLifecycleService.dispose();
        }
    });
});
