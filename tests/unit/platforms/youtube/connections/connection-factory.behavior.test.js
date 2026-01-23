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
        const handleChatMessageCalls = [];
        const processRegularChatMessageCalls = [];
        const chatUpdateHandlers = {};
        const logRawPlatformDataCalls = [];

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                handleChatMessage: (msg) => handleChatMessageCalls.push(msg),
                _processRegularChatMessage: (msg) => processRegularChatMessageCalls.push(msg),
                _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
                _shouldSkipMessage: createMockFn().mockReturnValue(false),
                logRawPlatformData: async (...args) => { logRawPlatformDataCalls.push(args); },
                setYouTubeConnectionReady: createMockFn(),
                config: { dataLoggingEnabled: true }
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

        const rawChatItem = {
            author: { id: 'UC_TEST_1', name: 'TestUser' },
            text: 'hello there'
        };

        chatUpdateHandlers['chat-update'](rawChatItem);

        expect(logRawPlatformDataCalls).toHaveLength(1);
        expect(logRawPlatformDataCalls[0][0]).toBe('chat');
        expect(logRawPlatformDataCalls[0][1]).toBe(rawChatItem);

        expect(processRegularChatMessageCalls).toHaveLength(0);
        expect(handleChatMessageCalls).toHaveLength(1);
        expect(handleChatMessageCalls[0]).toMatchObject({
            item: {
                type: 'LiveChatTextMessage',
                author: { id: 'UC_TEST_1', name: 'TestUser' },
                message: { text: 'hello there' }
            },
            videoId: 'video-1'
        });
    });

    test('normalizes direct chat-update payloads with timestamp_usec', async () => {
        const handleChatMessage = createMockFn();
        const chatUpdateHandlers = {};

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                handleChatMessage,
                _processRegularChatMessage: createMockFn(),
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
            author: { id: 'UC_TS_1', name: 'TimestampUser' },
            text: 'timestamp check',
            timestamp_usec: '1704067200000000'
        });

        const [handleCall] = handleChatMessage.mock.calls;
        expect(handleCall[0].item.timestamp_usec).toBe('1704067200000000');
    });

    test('normalizes direct chat-update payloads with timestamp when microseconds are missing', async () => {
        const handleChatMessage = createMockFn();
        const chatUpdateHandlers = {};

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                handleChatMessage,
                _processRegularChatMessage: createMockFn(),
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
            author: { id: 'UC_TS_2', name: 'TimestampUser' },
            text: 'timestamp check',
            timestamp: 1704067200000
        });

        const [handleCall] = handleChatMessage.mock.calls;
        expect(handleCall[0].item.timestamp).toBe(1704067200000);
    });

    test('skips direct chat-update payloads with missing author id', async () => {
        const handleChatMessageCalls = [];
        const chatUpdateHandlers = {};
        const logRawPlatformDataCalls = [];

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                handleChatMessage: (msg) => handleChatMessageCalls.push(msg),
                _processRegularChatMessage: createMockFn(),
                _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
                _shouldSkipMessage: createMockFn().mockReturnValue(false),
                logRawPlatformData: async (...args) => { logRawPlatformDataCalls.push(args); },
                setYouTubeConnectionReady: createMockFn(),
                config: { dataLoggingEnabled: true }
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

        const rawChatItem = {
            author: { name: 'MissingIdUser' },
            text: 'hello there'
        };

        chatUpdateHandlers['chat-update'](rawChatItem);

        expect(logRawPlatformDataCalls).toHaveLength(1);
        expect(logRawPlatformDataCalls[0][0]).toBe('chat');
        expect(logRawPlatformDataCalls[0][1]).toBe(rawChatItem);
        expect(handleChatMessageCalls).toHaveLength(0);
    });

    test('marks connection ready on start events and logs initial batches', async () => {
        const connectionReadyCalls = [];
        const startHandlers = {};

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                setYouTubeConnectionReady: (videoId) => connectionReadyCalls.push(videoId),
                handleChatMessage: createMockFn(),
                _processRegularChatMessage: createMockFn(),
                _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
                _shouldSkipMessage: createMockFn().mockReturnValue(false),
                logRawPlatformData: createMockFn().mockResolvedValue(),
                config: { dataLoggingEnabled: false }
            }
        });

        const connection = {
            on: createMockFn((event, handler) => {
                startHandlers[event] = handler;
            }),
            start: createMockFn(),
            removeAllListeners: createMockFn()
        };

        await factory.setupConnectionEventListeners(connection, 'video-1');

        startHandlers.start({ actions: [{ type: 'AddChatItemAction' }, { type: 'AddChatItemAction' }] });

        expect(connectionReadyCalls).toHaveLength(1);
        expect(connectionReadyCalls[0]).toBe('video-1');
    });

    test('handles API errors from live chat with disconnect', async () => {
        const disconnectCalls = [];
        const errorHandlers = {};

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                disconnectFromYouTubeStream: (videoId, reason) => disconnectCalls.push({ videoId, reason }),
                _handleProcessingError: createMockFn(),
                handleChatMessage: createMockFn(),
                _processRegularChatMessage: createMockFn(),
                _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
                _shouldSkipMessage: createMockFn().mockReturnValue(false),
                logRawPlatformData: createMockFn().mockResolvedValue(),
                setYouTubeConnectionReady: createMockFn(),
                config: { dataLoggingEnabled: false }
            }
        });

        const connection = {
            on: createMockFn((event, handler) => {
                errorHandlers[event] = handler;
            }),
            start: createMockFn(),
            removeAllListeners: createMockFn()
        };

        await factory.setupConnectionEventListeners(connection, 'video-1');

        errorHandlers.error(new Error('403 forbidden'));

        expect(disconnectCalls).toHaveLength(1);
        expect(disconnectCalls[0].videoId).toBe('video-1');
        expect(disconnectCalls[0].reason).toBe('API error: 403 forbidden');
    });

    test('does not disconnect on temporary live chat errors', async () => {
        const disconnectCalls = [];
        const errorHandlers = {};

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                disconnectFromYouTubeStream: (videoId, reason) => disconnectCalls.push({ videoId, reason }),
                _handleProcessingError: createMockFn(),
                handleChatMessage: createMockFn(),
                _processRegularChatMessage: createMockFn(),
                _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
                _shouldSkipMessage: createMockFn().mockReturnValue(false),
                logRawPlatformData: createMockFn().mockResolvedValue(),
                setYouTubeConnectionReady: createMockFn(),
                config: { dataLoggingEnabled: false }
            }
        });

        const connection = {
            on: createMockFn((event, handler) => {
                errorHandlers[event] = handler;
            }),
            start: createMockFn(),
            removeAllListeners: createMockFn()
        };

        await factory.setupConnectionEventListeners(connection, 'video-1');

        errorHandlers.error(new Error('503 upstream unavailable'));

        expect(disconnectCalls).toHaveLength(0);
    });

    test('routes complex chat items through extractors and logging', async () => {
        const handleChatMessageCalls = [];
        const chatUpdateHandlers = {};
        const logRawPlatformDataCalls = [];
        const shouldSkipMessage = createMockFn((message) => message.item?.id === 'skip-me');
        const resolveChatItemAuthorName = createMockFn((message) => message.item?.author?.name || 'Author');
        const messages = [
            { item: { id: 'skip-me', type: 'LiveChatTextMessage', message: { text: 'skip' }, author: { name: 'Skip' } } },
            { item: { id: 'process-me', type: 'LiveChatTextMessage', message: { text: 'process' }, author: { name: 'Author' } } }
        ];

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                handleChatMessage: (msg) => handleChatMessageCalls.push(msg),
                _processRegularChatMessage: createMockFn(),
                _extractMessagesFromChatItem: createMockFn().mockReturnValue(messages),
                _shouldSkipMessage: shouldSkipMessage,
                _resolveChatItemAuthorName: resolveChatItemAuthorName,
                logRawPlatformData: async (...args) => { logRawPlatformDataCalls.push(args); },
                setYouTubeConnectionReady: createMockFn(),
                config: { dataLoggingEnabled: true }
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

        const rawChatItem = { type: 'AddChatItemAction' };
        chatUpdateHandlers['chat-update'](rawChatItem);

        expect(handleChatMessageCalls).toHaveLength(1);
        expect(handleChatMessageCalls[0].videoId).toBe('video-1');
        expect(logRawPlatformDataCalls).toHaveLength(1);
        expect(logRawPlatformDataCalls[0][0]).toBe('chat');
        expect(logRawPlatformDataCalls[0][1]).toBe(rawChatItem);
    });

    test('disconnects when live chat ends', async () => {
        const disconnectCalls = [];
        const handlers = {};

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                disconnectFromYouTubeStream: (videoId, reason) => disconnectCalls.push({ videoId, reason }),
                handleChatMessage: createMockFn(),
                _processRegularChatMessage: createMockFn(),
                _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
                _shouldSkipMessage: createMockFn().mockReturnValue(false),
                logRawPlatformData: createMockFn().mockResolvedValue(),
                setYouTubeConnectionReady: createMockFn(),
                config: { dataLoggingEnabled: false }
            }
        });

        const connection = {
            on: createMockFn((event, handler) => {
                handlers[event] = handler;
            }),
            start: createMockFn(),
            removeAllListeners: createMockFn()
        };

        await factory.setupConnectionEventListeners(connection, 'video-1');

        handlers.end();

        expect(disconnectCalls).toHaveLength(1);
        expect(disconnectCalls[0].videoId).toBe('video-1');
        expect(disconnectCalls[0].reason).toBe('stream ended');
    });
});
