const EventEmitter = require('events');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');
const NotificationManager = require('../../src/notifications/NotificationManager');
const { createTestAppRuntime } = require('../helpers/runtime-test-harness');
const { createMockDisplayQueue, createMockLogger } = require('../helpers/mock-factories');
const { createTextProcessingManager } = require('../../src/utils/text-processing');
const { expectNoTechnicalArtifacts } = require('../helpers/assertion-helpers');

describe('YouTube giftpaypiggy platform flow (smoke)', () => {
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

    const assertUserFacingOutput = (data, { username, keyword, count }) => {
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
        if (count !== undefined) {
            const countText = String(count);
            expect(data.displayMessage).toContain(countText);
            expect(data.ttsMessage).toContain(countText);
            expect(data.logMessage).toContain(countText);
        }
    };

    it('routes giftpaypiggy through lifecycle, router, and runtime', async () => {
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
            youtube: { enabled: true, notificationsEnabled: true, username: 'test-channel' },
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
            config: { youtube: { enabled: true, username: 'test-channel' } },
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

        class MockYouTubePlatform {
            async initialize(handlers) {
                handlers.onGiftPaypiggy({
                    username: 'GiftMember',
                    userId: 'yt-gifter-1',
                    giftCount: 5,
                    timestamp: '2024-01-01T00:00:00.000Z'
                });
            }

            on() {}

            cleanup() {
                return Promise.resolve();
            }
        }

        try {
            await platformLifecycleService.initializeAllPlatforms({ youtube: MockYouTubePlatform });
            await new Promise(setImmediate);

            expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
            const queued = displayQueue.addItem.mock.calls[0][0];
            expect(queued.type).toBe('giftpaypiggy');
            expect(queued.platform).toBe('youtube');
            expect(queued.data.username).toBe('GiftMember');
            expect(queued.data.giftCount).toBe(5);
            assertUserFacingOutput(queued.data, {
                username: 'GiftMember',
                keyword: 'membership',
                count: 5
            });
        } finally {
            runtime.platformEventRouter?.dispose();
            platformLifecycleService.dispose();
        }
    });
});
