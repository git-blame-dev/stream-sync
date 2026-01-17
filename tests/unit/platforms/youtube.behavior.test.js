const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { restoreAllModuleMocks, resetModules } = require('../../helpers/bun-module-mocks');
const { noOpLogger } = require('../../helpers/mock-factories');
const { YouTubePlatform } = require('../../../src/platforms/youtube');

const createStreamDetectionService = (overrides = {}) => ({
    detectLiveStreams: createMockFn().mockResolvedValue({
        success: true,
        videoIds: [],
        detectionMethod: 'mock'
    }),
    ...overrides
});

const createPlatform = (overrides = {}) => {
    const logger = overrides.logger || noOpLogger;
    const streamDetectionService = overrides.streamDetectionService || createStreamDetectionService();

    const dependencies = {
        logger,
        streamDetectionService,
        notificationManager: overrides.notificationManager || {
            emit: createMockFn(),
            on: createMockFn(),
            removeListener: createMockFn()
        },
        USER_AGENTS: ['test-agent'],
        Innertube: null,
        ...overrides
    };

    return new YouTubePlatform(
        { enabled: true, username: 'test-channel' },
        dependencies
    );
};

describe('YouTubePlatform behavior', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    it('throws when dependencies argument is not an object', () => {
        expect(() => new YouTubePlatform({}, 'bad')).toThrow('Dependencies should be a single object');
    });

    it('throws when dependencies argument is a number', () => {
        expect(() => new YouTubePlatform({}, 123)).toThrow('Dependencies should be a single object');
    });

    it('connects to live videos and uses connection manager', async () => {
        const streamDetectionService = createStreamDetectionService({
            detectLiveStreams: createMockFn().mockResolvedValue({
                success: true,
                videoIds: ['v1'],
                detectionMethod: 'mock'
            })
        });

        const platform = createPlatform({ streamDetectionService });
        const connected = [];
        platform.connectionManager.connectToStream = async (videoId, createConnection, options) => {
            connected.push({ videoId, reason: options?.reason });
        };
        platform.startMultiStreamMonitoring = createMockFn().mockImplementation(async () => {
            await platform.checkMultiStream({ throwOnError: true });
        });

        await platform.initialize({});

        expect(connected).toEqual([{ videoId: 'v1', reason: 'stream detected' }]);
    });

    it('fails fast when stream detection throws', async () => {
        const streamDetectionService = createStreamDetectionService({
            detectLiveStreams: createMockFn().mockRejectedValue(new Error('detection failed'))
        });

        const platform = createPlatform({ streamDetectionService });
        platform.startMultiStreamMonitoring = createMockFn().mockImplementation(async () => {
            await platform.checkMultiStream({ throwOnError: true });
        });

        await expect(platform.initialize({})).rejects.toThrow();
    });

    it('emits platform events and invokes handler map', () => {
        const platform = createPlatform();
        const handler = createMockFn();
        platform.handlers.onChat = handler;
        const eventSpy = createMockFn();
        platform.on('platform:event', eventSpy);

        platform._emitPlatformEvent('platform:chat-message', {
            platform: 'youtube',
            type: 'chat:event',
            message: { text: 'hi' }
        });

        expect(handler).toHaveBeenCalled();
        expect(eventSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'platform:chat-message',
                data: expect.objectContaining({ message: { text: 'hi' } })
            })
        );
    });

    it('skips remove/delete chat actions in message filtering', () => {
        const platform = createPlatform();
        const skipTypes = [
            'RemoveChatItemAction',
            'RemoveChatItemByAuthorAction',
            'MarkChatItemsByAuthorAsDeletedAction'
        ];

        const results = skipTypes.map((type) => platform._shouldSkipEvent({ type }));

        expect(results).toEqual([true, true, true]);
    });
});
