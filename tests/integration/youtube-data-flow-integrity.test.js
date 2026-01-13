const EventEmitter = require('events');
const NotificationManager = require('../../src/notifications/NotificationManager');
const { YouTubeNotificationDispatcher } = require('../../src/utils/youtube-notification-dispatcher');
const { createYouTubeEventDispatchTable } = require('../../src/platforms/youtube/events/youtube-event-dispatch-table');
const { initializeTestLogging } = require('../helpers/test-setup');
const { getSyntheticFixture } = require('../helpers/platform-test-data');
const { createMockDisplayQueue, createMockLogger } = require('../helpers/mock-factories');
const { createTextProcessingManager } = require('../../src/utils/text-processing');

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

const createDispatcherHarness = () => {
    const logger = createMockLogger('debug', { captureConsole: true });
    const dispatcher = new YouTubeNotificationDispatcher({ logger });
    let capturedPayload;
    const handlers = {
        onGift: (payload) => {
            capturedPayload = payload;
        }
    };
    const platform = {
        logger,
        handlers,
        handleSuperChat: (chatItem) => dispatcher.dispatchSuperChat(chatItem, handlers)
    };
    const dispatchTable = createYouTubeEventDispatchTable(platform);

    return {
        dispatchTable,
        getCapturedPayload: () => capturedPayload
    };
};

const createNotificationManagerHarness = () => {
    const displayQueue = createMockDisplayQueue();
    const logger = createMockLogger('debug', { captureConsole: true });
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
        areNotificationsEnabled: jest.fn().mockReturnValue(true),
        getPlatformConfig: jest.fn().mockReturnValue(true),
        getNotificationSettings: jest.fn().mockReturnValue({ enabled: true, duration: 4000 }),
        get: jest.fn((section) => (section ? configSnapshot[section] || {} : configSnapshot)),
        isDebugEnabled: jest.fn().mockReturnValue(false),
        getTTSConfig: jest.fn().mockReturnValue({ enabled: false }),
        isEnabled: jest.fn().mockReturnValue(true)
    };

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

    return {
        displayQueue,
        notificationManager
    };
};

describe('YouTube data flow integrity', () => {
    test('builds user-facing output from dispatcher payloads', async () => {
        const { dispatchTable, getCapturedPayload } = createDispatcherHarness();
        await dispatchTable[realSuperChat.item.type](realSuperChat);
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
