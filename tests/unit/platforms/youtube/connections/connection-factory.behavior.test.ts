const { describe, test, expect } = require('bun:test');
const { createMockFn } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');

const { createYouTubeConnectionFactory } = require('../../../../../src/platforms/youtube/connections/youtube-connection-factory.ts');

const createFactory = ({ validationResult, liveChatBehavior, platformOverrides, withTimeoutImplementation } = {}) => {
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

    const withTimeout = createMockFn(withTimeoutImplementation || ((promise) => promise));

    const factory = createYouTubeConnectionFactory({
        platform,
        innertubeInstanceManager,
        withTimeout,
        innertubeCreationTimeoutMs: 1000
    });

    return {
        factory,
        liveChat,
        getLiveChat,
        withTimeout
    };
};

describe('YouTube connection factory', () => {
    test('throws immediately when stream validation says not to connect', async () => {
        const liveChat = { id: 'live-chat', on: createMockFn() };
        const validationResult = {
            shouldConnect: false,
            reason: 'Video is not live content (replay/VOD)'
        };

        const { factory, getLiveChat } = createFactory({
            validationResult,
            liveChatBehavior: { value: liveChat }
        });

        await expect(factory.createConnection('video-1')).rejects.toThrow(
            'Stream validation failed: Video is not live content (replay/VOD)'
        );
        expect(getLiveChat).toHaveBeenCalledTimes(0);
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

    test('uses timeout wrapper for getLiveChat on valid streams', async () => {
        const liveChat = { id: 'live-chat', on: createMockFn() };

        const { factory, withTimeout } = createFactory({
            validationResult: {
                shouldConnect: true,
                reason: 'Stream is live'
            },
            liveChatBehavior: { value: liveChat }
        });

        await factory.createConnection('video-3');

        expect(withTimeout).toHaveBeenCalledTimes(2);
        expect(withTimeout.mock.calls[1][1]).toBe(1000);
        expect(withTimeout.mock.calls[1][2]).toBe('YouTube getLiveChat call');
    });

    test('surfaces timeout-wrapper rejections from getLiveChat on valid streams', async () => {
        const getLiveChatTimeoutError = new Error('YouTube getLiveChat call timeout after 1000ms');
        const withTimeoutImplementation = (promise, _timeoutMs, operationName) => {
            if (operationName === 'YouTube getInfo stream info call') {
                return promise;
            }

            if (operationName === 'YouTube getLiveChat call') {
                return Promise.reject(getLiveChatTimeoutError);
            }

            return promise;
        };

        const { factory } = createFactory({
            validationResult: {
                shouldConnect: true,
                reason: 'Stream is live'
            },
            liveChatBehavior: { value: { id: 'unused-live-chat' } },
            withTimeoutImplementation
        });

        await expect(factory.createConnection('video-4')).rejects.toThrow(
            'YouTube getLiveChat call timeout after 1000ms'
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

    test('forwards complex YouTube gift purchase announcements so header author hydration can run', async () => {
        const handleChatMessage = createMockFn();
        const extractMessagesFromChatItem = createMockFn().mockReturnValue([
            {
                type: 'AddChatItemAction',
                item: {
                    type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement',
                    id: 'LCC.test-gift-purchase-connection-001',
                    timestamp_usec: '1704067200000000',
                    author_external_channel_id: 'UC_TEST_GIFTER_001',
                    header: {
                        type: 'LiveChatSponsorshipsHeader',
                        author_name: {
                            text: '@GiftGiver',
                            rtl: false
                        },
                        author_photo: [
                            {
                                url: 'https://example.invalid/yt-gift-giver.png',
                                width: 64,
                                height: 64
                            }
                        ],
                        author_badges: []
                    },
                    giftMembershipsCount: 5,
                    message: { text: '' }
                }
            }
        ]);
        const chatUpdateHandlers = {};

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                handleChatMessage,
                _processRegularChatMessage: createMockFn(),
                _extractMessagesFromChatItem: extractMessagesFromChatItem,
                _shouldSkipMessage: createMockFn().mockReturnValue(false),
                logRawPlatformData: createMockFn().mockResolvedValue(),
                setYouTubeConnectionReady: createMockFn(),
                _resolveChatItemAuthorName: createMockFn().mockReturnValue(''),
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
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement'
            }
        });

        expect(handleChatMessage).toHaveBeenCalledTimes(1);
        expect(handleChatMessage.mock.calls[0][0]).toMatchObject({
            videoId: 'video-1',
            item: {
                type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement',
                author_external_channel_id: 'UC_TEST_GIFTER_001',
                header: {
                    author_name: {
                        text: '@GiftGiver'
                    }
                },
                giftMembershipsCount: 5
            }
        });
    });

    test('still skips non-gift complex chat updates when author is missing', async () => {
        const handleChatMessage = createMockFn();
        const extractMessagesFromChatItem = createMockFn().mockReturnValue([
            {
                type: 'AddChatItemAction',
                item: {
                    type: 'LiveChatTickerSponsorItem',
                    id: 'LCC.test-non-gift-missing-author-001',
                    timestamp_usec: '1704067200000000',
                    message: { text: '' }
                }
            }
        ]);
        const chatUpdateHandlers = {};

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                handleChatMessage,
                _processRegularChatMessage: createMockFn(),
                _extractMessagesFromChatItem: extractMessagesFromChatItem,
                _shouldSkipMessage: createMockFn().mockReturnValue(false),
                logRawPlatformData: createMockFn().mockResolvedValue(),
                setYouTubeConnectionReady: createMockFn(),
                _resolveChatItemAuthorName: createMockFn().mockReturnValue(''),
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
            type: 'AddChatItemAction',
            item: {
                type: 'LiveChatTickerSponsorItem'
            }
        });

        expect(handleChatMessage).not.toHaveBeenCalled();
    });

    test('marks connection ready on start events, logs initial batches, and applies live chat mode', async () => {
        const connectionReadyCalls = [];
        const startHandlers = {};
        let selectedChatFilter = null;
        let applyFilterCalls = 0;

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                setYouTubeConnectionReady: (videoId) => connectionReadyCalls.push(videoId),
                handleChatMessage: createMockFn(),
                _processRegularChatMessage: createMockFn(),
                _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
                _shouldSkipMessage: createMockFn().mockReturnValue(false),
                logRawPlatformData: createMockFn().mockResolvedValue(),
                config: { dataLoggingEnabled: false, chatMode: 'live' }
            }
        });

        const connection = {
            on: createMockFn((event, handler) => {
                startHandlers[event] = handler;
            }),
            applyFilter: (filter) => {
                applyFilterCalls += 1;
                selectedChatFilter = filter;
            },
            start: createMockFn(),
            removeAllListeners: createMockFn()
        };

        await factory.setupConnectionEventListeners(connection, 'video-1');

        startHandlers.start({
            header: {
                view_selector: {
                    sub_menu_items: [
                        { selected: true, continuation: 'top-cont' },
                        { selected: false, continuation: 'live-cont' }
                    ]
                }
            },
            actions: [{ type: 'AddChatItemAction' }, { type: 'AddChatItemAction' }]
        });

        expect(applyFilterCalls).toBe(1);
        expect(selectedChatFilter).toBe('LIVE_CHAT');
        expect(connectionReadyCalls).toHaveLength(1);
        expect(connectionReadyCalls[0]).toBe('video-1');
    });

    test('applies top chat mode when configured', async () => {
        const startHandlers = {};
        let selectedChatFilter = null;
        let applyFilterCalls = 0;

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                setYouTubeConnectionReady: createMockFn(),
                handleChatMessage: createMockFn(),
                _processRegularChatMessage: createMockFn(),
                _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
                _shouldSkipMessage: createMockFn().mockReturnValue(false),
                logRawPlatformData: createMockFn().mockResolvedValue(),
                config: { dataLoggingEnabled: false, chatMode: 'top' }
            }
        });

        const connection = {
            on: createMockFn((event, handler) => {
                startHandlers[event] = handler;
            }),
            applyFilter: (filter) => {
                applyFilterCalls += 1;
                selectedChatFilter = filter;
            },
            start: createMockFn(),
            removeAllListeners: createMockFn()
        };

        await factory.setupConnectionEventListeners(connection, 'video-1');

        startHandlers.start({
            header: {
                view_selector: {
                    sub_menu_items: [
                        { selected: false, continuation: 'top-cont' },
                        { selected: true, continuation: 'live-cont' }
                    ]
                }
            },
            actions: []
        });

        expect(applyFilterCalls).toBe(1);
        expect(selectedChatFilter).toBe('TOP_CHAT');
    });

    test('keeps connection ready when chat mode selector is unavailable', async () => {
        const startHandlers = {};
        let selectedChatFilter = null;
        const connectionReadyCalls = [];

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                setYouTubeConnectionReady: (videoId) => connectionReadyCalls.push(videoId),
                handleChatMessage: createMockFn(),
                _processRegularChatMessage: createMockFn(),
                _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
                _shouldSkipMessage: createMockFn().mockReturnValue(false),
                logRawPlatformData: createMockFn().mockResolvedValue(),
                config: { dataLoggingEnabled: false, chatMode: 'live' }
            }
        });

        const connection = {
            on: createMockFn((event, handler) => {
                startHandlers[event] = handler;
            }),
            applyFilter: (filter) => {
                selectedChatFilter = filter;
            },
            start: createMockFn(),
            removeAllListeners: createMockFn()
        };

        await factory.setupConnectionEventListeners(connection, 'video-1');

        startHandlers.start({ actions: [] });

        expect(selectedChatFilter).toBeNull();
        expect(connectionReadyCalls).toHaveLength(1);
        expect(connectionReadyCalls[0]).toBe('video-1');
    });

    test('does not apply filter when requested chat mode is already selected', async () => {
        const startHandlers = {};
        let selectedChatFilter = null;

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                setYouTubeConnectionReady: createMockFn(),
                handleChatMessage: createMockFn(),
                _processRegularChatMessage: createMockFn(),
                _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
                _shouldSkipMessage: createMockFn().mockReturnValue(false),
                logRawPlatformData: createMockFn().mockResolvedValue(),
                config: { dataLoggingEnabled: false, chatMode: 'live' }
            }
        });

        const connection = {
            on: createMockFn((event, handler) => {
                startHandlers[event] = handler;
            }),
            applyFilter: (filter) => {
                selectedChatFilter = filter;
            },
            start: createMockFn(),
            removeAllListeners: createMockFn()
        };

        await factory.setupConnectionEventListeners(connection, 'video-1');

        startHandlers.start({
            header: {
                view_selector: {
                    sub_menu_items: [
                        { selected: false, continuation: 'top-cont' },
                        { selected: true, continuation: null }
                    ]
                }
            },
            actions: []
        });

        expect(selectedChatFilter).toBeNull();
    });

    test('reports processing error when applyFilter throws', async () => {
        const startHandlers = {};
        const processingErrors = [];
        const applyFilter = createMockFn(() => {
            throw new Error('filter failed');
        });

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                setYouTubeConnectionReady: createMockFn(),
                _handleProcessingError: (...args) => processingErrors.push(args),
                handleChatMessage: createMockFn(),
                _processRegularChatMessage: createMockFn(),
                _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
                _shouldSkipMessage: createMockFn().mockReturnValue(false),
                logRawPlatformData: createMockFn().mockResolvedValue(),
                config: { dataLoggingEnabled: false, chatMode: 'live' }
            }
        });

        const connection = {
            on: createMockFn((event, handler) => {
                startHandlers[event] = handler;
            }),
            applyFilter,
            start: createMockFn(),
            removeAllListeners: createMockFn()
        };

        await factory.setupConnectionEventListeners(connection, 'video-1');

        startHandlers.start({
            header: {
                view_selector: {
                    sub_menu_items: [
                        { selected: true, continuation: 'top-cont' },
                        { selected: false, continuation: 'live-cont' }
                    ]
                }
            },
            actions: []
        });

        expect(processingErrors).toHaveLength(1);
        expect(processingErrors[0][2]).toBe('chat-mode');
    });

    test('handles API errors from live chat with disconnect', async () => {
        const disconnectCalls = [];
        const errorHandlers = {};

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                disconnectFromYouTubeStream: (videoId, reason, options) => disconnectCalls.push({ videoId, reason, options }),
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
        expect(disconnectCalls[0].options).toBeUndefined();
    });

    test('does not disconnect on temporary live chat errors', async () => {
        const disconnectCalls = [];
        const errorHandlers = {};

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                disconnectFromYouTubeStream: (videoId, reason, options) => disconnectCalls.push({ videoId, reason, options }),
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

    test('passes immediate-refresh context for terminal non-API errors', async () => {
        const disconnectCalls = [];
        const errorHandlers = {};

        const { factory } = createFactory({
            validationResult: { shouldConnect: true },
            platformOverrides: {
                disconnectFromYouTubeStream: (videoId, reason, options) => disconnectCalls.push({ videoId, reason, options }),
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

        errorHandlers.error(new Error('Unexpected live chat incremental continuation response'));

        expect(disconnectCalls).toHaveLength(1);
        expect(disconnectCalls[0]).toEqual({
            videoId: 'video-1',
            reason: 'Error: Unexpected live chat incremental continuation response',
            options: { requestImmediateRefresh: true, source: 'livechat-error' }
        });
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
                disconnectFromYouTubeStream: (videoId, reason, options) => disconnectCalls.push({ videoId, reason, options }),
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
        expect(disconnectCalls[0].options).toEqual({ requestImmediateRefresh: true, source: 'livechat-end' });
    });
});
