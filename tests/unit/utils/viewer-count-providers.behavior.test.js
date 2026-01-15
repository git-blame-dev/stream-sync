
const { describe, test, expect, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const {
    ViewerCountProvider,
    TwitchViewerCountProvider,
    YouTubeViewerCountProvider,
    TikTokViewerCountProvider
} = require('../../../src/utils/viewer-count-providers');

const logger = {
    debug: createMockFn(),
    info: createMockFn(),
    warn: createMockFn(),
    error: createMockFn()
};

describe('ViewerCountProvider error handling', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('categorizes unknown errors when message is missing', () => {
        const provider = new ViewerCountProvider('test', logger);

        const result = provider._handleProviderError(new Error(''), 'op');

        expect(result).toBe(0);
        expect(provider.getErrorStats().errorTypes.unknown).toBe(1);
    });
});

describe('YouTubeViewerCountProvider readiness and error routes', () => {
    it('returns 0 and logs when active video ids missing', async () => {
        const viewerExtractionService = {
            getAggregatedViewerCount: createMockFn()
        };
        const provider = new YouTubeViewerCountProvider(
            {},
            { apiKey: 'abc' },
            () => [],
            null,
            { viewerExtractionService, logger }
        );

        const count = await provider.getViewerCount();

        expect(count).toBe(0);
        expect(viewerExtractionService.getAggregatedViewerCount).not.toHaveBeenCalled();
    });

    it('categorizes errors from extraction service and increments error stats', async () => {
        const viewerExtractionService = {
            getAggregatedViewerCount: createMockFn().mockRejectedValue(new Error('network down'))
        };
        const provider = new YouTubeViewerCountProvider(
            {},
            { apiKey: 'abc' },
            () => ['vid1'],
            null,
            { viewerExtractionService, logger }
        );

        const count = await provider.getViewerCount();

        expect(count).toBe(0);
        expect(provider.getErrorStats().errorTypes.network).toBe(1);
    });
});

describe('TikTokViewerCountProvider error recovery', () => {
    it('handles missing getViewerCount gracefully', async () => {
        const platform = {
            connection: { isConnected: true }
        };
        const provider = new TikTokViewerCountProvider(platform, { logger });

        const count = await provider.getViewerCount();

        expect(count).toBe(0);
        expect(provider.getErrorStats().totalErrors).toBe(1);
    });
});

describe('TwitchViewerCountProvider readiness', () => {
    it('returns 0 when provider not ready (missing channel)', async () => {
        const apiClient = { getStreamInfo: createMockFn() };
        const provider = new TwitchViewerCountProvider(apiClient, {}, {}, null, logger);

        const count = await provider.getViewerCount();

        expect(count).toBe(0);
        expect(apiClient.getStreamInfo).not.toHaveBeenCalled();
    });

    it('resets consecutive errors after successful fetch', async () => {
        const apiClient = {
            getStreamInfo: createMockFn()
                .mockRejectedValueOnce(new Error('network fail'))
                .mockResolvedValueOnce({ isLive: true, viewerCount: 15 })
        };
        const provider = new TwitchViewerCountProvider(apiClient, {}, { channel: 'chan' }, null, logger);

        await provider.getViewerCount(); // causes error
        expect(provider.getErrorStats().consecutiveErrors).toBe(1);

        const count = await provider.getViewerCount(); // success path
        expect(count).toBe(15);
        expect(provider.getErrorStats().consecutiveErrors).toBe(0);
    });
});
