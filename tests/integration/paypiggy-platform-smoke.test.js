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

describe('Paypiggy platform flows (smoke)', () => {
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

    const assertUserFacingOutput = (data, { username, keyword, logKeyword, count }) => {
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
            const normalizedLogKeyword = (logKeyword || keyword).toLowerCase();
            expect(data.logMessage.toLowerCase()).toContain(normalizedLogKeyword);
        }
        if (count !== undefined) {
            const countText = String(count);
            expect(data.displayMessage).toContain(countText);
            expect(data.ttsMessage).toContain(countText);
            expect(data.logMessage).toContain(countText);
        }
    };

    const createHarness = (platformKey) => {
        const eventBus = createEventBus();
        const logger = noOpLogger;
        const displayQueue = createMockDisplayQueue();
        const textProcessing = createTextProcessingManager({ logger });
        const platformConfigOverride = { enabled: true, notificationsEnabled: true };
        if (platformKey === 'youtube') {
            platformConfigOverride.username = 'test-channel';
        }
        const configOverrides = {
            general: {
                debugEnabled: false,
                giftsEnabled: true,
                paypiggiesEnabled: true,
                userSuppressionEnabled: false,
                maxNotificationsPerUser: 5,
                suppressionWindowMs: 60000,
                suppressionDurationMs: 300000,
                suppressionCleanupIntervalMs: 300000
            },
            [platformKey]: platformConfigOverride,
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

        const lifecyclePlatformConfig = { enabled: true };
        if (platformKey === 'youtube') {
            lifecyclePlatformConfig.username = 'test-channel';
        }

        const platformLifecycleService = new PlatformLifecycleService({
            config: { [platformKey]: lifecyclePlatformConfig },
            eventBus,
            logger
        });

        const { runtime } = createTestAppRuntime(configOverrides, {
            eventBus,
            notificationManager,
            displayQueue,
            logger,
            platformLifecycleService
        });

        return {
            eventBus,
            logger,
            displayQueue,
            config,
            notificationManager,
            platformLifecycleService,
            runtime
        };
    };

    const runPaypiggySmoke = async ({
        platformKey,
        handlerName,
        payload,
        assertFn,
        copyExpectations
    }) => {
        const harness = createHarness(platformKey);

        class MockPlatform {
            async initialize(handlers) {
                handlers[handlerName](payload);
            }

            on() {}

            cleanup() {
                return Promise.resolve();
            }
        }

        try {
            await harness.platformLifecycleService.initializeAllPlatforms({ [platformKey]: MockPlatform });
            await harness.platformLifecycleService.waitForBackgroundInits();
            await new Promise(setImmediate);

            expect(harness.displayQueue.addItem).toHaveBeenCalledTimes(1);
            const queued = harness.displayQueue.addItem.mock.calls[0][0];
            expect(queued.type).toBe('platform:paypiggy');
            expect(queued.platform).toBe(platformKey);
            assertUserFacingOutput(queued.data, copyExpectations);
            assertFn(queued);
        } finally {
            harness.runtime.platformEventRouter?.dispose();
            harness.platformLifecycleService.dispose();
        }
    };

    test('routes Twitch paypiggy through lifecycle, router, and runtime', async () => {
        await runPaypiggySmoke({
            platformKey: 'twitch',
            handlerName: 'onPaypiggy',
            payload: {
                username: 'SubUser',
                userId: 'tw-sub-1',
                tier: '1000',
                months: 1,
                timestamp: '2024-01-01T00:00:00.000Z'
            },
            copyExpectations: {
                username: 'SubUser',
                keyword: 'subscribed',
                logKeyword: 'subscriber'
            },
            assertFn: (queued) => {
                expect(queued.data.username).toBe('SubUser');
                expect(queued.data.tier).toBe('1000');
                expect(queued.data.months).toBe(1);
            }
        });
    });

    test('routes YouTube memberships through lifecycle, router, and runtime', async () => {
        await runPaypiggySmoke({
            platformKey: 'youtube',
            handlerName: 'onPaypiggy',
            payload: {
                username: 'MemberUser',
                userId: 'yt-member-1',
                membershipLevel: 'Member',
                months: 2,
                timestamp: '2024-01-01T00:00:00.000Z'
            },
            copyExpectations: {
                username: 'MemberUser',
                keyword: 'member'
            },
            assertFn: (queued) => {
                expect(queued.data.username).toBe('MemberUser');
                expect(queued.data.membershipLevel).toBe('Member');
                expect(queued.data.months).toBe(2);
            }
        });
    });

    test('routes TikTok subscriptions through lifecycle, router, and runtime', async () => {
        await runPaypiggySmoke({
            platformKey: 'tiktok',
            handlerName: 'onPaypiggy',
            payload: {
                username: 'TikFan',
                userId: 'tt-sub-1',
                timestamp: '2024-01-01T00:00:00.000Z'
            },
            copyExpectations: {
                username: 'TikFan',
                keyword: 'subscribed',
                logKeyword: 'subscriber'
            },
            assertFn: (queued) => {
                expect(queued.data.username).toBe('TikFan');
                expect(queued.data.tier).toBeUndefined();
            }
        });
    });
});
