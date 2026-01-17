const { describe, test, expect, it } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const {
    ViewerCountProvider,
    TwitchViewerCountProvider,
    YouTubeViewerCountProvider,
    TikTokViewerCountProvider
} = require('../../../src/utils/viewer-count-providers');

describe('ViewerCountProvider error handling', () => {

    it('categorizes unknown errors when message is missing', () => {
        const provider = new ViewerCountProvider('testPlatform', noOpLogger);

        const result = provider._handleProviderError(new Error(''), 'testOperation');

        expect(result).toBe(0);
        expect(provider.getErrorStats().errorTypes.unknown).toBe(1);
    });
});

describe('YouTubeViewerCountProvider readiness and error routes', () => {
    it('returns 0 when active video ids missing', async () => {
        const viewerExtractionService = {
            getAggregatedViewerCount: createMockFn()
        };
        const provider = new YouTubeViewerCountProvider(
            {},
            { apiKey: 'testApiKey' },
            () => [],
            null,
            { viewerExtractionService, logger: noOpLogger }
        );

        const count = await provider.getViewerCount();

        expect(count).toBe(0);
    });

    it('categorizes errors from extraction service and increments error stats', async () => {
        const viewerExtractionService = {
            getAggregatedViewerCount: createMockFn().mockRejectedValue(new Error('network down'))
        };
        const provider = new YouTubeViewerCountProvider(
            {},
            { apiKey: 'testApiKey' },
            () => ['testVideoId1'],
            null,
            { viewerExtractionService, logger: noOpLogger }
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
        const provider = new TikTokViewerCountProvider(platform, { logger: noOpLogger });

        const count = await provider.getViewerCount();

        expect(count).toBe(0);
        expect(provider.getErrorStats().totalErrors).toBe(1);
    });
});

describe('TwitchViewerCountProvider readiness', () => {
    it('returns 0 when provider not ready (missing channel)', async () => {
        const apiClient = { getStreamInfo: createMockFn() };
        const provider = new TwitchViewerCountProvider(apiClient, {}, {}, null, noOpLogger);

        const count = await provider.getViewerCount();

        expect(count).toBe(0);
    });

    it('resets consecutive errors after successful fetch', async () => {
        const apiClient = {
            getStreamInfo: createMockFn()
                .mockRejectedValueOnce(new Error('network fail'))
                .mockResolvedValueOnce({ isLive: true, viewerCount: 15 })
        };
        const provider = new TwitchViewerCountProvider(apiClient, {}, { channel: 'testChannel' }, null, noOpLogger);

        await provider.getViewerCount();
        expect(provider.getErrorStats().consecutiveErrors).toBe(1);

        const count = await provider.getViewerCount();
        expect(count).toBe(15);
        expect(provider.getErrorStats().consecutiveErrors).toBe(0);
    });
});
