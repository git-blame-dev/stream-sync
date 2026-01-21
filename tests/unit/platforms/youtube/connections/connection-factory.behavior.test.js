const { describe, test, expect } = require('bun:test');
const { createMockFn } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');

const { createYouTubeConnectionFactory } = require('../../../../../src/platforms/youtube/connections/youtube-connection-factory');

const createFactory = ({ validationResult, liveChatBehavior, platformOverrides } = {}) => {
    const platform = {
        logger: noOpLogger,
        _validateVideoForConnection: createMockFn().mockReturnValue(validationResult),
        ...(platformOverrides || {})
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

    test('normalizes direct chat-update payloads before handleChatMessage', async () => {
        const handleChatMessage = createMockFn();
        const processRegularChatMessage = createMockFn();
        const chatUpdateHandlers = {};

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                handleChatMessage,
                _processRegularChatMessage: processRegularChatMessage,
                _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
                _shouldSkipMessage: createMockFn().mockReturnValue(false),
                logRawPlatformData: createMockFn().mockResolvedValue(),
                setYouTubeConnectionReady: createMockFn(),
                config: { dataLoggingEnabled: false }
            }
        });

        const connection = {
            on: createMockFn((event, handler) => {
                chatUpdateHandlers[event] = handler;
            }),
            start: createMockFn(),
            removeAllListeners: createMockFn()
        };

        await factory.setupConnectionEventListeners(connection, 'video-1');

        chatUpdateHandlers['chat-update']({
            author: { id: 'UC_TEST_1', name: 'TestUser' },
            text: 'hello there'
        });

        expect(processRegularChatMessage).toHaveBeenCalledTimes(0);
        const [handleCall] = handleChatMessage.mock.calls;
        expect(handleCall).toBeTruthy();
        expect(handleCall[0]).toMatchObject({
            item: {
                type: 'LiveChatTextMessage',
                author: { id: 'UC_TEST_1', name: 'TestUser' },
                message: { text: 'hello there' }
            },
            videoId: 'video-1'
        });
    });
});
