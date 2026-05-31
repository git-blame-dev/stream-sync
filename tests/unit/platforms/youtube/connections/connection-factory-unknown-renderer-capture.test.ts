import { afterEach, describe, test, expect } from 'bun:test';
import { createMockFn } from '../../../../helpers/bun-mock-utils';
import { noOpLogger } from '../../../../helpers/mock-factories';
import { InnertubeFactory } from '../../../../../src/factories/innertube-factory';
import { createYouTubeConnectionFactory } from '../../../../../src/platforms/youtube/connections/youtube-connection-factory';

type LiveChatActions = {
    execute: (endpoint: string, args?: Record<string, unknown>) => Promise<unknown>;
};

type UnknownRendererCaptureInstallerOptions = {
    actions: LiveChatActions;
    videoId: string;
    initialContinuation: string | null;
};

type FactoryOptions = NonNullable<Parameters<typeof createYouTubeConnectionFactory>[0]>;
type FactoryPlatform = NonNullable<FactoryOptions['platform']>;
type InnertubeInstanceManager = NonNullable<FactoryOptions['innertubeInstanceManager']>;
type YouTubeClient = {
    getInfo: (videoId: string, options: { client: string }) => Promise<{
        getLiveChat: () => Promise<unknown>;
        actions: LiveChatActions;
        livechat: { continuation: string | null };
    }>;
};

const createFactoryPlatform = (): FactoryPlatform => ({
    logger: noOpLogger,
    config: {},
    setYouTubeConnectionReady: createMockFn(),
    disconnectFromYouTubeStream: createMockFn().mockResolvedValue(true),
    handleChatMessage: createMockFn(),
    logRawPlatformData: createMockFn().mockResolvedValue(undefined),
    _validateVideoForConnection: createMockFn().mockReturnValue({ shouldConnect: true }),
    _handleProcessingError: createMockFn(),
    _extractMessagesFromChatItem: createMockFn().mockReturnValue([]),
    _shouldSkipMessage: createMockFn().mockReturnValue(false),
    _resolveChatItemAuthorName: createMockFn().mockReturnValue('Unknown User')
});

const createInnertubeInstanceManager = (yt: YouTubeClient): InnertubeInstanceManager => {
    const manager = {
        getInstance: async <T>(_key: string, _factory: () => Promise<T>) => yt as T
    };
    return {
        getInstance: () => manager
    };
};

const withTimeout = <T>(promise: Promise<T>) => promise;

describe('YouTube connection factory unknown renderer capture wiring', () => {
    afterEach(() => {
        InnertubeFactory.configure({});
    });

    test('installs unknown renderer capture before creating live chat connections', async () => {
        const liveChat = { id: 'test-live-chat' };
        const getLiveChat = createMockFn().mockResolvedValue(liveChat);
        const installLiveChatUnknownRendererCapture = createMockFn().mockResolvedValue(undefined);
        const info = {
            getLiveChat: () => getLiveChat(),
            actions: {
                execute: async () => undefined
            },
            livechat: {
                continuation: 'test-live-chat-continuation'
            }
        };
        const getInfo = createMockFn().mockResolvedValue(info);
        const yt: YouTubeClient = {
            getInfo: (videoId, options) => getInfo(videoId, options)
        };
        const innertubeInstanceManager = createInnertubeInstanceManager(yt);
        const platform = createFactoryPlatform();
        platform._validateVideoForConnection = createMockFn().mockReturnValue({ shouldConnect: true });
        platform.logRawPlatformData = createMockFn().mockResolvedValue(undefined);

        const factory = createYouTubeConnectionFactory({
            platform,
            innertubeInstanceManager,
            withTimeout,
            innertubeCreationTimeoutMs: 1000,
            installLiveChatUnknownRendererCapture
        });

        const result = await factory.createConnection('video-unknown-renderer');

        expect(result).toBe(liveChat);
        expect(installLiveChatUnknownRendererCapture).toHaveBeenCalledTimes(1);
        const [installerCall] = installLiveChatUnknownRendererCapture.mock.calls;
        expect(installerCall).toBeDefined();
        if (!installerCall) {
            throw new Error('expected installer to be called');
        }
        expect(installerCall[0]).toMatchObject({
            videoId: 'video-unknown-renderer',
            initialContinuation: 'test-live-chat-continuation',
            actions: info.actions
        });
        expect(getLiveChat).toHaveBeenCalledTimes(1);
    });

    test('supports synchronous unknown renderer capture installers', async () => {
        const liveChat = { id: 'test-live-chat-sync-installer' };
        const getLiveChat = createMockFn().mockResolvedValue(liveChat);
        const info = {
            getLiveChat: () => getLiveChat(),
            actions: {
                execute: async () => undefined
            },
            livechat: {
                continuation: null
            }
        };
        const getInfo = createMockFn().mockResolvedValue(info);
        const yt: YouTubeClient = {
            getInfo: (videoId, options) => getInfo(videoId, options)
        };
        const innertubeInstanceManager = createInnertubeInstanceManager(yt);
        const platform = createFactoryPlatform();
        platform._validateVideoForConnection = createMockFn().mockReturnValue({ shouldConnect: true });
        platform.logRawPlatformData = createMockFn().mockResolvedValue(undefined);
        const installerCalls: UnknownRendererCaptureInstallerOptions[] = [];
        const installLiveChatUnknownRendererCapture: NonNullable<FactoryOptions['installLiveChatUnknownRendererCapture']> = (options) => {
            installerCalls.push({
                actions: options.actions,
                videoId: options.videoId,
                initialContinuation: options.initialContinuation ?? null
            });
        };

        const factory = createYouTubeConnectionFactory({
            platform,
            innertubeInstanceManager,
            withTimeout,
            innertubeCreationTimeoutMs: 1000,
            installLiveChatUnknownRendererCapture
        });

        const result = await factory.createConnection('video-sync-installer');

        expect(result).toBe(liveChat);
        expect(installerCalls).toHaveLength(1);
        const [installerCall] = installerCalls;
        expect(installerCall).toBeDefined();
        if (!installerCall) {
            throw new Error('expected installer to be called');
        }
        expect(installerCall).toMatchObject({
            videoId: 'video-sync-installer',
            initialContinuation: null,
            actions: info.actions
        });
        expect(getLiveChat).toHaveBeenCalledTimes(1);
    });

    test('default unknown renderer sink logs only when enabled and does not disrupt execute on logging errors', async () => {
        let parserErrorHandler: ((context?: Record<string, unknown>) => void) | undefined;
        const parsedResponse = {
            continuation_contents: {
                continuation: {
                    token: 'next-continuation'
                }
            }
        };
        const parser = {
            setParserErrorHandler: (handler: (context?: Record<string, unknown>) => void) => {
                parserErrorHandler = handler;
            },
            parseResponse: createMockFn().mockImplementation(() => {
                parserErrorHandler?.({
                    error_type: 'class_not_found',
                    classname: 'GiftMessageView'
                });
                return parsedResponse;
            })
        };
        InnertubeFactory.configure({
            importer: async () => ({
                Innertube: { create: async () => ({}) },
                Parser: parser
            })
        });
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
                                            text: { runs: [{ text: 'sent Girl power for 300 Jewels' }] }
                                        }
                                    }
                                }
                            }
                        ]
                    }
                }
            }
        };
        const actions: LiveChatActions = {
            execute: createMockFn<[string, Record<string, unknown>?], Promise<unknown>>().mockResolvedValue(rawResponse)
        };
        const liveChat = { id: 'test-live-chat-default-installer' };
        const info = {
            getLiveChat: createMockFn().mockResolvedValue(liveChat),
            actions,
            livechat: {
                continuation: 'test-live-chat-continuation'
            }
        };
        const getInfo = createMockFn().mockResolvedValue(info);
        const yt: YouTubeClient = {
            getInfo: (videoId, options) => getInfo(videoId, options)
        };
        const platform = createFactoryPlatform();
        platform.config = { dataLoggingEnabled: true };
        platform.logRawPlatformData = createMockFn().mockRejectedValue(new Error('disk full'));
        platform._handleProcessingError = createMockFn();

        const factory = createYouTubeConnectionFactory({
            platform,
            innertubeInstanceManager: createInnertubeInstanceManager(yt),
            withTimeout,
            innertubeCreationTimeoutMs: 1000
        });

        await expect(factory.createConnection('video-default-sink')).resolves.toBe(liveChat);
        await expect(actions.execute('live_chat/get_live_chat', {
            continuation: 'test-live-chat-continuation',
            parse: true
        })).resolves.toBe(parsedResponse);

        expect(platform.logRawPlatformData).toHaveBeenCalledWith(
            'unknown-renderer',
            expect.objectContaining({
                videoId: 'video-default-sink',
                endpoint: 'live_chat/get_live_chat'
            })
        );
        expect(platform._handleProcessingError).toHaveBeenCalledWith(
            expect.stringContaining('Error logging YouTube unknown renderer data'),
            expect.any(Error),
            'data-logging',
            expect.objectContaining({
                videoId: 'video-default-sink',
                endpoint: 'live_chat/get_live_chat'
            })
        );

        platform.config = { dataLoggingEnabled: false };
        await actions.execute('live_chat/get_live_chat', {
            continuation: 'next-continuation',
            parse: true
        });

        expect(platform.logRawPlatformData).toHaveBeenCalledTimes(1);
    });
});
