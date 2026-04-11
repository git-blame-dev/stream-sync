const { describe, test, expect } = require('bun:test');
export {};

const { createMockFn } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { createYouTubeConnectionFactory } = require('../../../../../src/platforms/youtube/connections/youtube-connection-factory.ts');

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
});
