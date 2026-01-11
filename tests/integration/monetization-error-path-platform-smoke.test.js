const EventEmitter = require('events');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');
const NotificationManager = require('../../src/notifications/NotificationManager');
const { YouTubeNotificationDispatcher } = require('../../src/utils/youtube-notification-dispatcher');
const { createMonetizationErrorPayload } = require('../../src/utils/monetization-error-utils');
const { createTestAppRuntime } = require('../helpers/runtime-test-harness');
const { createMockDisplayQueue, createMockLogger } = require('../helpers/mock-factories');
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

    const createHarness = (platformKey) => {
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
            obsGoals: { processDonationGoal: jest.fn() },
            vfxCommandService: { getVFXConfig: jest.fn().mockResolvedValue(null) },
            ttsService: { speak: jest.fn() },
            userTrackingService: { isFirstMessage: jest.fn().mockResolvedValue(false) }
        });

        const streamDetector = {
            startStreamDetection: jest.fn(async (_platformName, _config, connectCallback) => connectCallback())
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
                    notificationType: 'gift',
                    platform: 'twitch'
                });
                const giftpaypiggyError = createMonetizationErrorPayload({
                    notificationType: 'giftpaypiggy',
                    platform: 'twitch'
                });
                const paypiggyError = createMonetizationErrorPayload({
                    notificationType: 'paypiggy',
                    platform: 'twitch'
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

            const giftItem = items.find((item) => item.type === 'gift');
            const giftpaypiggyItem = items.find((item) => item.type === 'giftpaypiggy');
            const paypiggyItem = items.find((item) => item.type === 'paypiggy');

            expect(giftItem).toBeTruthy();
            expect(giftpaypiggyItem).toBeTruthy();
            expect(paypiggyItem).toBeTruthy();

            assertErrorNotification(giftItem, { platform: 'twitch', type: 'gift', expectMissingUsername: true });
            assertErrorNotification(giftpaypiggyItem, { platform: 'twitch', type: 'giftpaypiggy', expectMissingUsername: true });
            assertErrorNotification(paypiggyItem, { platform: 'twitch', type: 'paypiggy', expectMissingUsername: true });
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

                this.dispatchWithHandler(handlers, 'gift', superChatItem);
                this.dispatchWithHandler(handlers, 'giftpaypiggy', giftMembershipItem);
                this.dispatchWithHandler(handlers, 'paypiggy', membershipItem);
            }

            dispatchWithHandler(handlers, type, chatItem) {
                const { createMonetizationErrorPayload } = require('../../src/utils/monetization-error-utils');
                const errorPayload = createMonetizationErrorPayload({
                    notificationType: type,
                    platform: 'youtube',
                    isError: true
                });

                if (type === 'gift') {
                    handlers.onGift(errorPayload);
                    return;
                }
                if (type === 'giftpaypiggy') {
                    handlers.onGiftPaypiggy(errorPayload);
                    return;
                }
                if (type === 'paypiggy') {
                    handlers.onMembership(errorPayload);
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

            const giftItem = items.find((item) => item.type === 'gift');
            const giftpaypiggyItem = items.find((item) => item.type === 'giftpaypiggy');
            const paypiggyItem = items.find((item) => item.type === 'paypiggy');

            expect(giftItem).toBeTruthy();
            expect(giftpaypiggyItem).toBeTruthy();
            expect(paypiggyItem).toBeTruthy();

            assertErrorNotification(giftItem, { platform: 'youtube', type: 'gift', expectMissingUsername: true });
            assertErrorNotification(giftpaypiggyItem, { platform: 'youtube', type: 'giftpaypiggy', expectMissingUsername: true });
            assertErrorNotification(paypiggyItem, { platform: 'youtube', type: 'paypiggy', expectMissingUsername: true });
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
                    notificationType: 'gift',
                    platform: 'tiktok'
                });
                const paypiggyError = createMonetizationErrorPayload({
                    notificationType: 'paypiggy',
                    platform: 'tiktok'
                });
                const envelopeError = createMonetizationErrorPayload({
                    notificationType: 'envelope',
                    platform: 'tiktok'
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

            const giftItem = items.find((item) => item.type === 'gift');
            const paypiggyItem = items.find((item) => item.type === 'paypiggy');
            const envelopeItem = items.find((item) => item.type === 'envelope');

            expect(giftItem).toBeTruthy();
            expect(paypiggyItem).toBeTruthy();
            expect(envelopeItem).toBeTruthy();

            assertErrorNotification(giftItem, { platform: 'tiktok', type: 'gift', expectMissingUsername: true });
            assertErrorNotification(paypiggyItem, { platform: 'tiktok', type: 'paypiggy', expectMissingUsername: true });
            assertErrorNotification(envelopeItem, { platform: 'tiktok', type: 'envelope', expectMissingUsername: true });
        } finally {
            harness.runtime.platformEventRouter?.dispose();
            harness.platformLifecycleService.dispose();
        }
    });
});
