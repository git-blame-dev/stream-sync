import { describe, test, expect } from 'bun:test';
import { createMockFn } from '../../../../helpers/bun-mock-utils';
import { noOpLogger } from '../../../../helpers/mock-factories';
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
});
