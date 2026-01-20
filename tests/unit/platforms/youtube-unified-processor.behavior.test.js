const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { restoreAllModuleMocks, resetModules } = require('../../helpers/bun-module-mocks');
const { noOpLogger } = require('../../helpers/mock-factories');
const { shouldSuppressYouTubeNotification } = require('../../../src/utils/youtube-message-extractor');
const { YouTubePlatform } = require('../../../src/platforms/youtube');
const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');

const createStreamDetectionService = () => ({
    detectLiveStreams: createMockFn().mockResolvedValue({
        success: true,
        videoIds: [],
        detectionMethod: 'mock'
    })
});

const createPlatformInstance = (overrides = {}) => {
    const logger = overrides.logger || noOpLogger;
    const streamDetectionService = overrides.streamDetectionService || createStreamDetectionService();

    const dependencies = {
        logger,
        streamDetectionService,
        viewerService: overrides.viewerService || null,
        USER_AGENTS: ['test-agent'],
        Innertube: null,
        notificationManager: overrides.notificationManager || {
            emit: createMockFn(),
            on: createMockFn(),
            removeListener: createMockFn()
        },
        ...overrides
    };

    const platform = new YouTubePlatform({ enabled: true, username: 'test-channel' }, dependencies);
    return { platform, dependencies, logger };
};

const createLogger = () => ({
    debug: createMockFn(),
    info: createMockFn(),
    warn: createMockFn(),
    error: createMockFn()
});

describe('shouldSuppressYouTubeNotification', () => {
    it('suppresses when author is null', () => {
        expect(shouldSuppressYouTubeNotification(null)).toBe(true);
    });

    it('suppresses when author is undefined', () => {
        expect(shouldSuppressYouTubeNotification(undefined)).toBe(true);
    });

    it('suppresses when author has empty name', () => {
        expect(shouldSuppressYouTubeNotification({ name: '' })).toBe(true);
    });

    it('suppresses when author has whitespace-only name', () => {
        expect(shouldSuppressYouTubeNotification({ name: '   ' })).toBe(true);
    });

    it('does not suppress when author has valid name', () => {
        expect(shouldSuppressYouTubeNotification({ name: 'TestUser' })).toBe(false);
    });
});

describe('YouTubePlatform unified notification processing', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    it('has unifiedNotificationProcessor initialized', () => {
        const { platform } = createPlatformInstance();
        expect(platform.unifiedNotificationProcessor).toBeDefined();
    });

    it('has baseEventHandler initialized', () => {
        const { platform } = createPlatformInstance();
        expect(platform.baseEventHandler).toBeDefined();
    });

    it('has errorHandler initialized', () => {
        const { platform } = createPlatformInstance();
        expect(platform.errorHandler).toBeDefined();
    });
});

describe('YouTubeBaseEventHandler error handling', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    it('handles dispatcher errors gracefully without throwing', async () => {
        const { platform } = createPlatformInstance();
        platform.notificationDispatcher.dispatchSuperChat = createMockFn().mockRejectedValue(new Error('test error'));

        await expect(
            platform.baseEventHandler.handleEvent({ payload: true }, {
                eventType: 'superchat',
                dispatchMethod: 'dispatchSuperChat'
            })
        ).resolves.toBeUndefined();
    });

    it('uses base error handler for event processing errors', async () => {
        const { platform } = createPlatformInstance();
        const errorHandlerSpy = createMockFn();
        platform.baseEventHandler.errorHandler.handleEventProcessingError = errorHandlerSpy;

        platform.notificationDispatcher.dispatchSuperChat = createMockFn().mockRejectedValue(new Error('boom'));

        await platform.baseEventHandler.handleEvent({ payload: true }, {
            eventType: 'superchat',
            dispatchMethod: 'dispatchSuperChat'
        });

        expect(errorHandlerSpy).toHaveBeenCalledTimes(1);
        const [error, eventType] = errorHandlerSpy.mock.calls[0];
        expect(error.message).toBe('boom');
        expect(eventType).toBe('superchat');
    });

    it('emits a platform error when the dispatcher method is missing', async () => {
        const logger = createLogger();
        const { platform } = createPlatformInstance({ logger });
        platform.notificationDispatcher = {};
        platform._emitPlatformEvent = createMockFn();

        await platform.baseEventHandler.handleEvent({ payload: true }, {
            eventType: 'superchat',
            dispatchMethod: 'dispatchSuperChat'
        });

        expect(platform._emitPlatformEvent).toHaveBeenCalledTimes(1);
        const [eventType, payload] = platform._emitPlatformEvent.mock.calls[0];
        expect(eventType).toBe(PlatformEvents.ERROR);
        expect(payload).toMatchObject({
            type: PlatformEvents.ERROR,
            platform: 'youtube'
        });
        const processedLog = logger.debug.mock.calls.find(([message]) =>
            message.includes('processed via')
        );
        expect(processedLog).toBeUndefined();
    });

    it('skips processed logging when dispatch returns false', async () => {
        const logger = createLogger();
        const { platform } = createPlatformInstance({ logger });
        platform.notificationDispatcher.dispatchSuperChat = createMockFn().mockResolvedValue(false);

        await platform.baseEventHandler.handleEvent({ payload: true }, {
            eventType: 'superchat',
            dispatchMethod: 'dispatchSuperChat'
        });

        const processedLog = logger.debug.mock.calls.find(([message]) =>
            message.includes('processed via')
        );
        expect(processedLog).toBeUndefined();
    });
});
