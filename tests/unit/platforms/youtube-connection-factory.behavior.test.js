const { createYouTubeConnectionFactory } = require('../../../src/platforms/youtube/connections/youtube-connection-factory');

const createLogger = () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
});

const createFactory = ({ validationResult, liveChatBehavior }) => {
    const logger = createLogger();
    const platform = {
        logger,
        _validateVideoForConnection: jest.fn().mockReturnValue(validationResult)
    };

    const liveChat = liveChatBehavior?.value || null;
    const getLiveChat = liveChatBehavior?.error
        ? jest.fn().mockRejectedValue(liveChatBehavior.error)
        : jest.fn().mockResolvedValue(liveChat);

    const info = {
        getLiveChat
    };

    const yt = {
        getInfo: jest.fn().mockResolvedValue(info)
    };

    const manager = {
        getInstance: jest.fn().mockResolvedValue(yt)
    };

    const innertubeInstanceManager = {
        getInstance: jest.fn().mockReturnValue(manager)
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
        const liveChat = { id: 'live-chat', on: jest.fn() };
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
