const { describe, test, afterEach, expect } = require('bun:test');

const EventEmitter = require('events');
const NotificationManager = require('../../src/notifications/NotificationManager');
const { YouTubePlatform } = require('../../src/platforms/youtube');
const { initializeTestLogging, createConfigFixture, createMockPlatformDependencies } = require('../helpers/test-setup');
const { getSyntheticFixture } = require('../helpers/platform-test-data');
const { createMockDisplayQueue, noOpLogger } = require('../helpers/mock-factories');
const { createTextProcessingManager } = require('../../src/utils/text-processing');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

initializeTestLogging();

const realSuperChat = getSyntheticFixture('youtube', 'superchat');

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

const createPlatformHarness = () => {
    const logger = noOpLogger;
    const config = createConfigFixture('youtube', {
        enabled: true,
        username: 'test-channel',
        apiKey: 'test-key'
    });
    const dependencies = createMockPlatformDependencies('youtube', { logger });
    const platform = new YouTubePlatform(config, dependencies);
    let capturedPayload;

    platform.handlers = {
        ...(platform.handlers || {}),
        onGift: (payload) => {
            capturedPayload = payload;
        }
    };

    return {
        platform,
        getCapturedPayload: () => capturedPayload
    };
};

const createNotificationManagerHarness = () => {
    const displayQueue = createMockDisplayQueue();
    const logger = noOpLogger;
    const textProcessing = createTextProcessingManager({ logger });
    const eventBus = createEventBus();
    const configSnapshot = {
        general: {
            debugEnabled: false,
            giftsEnabled: true,
            userSuppressionEnabled: false,
            maxNotificationsPerUser: 5,
            suppressionWindowMs: 60000,
            suppressionDurationMs: 300000,
            suppressionCleanupIntervalMs: 300000
        },
        youtube: { enabled: true },
        tts: { enabled: false }
    };
    const configService = {
        areNotificationsEnabled: createMockFn().mockReturnValue(true),
        getPlatformConfig: createMockFn().mockReturnValue(true),
        getNotificationSettings: createMockFn().mockReturnValue({ enabled: true, duration: 4000 }),
        get: createMockFn((section) => (section ? configSnapshot[section] || {} : configSnapshot)),
        isDebugEnabled: createMockFn().mockReturnValue(false),
        getTTSConfig: createMockFn().mockReturnValue({ enabled: false }),
        isEnabled: createMockFn().mockReturnValue(true)
    };

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

    return {
        displayQueue,
        notificationManager
    };
};

describe('YouTube data flow integrity', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('builds user-facing output from platform event payloads', async () => {
        const { platform, getCapturedPayload } = createPlatformHarness();
        await platform.handleChatMessage(realSuperChat);
        const capturedPayload = getCapturedPayload();

        expect(capturedPayload).toBeDefined();
        expect(capturedPayload.type).toBe('platform:gift');
        expect(capturedPayload.platform).toBe('youtube');
        expect(capturedPayload.displayMessage).toBeUndefined();
        expect(capturedPayload.ttsMessage).toBeUndefined();
        expect(capturedPayload.logMessage).toBeUndefined();
        expect(capturedPayload.id).toBe(realSuperChat.item.id);
        expect(typeof capturedPayload.timestamp).toBe('string');
        expect(capturedPayload.timestamp.trim().length).toBeGreaterThan(0);

        const { displayQueue, notificationManager } = createNotificationManagerHarness();
        const result = await notificationManager.handleNotification('platform:gift', capturedPayload.platform, capturedPayload);

        expect(result.success).toBe(true);
        expect(result.notificationData.displayMessage).toContain('Super Chat');
        expect(result.notificationData.displayMessage).toContain(capturedPayload.username);
        expect(result.notificationData.ttsMessage).toEqual(expect.any(String));
        expect(result.notificationData.ttsMessage.trim().length).toBeGreaterThan(0);
        expect(result.notificationData.logMessage).toEqual(expect.any(String));
        expect(result.notificationData.logMessage.trim().length).toBeGreaterThan(0);
        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    });
});
