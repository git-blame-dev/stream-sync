const { describe, test, expect, beforeEach } = require('bun:test');
export {};
const { createMockFn, clearAllMocks } = require('../../../../helpers/bun-mock-utils');

const {
    installYouTubeParserLogAdapter
} = require('../../../../../src/utils/youtube-parser-log-adapter.ts');
const {
    installYouTubeLiveChatUnknownRendererCapture
} = require('../../../../../src/platforms/youtube/connections/youtube-live-chat-unknown-renderer-capture.ts');

describe('YouTube live chat unknown renderer capture', () => {
    let logger;
    let parserApi;

    beforeEach(() => {
        clearAllMocks();
        logger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
        parserApi = {
            setParserErrorHandler: createMockFn(),
            parseResponse: createMockFn()
        };

        installYouTubeParserLogAdapter({
            logger,
            youtubeModule: { Parser: parserApi }
        });
    });

    test('re-parses raw live chat responses and logs matched unknown renderers', async () => {
        const rawResponse = {
            data: {
                continuationContents: {
                    liveChatContinuation: {
                        actions: [
                            {
                                addChatItemAction: {
                                    item: {
                                        giftMessageView: {
                                            id: 'test-gift-id',
                                            text: {
                                                runs: [{ text: 'sent Clapping seal for 250 Jewels' }]
                                            }
                                        }
                                    }
                                }
                            }
                        ],
                        continuations: [
                            {
                                timedContinuationData: {
                                    continuation: 'test-continuation-2'
                                }
                            }
                        ]
                    }
                }
            }
        };
        const parsedResponse = {
            continuation_contents: {
                continuation: {
                    token: 'test-continuation-2'
                }
            }
        };
        const handler = parserApi.setParserErrorHandler.mock.calls[0][0];
        parserApi.parseResponse.mockImplementation((data) => {
            expect(data).toBe(rawResponse.data);
            handler({
                error_type: 'class_not_found',
                classname: 'GiftMessageView'
            });
            return parsedResponse;
        });

        const execute = createMockFn().mockResolvedValue(rawResponse);
        const actions = {
            execute
        };
        const logUnknownRenderer = createMockFn().mockResolvedValue(undefined);

        installYouTubeLiveChatUnknownRendererCapture({
            actions,
            parser: parserApi,
            videoId: 'test-video-id',
            initialContinuation: 'test-continuation-1',
            logUnknownRenderer
        });

        const result = await actions.execute('live_chat/get_live_chat', {
            continuation: 'test-continuation-1',
            parse: true
        });

        expect(result).toBe(parsedResponse);
        expect(logUnknownRenderer).toHaveBeenCalledTimes(1);
        expect(logUnknownRenderer.mock.calls[0][0]).toMatchObject({
            videoId: 'test-video-id',
            endpoint: 'live_chat/get_live_chat',
            parserWarnings: [
                expect.objectContaining({ className: 'GiftMessageView' })
            ],
            matchedRenderers: [
                expect.objectContaining({
                    className: 'GiftMessageView',
                    rawKey: 'giftMessageView'
                })
            ]
        });
        expect(execute.mock.calls[0][1]).toMatchObject({
            continuation: 'test-continuation-1',
            parse: false
        });
    });

    test('does not write capture logs when the parser sees no unknown renderers', async () => {
        const parsedResponse = {
            continuation_contents: {
                continuation: {
                    token: 'test-continuation-2'
                }
            }
        };
        parserApi.parseResponse.mockReturnValue(parsedResponse);

        const execute = createMockFn().mockResolvedValue({ data: { ok: true } });
        const actions = {
            execute
        };
        const logUnknownRenderer = createMockFn().mockResolvedValue(undefined);

        installYouTubeLiveChatUnknownRendererCapture({
            actions,
            parser: parserApi,
            videoId: 'test-video-id',
            initialContinuation: 'test-continuation-1',
            logUnknownRenderer
        });

        const result = await actions.execute('live_chat/get_live_chat', {
            continuation: 'test-continuation-1',
            parse: true
        });

        expect(result).toBe(parsedResponse);
        expect(logUnknownRenderer).not.toHaveBeenCalled();
    });
});
