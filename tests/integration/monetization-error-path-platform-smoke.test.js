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

    const assertErrorNotification = (item, { platform, type }) => {
        expect(item.type).toBe(type);
        expect(item.platform).toBe(platform);
        expect(item.data.isError).toBe(true);
        expectNonEmptyString(item.data.displayMessage);
        expectNonEmptyString(item.data.ttsMessage);
        expectNonEmptyString(item.data.logMessage);
    };

    it('routes Twitch monetization parse errors through notifications', async () => {
        const harness = createHarness('twitch');

        class MockTwitchPlatform {
            async initialize(handlers) {
                const cheerError = createMonetizationErrorPayload({
                    notificationType: 'gift',
                    platform: 'twitch',
                    giftType: 'bits',
                    giftCount: 1,
                    amount: 50,
                    currency: 'bits',
                    userId: 'tw-error-user'
                });
                const giftpaypiggyError = createMonetizationErrorPayload({
                    notificationType: 'giftpaypiggy',
                    platform: 'twitch',
                    username: 'TestGifter',
                    userId: 'tw-error-gifter',
                    giftCount: 0,
                    tier: '1000'
                });
                const paypiggyError = createMonetizationErrorPayload({
                    notificationType: 'paypiggy',
                    platform: 'twitch',
                    username: 'TestSubscriber',
                    userId: 'tw-error-sub',
                    months: 0
                });

                handlers.onCheer(cheerError);
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

            assertErrorNotification(giftItem, { platform: 'twitch', type: 'gift' });
            assertErrorNotification(giftpaypiggyItem, { platform: 'twitch', type: 'giftpaypiggy' });
            assertErrorNotification(paypiggyItem, { platform: 'twitch', type: 'paypiggy' });
        } finally {
            harness.runtime.platformEventRouter?.dispose();
            harness.platformLifecycleService.dispose();
        }
    });

    it('routes YouTube monetization parse errors through notifications', async () => {
        const harness = createHarness('youtube');

        class MockYouTubePlatform {
            async initialize(handlers) {
                const dispatcher = new YouTubeNotificationDispatcher({ logger: harness.logger });
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

                await dispatcher.dispatchSuperChat(superChatItem, handlers);
                await dispatcher.dispatchGiftMembership(giftMembershipItem, handlers);
                await dispatcher.dispatchMembership(membershipItem, handlers);
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

            assertErrorNotification(giftItem, { platform: 'youtube', type: 'gift' });
            assertErrorNotification(giftpaypiggyItem, { platform: 'youtube', type: 'giftpaypiggy' });
            assertErrorNotification(paypiggyItem, { platform: 'youtube', type: 'paypiggy' });
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
                    platform: 'tiktok',
                    giftType: 'Unknown gift',
                    giftCount: 0,
                    amount: 0,
                    currency: 'unknown',
                    userId: 'tt-error-user'
                });
                const paypiggyError = createMonetizationErrorPayload({
                    notificationType: 'paypiggy',
                    platform: 'tiktok',
                    username: 'TikSubscriber',
                    userId: 'tt-error-sub',
                    months: 0
                });
                const envelopeError = createMonetizationErrorPayload({
                    notificationType: 'envelope',
                    platform: 'tiktok',
                    giftType: 'Treasure Chest',
                    giftCount: 0,
                    amount: 0,
                    currency: 'unknown',
                    userId: 'tt-error-envelope'
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

            assertErrorNotification(giftItem, { platform: 'tiktok', type: 'gift' });
            assertErrorNotification(paypiggyItem, { platform: 'tiktok', type: 'paypiggy' });
            assertErrorNotification(envelopeItem, { platform: 'tiktok', type: 'envelope' });
        } finally {
            harness.runtime.platformEventRouter?.dispose();
            harness.platformLifecycleService.dispose();
        }
    });
});
