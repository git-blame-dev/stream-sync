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

type FactoryOptions = Parameters<typeof createYouTubeConnectionFactory>[0];

describe('YouTube connection factory unknown renderer capture wiring', () => {
    test('installs unknown renderer capture before creating live chat connections', async () => {
        const liveChat = { id: 'test-live-chat' };
        const getLiveChat = createMockFn().mockResolvedValue(liveChat);
        const installLiveChatUnknownRendererCapture = createMockFn().mockResolvedValue(undefined);
        const info = {
            getLiveChat,
            actions: {
                execute: createMockFn()
            },
            livechat: {
                continuation: 'test-live-chat-continuation'
            }
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
        const withTimeout = createMockFn((promise) => promise);
        const platform = {
            logger: noOpLogger,
            _validateVideoForConnection: createMockFn().mockReturnValue({ shouldConnect: true }),
            logRawPlatformData: createMockFn().mockResolvedValue(undefined)
        };

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
        expect(installLiveChatUnknownRendererCapture.mock.calls[0][0]).toMatchObject({
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
            getLiveChat,
            actions: {
                execute: createMockFn()
            },
            livechat: {
                continuation: null
            }
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
        const withTimeout = createMockFn((promise: Promise<unknown>) => promise);
        const platform = {
            logger: noOpLogger,
            _validateVideoForConnection: createMockFn().mockReturnValue({ shouldConnect: true }),
            logRawPlatformData: createMockFn().mockResolvedValue(undefined)
        };
        const installerCalls: UnknownRendererCaptureInstallerOptions[] = [];
        const installLiveChatUnknownRendererCapture: NonNullable<FactoryOptions['installLiveChatUnknownRendererCapture']> = (options) => {
            installerCalls.push(options);
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
        expect(installerCalls[0]).toMatchObject({
            videoId: 'video-sync-installer',
            initialContinuation: null,
            actions: info.actions
        });
        expect(getLiveChat).toHaveBeenCalledTimes(1);
    });
});
