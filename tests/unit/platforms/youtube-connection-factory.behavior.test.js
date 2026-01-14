const { describe, test, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');

const { createYouTubeConnectionFactory } = require('../../../src/platforms/youtube/connections/youtube-connection-factory');

const createLogger = () => ({
    debug: createMockFn(),
    info: createMockFn(),
    warn: createMockFn(),
    error: createMockFn()
});

const createFactory = ({ validationResult, liveChatBehavior }) => {
    const logger = createLogger();
    const platform = {
        logger,
        _validateVideoForConnection: createMockFn().mockReturnValue(validationResult)
    };

    const liveChat = liveChatBehavior?.value || null;
    const getLiveChat = liveChatBehavior?.error
        ? createMockFn().mockRejectedValue(liveChatBehavior.error)
        : createMockFn().mockResolvedValue(liveChat);

    const info = {
        getLiveChat
    };

    const yt = {
        getInfo: createMockFn().mockResolvedValue(info)
    };

    const manager = {
        getInstance: createMockFn().mockResolvedValue(yt)
    };

    const innertubeInstanceManager = {
        getInstance: createMockFn().mockReturnValue(manager)
    };

    const withTimeout = (promise) => promise;

    const factory = createYouTubeConnectionFactory({
        platform,
        innertubeInstanceManager,
        withTimeout,
        innertubeCreationTimeoutMs: 1000
    });

    return {
        factory,
        liveChat
    };
};

describe('YouTube connection factory', () => {
    test('returns live chat when validation fails but live chat is available', async () => {
        const liveChat = { id: 'live-chat', on: createMockFn() };
        const validationResult = {
            shouldConnect: false,
            reason: 'Video is not live content (replay/VOD)'
        };

        const { factory } = createFactory({
            validationResult,
            liveChatBehavior: { value: liveChat }
        });

        const connection = await factory.createConnection('video-1');

        expect(connection).toBe(liveChat);
    });

    test('throws when validation fails and live chat is unavailable', async () => {
        const validationResult = {
            shouldConnect: false,
            reason: 'Video is not live content (replay/VOD)'
        };

        const { factory } = createFactory({
            validationResult,
            liveChatBehavior: { error: new Error('Live Chat is not available') }
        });

        await expect(factory.createConnection('video-2')).rejects.toThrow(
            'Stream validation failed: Video is not live content (replay/VOD)'
        );
    });
});
