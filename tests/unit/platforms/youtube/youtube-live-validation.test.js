const { describe, test, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../helpers/mock-factories');

const { YouTubePlatform } = require('../../../../src/platforms/youtube');

describe('YouTubePlatform live validation (modern signals)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const streamDetectionService = { detectLiveStreams: createMockFn() };
    const chatFileLoggingService = { logChatMessage: createMockFn(), close: createMockFn() };

    const baseConfig = {
        enabled: true,
        username: 'demo_channel'
    };

    const createPlatform = () => new YouTubePlatform(baseConfig, {
        logger: noOpLogger,
        streamDetectionService,
        chatFileLoggingService
    });

    it('treats streams with modern live signals (HLS/live_status) as live even when is_live is false', () => {
        const platform = createPlatform();
        const info = {
            basic_info: {
                title: 'Live Stream',
                is_live: false,
                is_live_content: false,
                is_upcoming: false,
                live_status: 'LIVE'
            },
            streaming_data: {
                hls_manifest_url: 'https://www.youtube.example.invalid/hls/manifest'
            },
            playability_status: {
                status: 'OK',
                liveStreamability: { enabled: true }
            }
        };

        const result = platform._validateVideoForConnection('abc123', info);
        expect(result.shouldConnect).toBe(true);
        expect(result.reason).toBe('Stream is live');
    });

    it('blocks upcoming streams until they are live', () => {
        const platform = createPlatform();
        const info = {
            basic_info: {
                is_live: false,
                is_live_content: false,
                is_upcoming: true,
                live_status: 'UPCOMING'
            },
            playability_status: { status: 'OK' }
        };

        const result = platform._validateVideoForConnection('upcoming123', info);
        expect(result.shouldConnect).toBe(false);
        expect(result.reason).toBe('Stream is upcoming but not yet live');
    });

    it('treats VOD/replay without live signals as not live', () => {
        const platform = createPlatform();
        const info = {
            basic_info: {
                is_live: false,
                is_live_content: false,
                is_upcoming: false,
                live_status: 'NONE'
            },
            playability_status: { status: 'OK' }
        };

        const result = platform._validateVideoForConnection('vod123', info);
        expect(result.shouldConnect).toBe(false);
        expect(result.reason).toBe('Video is not live content (replay/VOD)');
    });
});
