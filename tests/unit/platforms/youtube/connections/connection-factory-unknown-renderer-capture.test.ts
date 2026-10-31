import { vi, afterEach, describe, test, expect } from 'bun:test';

import { noOpLogger } from '../../../../helpers/mock-factories';
import { InnertubeFactory } from '../../../../../src/factories/innertube-factory';
import { createYouTubeConnectionFactory } from '../../../../../src/platforms/youtube/connections/youtube-connection-factory';
import { InnertubeService } from '../../../../../src/services/innertube-service';

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
type YouTubeClient = {
    getInfo: (videoId: string, options?: Record<string, unknown>) => Promise<{
        getLiveChat: () => Promise<unknown>;
        actions: LiveChatActions;
        livechat: { continuation: string | null };
    }>;
};

const createFactoryPlatform = (): FactoryPlatform => ({
    logger: noOpLogger,
    config: {},
    isCurrentYouTubeConnection: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true),
    setYouTubeConnectionReady: vi.fn<(videoId: string, attemptId: number) => void>(),
    disconnectFromYouTubeStream: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
    handleChatMessage: vi.fn<FactoryPlatform["handleChatMessage"]>(),
    logRawPlatformData: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
    _validateVideoForConnection: vi.fn<(...args: unknown[]) => { shouldConnect: true; }>().mockReturnValue({ shouldConnect: true }),
    _handleProcessingError: vi.fn<(...args: unknown[]) => unknown>(),
    _extractMessagesFromChatItem: vi.fn<(...args: unknown[]) => never[]>().mockReturnValue([]),
    _shouldSkipMessage: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(false),
    _resolveChatItemAuthorName: vi.fn<(...args: unknown[]) => string>().mockReturnValue('Unknown User')
});

const services: Array<{ dispose(): Promise<void> }> = [];
const createService = (yt: YouTubeClient) => {
    const service = new InnertubeService({ createWithTimeout: async () => yt }, { logger: noOpLogger });
    services.push(service);
    return service;
};

const attemptContext = () => ({ signal: new AbortController().signal, adopt: () => {} });

describe('YouTube connection factory unknown renderer capture wiring', () => {
    afterEach(async () => {
        await Promise.all(services.splice(0).map(service => service.dispose()));
        InnertubeFactory.configure({});
    });

    test('installs unknown renderer capture before creating live chat connections', async () => {
        const liveChat = { id: 'test-live-chat', on() {}, start() {}, stop() {} };
        const getLiveChat = vi.fn<(...args: unknown[]) => Promise<typeof liveChat>>().mockResolvedValue(liveChat);
        const installLiveChatUnknownRendererCapture = vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined);
        const info = {
            getLiveChat: () => getLiveChat(),
            actions: {
                execute: async () => undefined
            },
            livechat: {
                continuation: 'test-live-chat-continuation'
            }
        };
        const getInfo = vi.fn<(...args: unknown[]) => Promise<typeof info>>().mockResolvedValue(info);
        const yt: YouTubeClient = {
            getInfo: (videoId, options) => getInfo(videoId, options)
        };
        const innertubeService = createService(yt);
        const platform = createFactoryPlatform();
        platform._validateVideoForConnection = vi.fn<(...args: unknown[]) => { shouldConnect: true; }>().mockReturnValue({ shouldConnect: true });
        platform.logRawPlatformData = vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined);

        const factory = createYouTubeConnectionFactory({
            platform,
            innertubeService,
            innertubeCreationTimeoutMs: 1000,
            installLiveChatUnknownRendererCapture
        });

        const result = await factory.createConnection('video-unknown-renderer', attemptContext());

        expect(result).not.toBe(liveChat);
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
        const liveChat = { id: 'test-live-chat-sync-installer', on() {}, start() {}, stop() {} };
        const getLiveChat = vi.fn<(...args: unknown[]) => Promise<typeof liveChat>>().mockResolvedValue(liveChat);
        const info = {
            getLiveChat: () => getLiveChat(),
            actions: {
                execute: async () => undefined
            },
            livechat: {
                continuation: null
            }
        };
        const getInfo = vi.fn<(...args: unknown[]) => Promise<typeof info>>().mockResolvedValue(info);
        const yt: YouTubeClient = {
            getInfo: (videoId, options) => getInfo(videoId, options)
        };
        const innertubeService = createService(yt);
        const platform = createFactoryPlatform();
        platform._validateVideoForConnection = vi.fn<(...args: unknown[]) => { shouldConnect: true; }>().mockReturnValue({ shouldConnect: true });
        platform.logRawPlatformData = vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined);
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
            innertubeService,
            innertubeCreationTimeoutMs: 1000,
            installLiveChatUnknownRendererCapture
        });

        const result = await factory.createConnection('video-sync-installer', attemptContext());

        expect(result).not.toBe(liveChat);
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
            parseResponse: vi.fn(() => {
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
            execute: vi.fn<(...args: [string, Record<string, unknown>?]) => Promise<unknown>>().mockResolvedValue(rawResponse)
        };
        const originalExecute = actions.execute;
        const liveChat = { id: 'test-live-chat-default-installer', on() {}, start() {}, stop() {} };
        const info = {
            getLiveChat: vi.fn<(...args: unknown[]) => Promise<typeof liveChat>>().mockResolvedValue(liveChat),
            actions,
            livechat: {
                continuation: 'test-live-chat-continuation'
            }
        };
        const getInfo = vi.fn<(...args: unknown[]) => Promise<typeof info>>().mockResolvedValue(info);
        const yt: YouTubeClient = {
            getInfo: (videoId, options) => getInfo(videoId, options)
        };
        const platform = createFactoryPlatform();
        platform.config = { dataLoggingEnabled: true };
        platform.logRawPlatformData = vi.fn<(...args: unknown[]) => Promise<never>>().mockRejectedValue(new Error('disk full'));
        platform._handleProcessingError = vi.fn<(...args: unknown[]) => unknown>();

        const factory = createYouTubeConnectionFactory({
            platform,
            innertubeService: createService(yt),
            innertubeCreationTimeoutMs: 1000
        });

        await expect(factory.createConnection('video-default-sink', attemptContext())).resolves.not.toBe(liveChat);
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
        const disabledArgs = {
            continuation: 'next-continuation',
            parse: true
        };
        await expect(actions.execute('live_chat/get_live_chat', disabledArgs)).resolves.toBe(rawResponse);

        expect(platform.logRawPlatformData).toHaveBeenCalledTimes(1);
        expect(parser.parseResponse).toHaveBeenCalledTimes(1);
        expect(originalExecute).toHaveBeenLastCalledWith('live_chat/get_live_chat', disabledArgs);
    });
});
