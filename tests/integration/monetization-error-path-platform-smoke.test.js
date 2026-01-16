const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const EventEmitter = require('events');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');
const NotificationManager = require('../../src/notifications/NotificationManager');
const { YouTubeNotificationDispatcher } = require('../../src/utils/youtube-notification-dispatcher');
const { createMonetizationErrorPayload } = require('../../src/utils/monetization-error-utils');
const { createTestAppRuntime } = require('../helpers/runtime-test-harness');
const { createMockDisplayQueue, noOpLogger } = require('../helpers/mock-factories');
const { createTextProcessingManager } = require('../../src/utils/text-processing');

describe('Monetization error-path platform flows (smoke)', () => {
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

    afterEach(() => {
        clearAllMocks();
        restoreAllMocks();
    });

    const createConfigService = (config) => ({
        areNotificationsEnabled: createMockFn(() => true),
        getPlatformConfig: createMockFn(() => true),
        getNotificationSettings: createMockFn(() => ({ enabled: true, duration: 4000 })),
        get: createMockFn((section) => {
            if (!section) {
                return config;
            }
            return config[section] || {};
        }),
        isDebugEnabled: createMockFn(() => false),
        getTTSConfig: createMockFn(() => ({ enabled: false })),
        isEnabled: createMockFn(() => true)
    });

    const createHarness = (platformKey) => {
        const eventBus = createEventBus();
        const logger = noOpLogger;
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
            [platformKey]: { enabled: true, notificationsEnabled: true },
            obs: { enabled: false },
            tts: { enabled: false }
        };
        if (platformKey === 'youtube') {
            configSnapshot.youtube.username = 'test-channel';
        }
        const configService = createConfigService(configSnapshot);
        const notificationManager = new NotificationManager({
            displayQueue,
            logger,
            eventBus,
            configService,
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
        const platformConfig = { enabled: true };
        if (platformKey === 'youtube') {
            platformConfig.username = 'test-channel';
        }

        const platformLifecycleService = new PlatformLifecycleService({
            config: { [platformKey]: platformConfig },
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

        return {
            eventBus,
            logger,
            displayQueue,
            configService,
            notificationManager,
            platformLifecycleService,
            runtime
        };
    };

    const expectNonEmptyString = (value) => {
        expect(typeof value).toBe('string');
        expect(value.trim()).not.toBe('');
    };

    const assertErrorNotification = (item, { platform, type, expectMissingUsername = false }) => {
        expect(item.type).toBe(type);
        expect(item.platform).toBe(platform);
        expect(item.data.isError).toBe(true);
        expectNonEmptyString(item.data.displayMessage);
        expectNonEmptyString(item.data.ttsMessage);
        expectNonEmptyString(item.data.logMessage);
        if (expectMissingUsername) {
            expect(item.data.username).toBeUndefined();
            expect(item.data.displayMessage.toLowerCase()).not.toContain('from ');
        }
    };

    it('routes Twitch monetization parse errors through notifications', async () => {
        const harness = createHarness('twitch');

        class MockTwitchPlatform {
            async initialize(handlers) {
                const giftError = createMonetizationErrorPayload({
                    notificationType: 'platform:gift',
                    platform: 'twitch',
                    timestamp: '2024-01-01T00:00:00.000Z'
                });
                const giftpaypiggyError = createMonetizationErrorPayload({
                    notificationType: 'platform:giftpaypiggy',
                    platform: 'twitch',
                    timestamp: '2024-01-01T00:00:00.000Z'
                });
                const paypiggyError = createMonetizationErrorPayload({
                    notificationType: 'platform:paypiggy',
                    platform: 'twitch',
                    timestamp: '2024-01-01T00:00:00.000Z'
                });

                handlers.onGift(giftError);
                handlers.onGiftPaypiggy(giftpaypiggyError);
                handlers.onPaypiggy(paypiggyError);
            }

            on() {}

            cleanup() {
                return Promise.resolve();
            }
        }

        try {
            await harness.platformLifecycleService.initializeAllPlatforms({ twitch: MockTwitchPlatform });
            await harness.platformLifecycleService.waitForBackgroundInits();
            await new Promise(setImmediate);

            const items = harness.displayQueue.addItem.mock.calls.map((call) => call[0]);
            expect(items).toHaveLength(3);

            const giftItem = items.find((item) => item.type === 'platform:gift');
            const giftpaypiggyItem = items.find((item) => item.type === 'platform:giftpaypiggy');
            const paypiggyItem = items.find((item) => item.type === 'platform:paypiggy');

            expect(giftItem).toBeTruthy();
            expect(giftpaypiggyItem).toBeTruthy();
            expect(paypiggyItem).toBeTruthy();

            assertErrorNotification(giftItem, { platform: 'twitch', type: 'platform:gift', expectMissingUsername: true });
            assertErrorNotification(giftpaypiggyItem, { platform: 'twitch', type: 'platform:giftpaypiggy', expectMissingUsername: true });
            assertErrorNotification(paypiggyItem, { platform: 'twitch', type: 'platform:paypiggy', expectMissingUsername: true });
        } finally {
            harness.runtime.platformEventRouter?.dispose();
            harness.platformLifecycleService.dispose();
        }
    });

    it('routes YouTube monetization parse errors through notifications', async () => {
        const harness = createHarness('youtube');

        class MockYouTubePlatform {
            constructor() {
                this.logger = harness.logger;
            }

            async initialize(handlers) {
                const superChatItem = {
                    item: {
                        author: { id: 'yt-error-user', name: 'TestViewer' },
                        timestamp: 1700000000000
                    }
                };
                const giftMembershipItem = {
                    item: {
                        author: { id: 'yt-error-gifter', name: 'GiftBuyer' },
                        timestamp: 1700000000000
                    }
                };
                const membershipItem = {
                    item: {
                        author: { id: 'yt-error-member', name: 'MemberUser' },
                        memberMilestoneDurationInMonths: 3
                    }
                };

                this.dispatchWithHandler(handlers, 'platform:gift', superChatItem);
                this.dispatchWithHandler(handlers, 'platform:giftpaypiggy', giftMembershipItem);
                this.dispatchWithHandler(handlers, 'platform:paypiggy', membershipItem);
            }

            dispatchWithHandler(handlers, type, chatItem) {
                const { createMonetizationErrorPayload } = require('../../src/utils/monetization-error-utils');
                const errorPayload = createMonetizationErrorPayload({
                    notificationType: type,
                    platform: 'youtube',
                    isError: true,
                    timestamp: '2024-01-01T00:00:00.000Z'
                });

                if (type === 'platform:gift') {
                    handlers.onGift(errorPayload);
                    return;
                }
                if (type === 'platform:giftpaypiggy') {
                    handlers.onGiftPaypiggy(errorPayload);
                    return;
                }
                if (type === 'platform:paypiggy') {
                    handlers.onPaypiggy(errorPayload);
                }
            }

            on() {}

            cleanup() {
                return Promise.resolve();
            }
        }

        try {
            await harness.platformLifecycleService.initializeAllPlatforms({ youtube: MockYouTubePlatform });
            await harness.platformLifecycleService.waitForBackgroundInits();
            await new Promise(setImmediate);

            const items = harness.displayQueue.addItem.mock.calls.map((call) => call[0]);
            expect(items).toHaveLength(3);

            const giftItem = items.find((item) => item.type === 'platform:gift');
            const giftpaypiggyItem = items.find((item) => item.type === 'platform:giftpaypiggy');
            const paypiggyItem = items.find((item) => item.type === 'platform:paypiggy');

            expect(giftItem).toBeTruthy();
            expect(giftpaypiggyItem).toBeTruthy();
            expect(paypiggyItem).toBeTruthy();

            assertErrorNotification(giftItem, { platform: 'youtube', type: 'platform:gift', expectMissingUsername: true });
            assertErrorNotification(giftpaypiggyItem, { platform: 'youtube', type: 'platform:giftpaypiggy', expectMissingUsername: true });
            assertErrorNotification(paypiggyItem, { platform: 'youtube', type: 'platform:paypiggy', expectMissingUsername: true });
        } finally {
            harness.runtime.platformEventRouter?.dispose();
            harness.platformLifecycleService.dispose();
        }
    });

    it('routes TikTok monetization parse errors through notifications', async () => {
        const harness = createHarness('tiktok');

        class MockTikTokPlatform {
            async initialize(handlers) {
                const giftError = createMonetizationErrorPayload({
                    notificationType: 'platform:gift',
                    platform: 'tiktok',
                    timestamp: '2024-01-01T00:00:00.000Z'
                });
                const paypiggyError = createMonetizationErrorPayload({
                    notificationType: 'platform:paypiggy',
                    platform: 'tiktok',
                    timestamp: '2024-01-01T00:00:00.000Z'
                });
                const envelopeError = createMonetizationErrorPayload({
                    notificationType: 'platform:envelope',
                    platform: 'tiktok',
                    timestamp: '2024-01-01T00:00:00.000Z'
                });

                handlers.onGift(giftError);
                handlers.onPaypiggy(paypiggyError);
                handlers.onEnvelope(envelopeError);
            }

            on() {}

            cleanup() {
                return Promise.resolve();
            }
        }

        try {
            await harness.platformLifecycleService.initializeAllPlatforms({ tiktok: MockTikTokPlatform });
            await harness.platformLifecycleService.waitForBackgroundInits();
            await new Promise(setImmediate);

            const items = harness.displayQueue.addItem.mock.calls.map((call) => call[0]);
            expect(items).toHaveLength(3);

            const giftItem = items.find((item) => item.type === 'platform:gift');
            const paypiggyItem = items.find((item) => item.type === 'platform:paypiggy');
            const envelopeItem = items.find((item) => item.type === 'platform:envelope');

            expect(giftItem).toBeTruthy();
            expect(paypiggyItem).toBeTruthy();
            expect(envelopeItem).toBeTruthy();

            assertErrorNotification(giftItem, { platform: 'tiktok', type: 'platform:gift', expectMissingUsername: true });
            assertErrorNotification(paypiggyItem, { platform: 'tiktok', type: 'platform:paypiggy', expectMissingUsername: true });
            assertErrorNotification(envelopeItem, { platform: 'tiktok', type: 'platform:envelope', expectMissingUsername: true });
        } finally {
            harness.runtime.platformEventRouter?.dispose();
            harness.platformLifecycleService.dispose();
        }
    });
});
