const { describe, test, afterEach, expect } = require('bun:test');

const EventEmitter = require('events');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');
const NotificationManager = require('../../src/notifications/NotificationManager');
const { createTestAppRuntime } = require('../helpers/runtime-test-harness');
const { createMockDisplayQueue, noOpLogger } = require('../helpers/mock-factories');
const { createTextProcessingManager } = require('../../src/utils/text-processing');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { createConfigFixture } = require('../helpers/config-fixture');

describe('Twitch bits gift platform flow (smoke)', () => {
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

    test('routes bits gift through lifecycle, router, and runtime as gift', async () => {
        const eventBus = createEventBus();
        const logger = noOpLogger;
        const displayQueue = createMockDisplayQueue();
        const textProcessing = createTextProcessingManager({ logger });
        const config = createConfigFixture({
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
        });
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

        const { runtime } = createTestAppRuntime(config, {
            eventBus,
            config,
            notificationManager,
            displayQueue,
            logger,
            platformLifecycleService
        });

        class MockTwitchPlatform {
            async initialize(handlers) {
                handlers.onGift({
                    username: 'test_user',
                    userId: 'tw-cheer-1',
                    giftType: 'mixed bits',
                    giftCount: 1,
                    amount: 234,
                    currency: 'bits',
                    message: '',
                    id: 'cheer-event-234',
                    repeatCount: 1,
                    timestamp: '2024-01-01T00:00:00.000Z',
                    cheermoteInfo: {
                        count: 2,
                        totalBits: 234,
                        cleanPrefix: 'Cheer',
                        types: [
                            { prefix: 'Cheer', count: 1 },
                            { prefix: 'Uni', count: 1 }
                        ],
                        isMixed: true
                    }
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
            expect(queued.type).toBe('platform:gift');
            expect(queued.platform).toBe('twitch');
            expect(queued.data.username).toBe('test_user');
            expect(queued.data.amount).toBe(234);
            expect(queued.data.currency).toBe('bits');
            expect(queued.data.displayMessage).toBe('test_user sent 234 mixed bits');
        } finally {
            runtime.platformEventRouter?.dispose();
            platformLifecycleService.dispose();
        }
    });
});
