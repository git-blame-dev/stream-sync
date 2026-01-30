const { describe, test, afterEach, expect } = require('bun:test');

const EventEmitter = require('events');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');
const NotificationManager = require('../../src/notifications/NotificationManager');
const { createTestAppRuntime } = require('../helpers/runtime-test-harness');
const { createMockDisplayQueue, noOpLogger } = require('../helpers/mock-factories');
const { createTextProcessingManager } = require('../../src/utils/text-processing');
const { expectNoTechnicalArtifacts } = require('../helpers/assertion-helpers');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { createConfigFixture } = require('../helpers/config-fixture');

describe('Twitch giftpaypiggy platform flow (smoke)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

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

    test('routes giftpaypiggy through lifecycle, router, and runtime', async () => {
        const eventBus = createEventBus();
        const logger = noOpLogger;
        const displayQueue = createMockDisplayQueue();
        const textProcessing = createTextProcessingManager({ logger });
        const configOverrides = {
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
            twitch: { enabled: true, notificationsEnabled: true },
            obs: { enabled: false },
            tts: { enabled: false }
        };
        const config = createConfigFixture(configOverrides);
        const notificationManager = new NotificationManager({
            displayQueue,
            logger,
            eventBus,
            config,
            constants: require('../../src/core/constants'),
            textProcessing,
            obsGoals: { processDonationGoal: createMockFn() },
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            ttsService: { speak: createMockFn() },
            userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
        });

        const streamDetector = {
            startStreamDetection: createMockFn(async (_platformName, _config, connectCallback) => connectCallback())
        };
        const platformLifecycleService = new PlatformLifecycleService({
            config: { twitch: { enabled: true } },
            eventBus,
            logger,
            streamDetector
        });

        const { runtime } = createTestAppRuntime(configOverrides, {
            eventBus,
            notificationManager,
            displayQueue,
            logger,
            platformLifecycleService
        });

        class MockTwitchPlatform {
            async initialize(handlers) {
                handlers.onGiftPaypiggy({
                    username: 'TestGifter',
                    userId: 'tw-test-gifter-1',
                    giftCount: 5,
                    tier: '1000',
                    timestamp: '2024-01-01T00:00:00.000Z'
                });
            }

            on() {}

            cleanup() {
                return Promise.resolve();
            }
        }

        try {
            await platformLifecycleService.initializeAllPlatforms({ twitch: MockTwitchPlatform });
            await new Promise(setImmediate);

            expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
            const queued = displayQueue.addItem.mock.calls[0][0];
            expect(queued.type).toBe('platform:giftpaypiggy');
            expect(queued.platform).toBe('twitch');
            expect(queued.data.username).toBe('TestGifter');
            expect(queued.data.giftCount).toBe(5);
            expect(queued.data.tier).toBe('1000');
            assertUserFacingOutput(queued.data, {
                username: 'TestGifter',
                keyword: 'subscription',
                count: 5
            });
        } finally {
            runtime.platformEventRouter?.dispose();
            platformLifecycleService.dispose();
        }
    });
});
