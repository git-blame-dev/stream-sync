
const { describe, test, expect, beforeEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const logger = {
    debug: createMockFn(),
    info: jest.fn?.() || (() => {}),
    warn: jest.fn?.() || (() => {})
};

const {
    ViewerCountProvider,
    TwitchViewerCountProvider,
    YouTubeViewerCountProvider,
    TikTokViewerCountProvider
} = require('../../../src/utils/viewer-count-providers');

describe('ViewerCountProvider base behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    beforeEach(() => {
        });

    it('tracks error stats and categorizes network errors', () => {
        const provider = new ViewerCountProvider('test', logger);
        const result = provider._handleProviderError(new Error('Network timeout'), 'fetch');

        expect(result).toBe(0);
        const stats = provider.getErrorStats();
        expect(stats.totalErrors).toBe(1);
        expect(stats.consecutiveErrors).toBe(1);
        expect(stats.lastError).toBe('Network timeout');
        expect(stats.errorTypes.network).toBe(1);
    });

    it('categorizes auth, rate limit, and resource errors', () => {
        const provider = new ViewerCountProvider('test', logger);
        provider._handleProviderError(new Error('auth failure'), 'fetch');
        provider._handleProviderError(new Error('rate limit exceeded'), 'fetch');
        provider._handleProviderError(new Error('stream not found'), 'fetch');

        const stats = provider.getErrorStats();
        expect(stats.errorTypes.authentication).toBe(1);
        expect(stats.errorTypes.rate_limit).toBe(1);
        expect(stats.errorTypes.resource_not_found).toBe(1);
    });

    it('converts error type map to plain object and tracks unknown errors', () => {
        const provider = new ViewerCountProvider('test', logger);

        provider._handleProviderError(new Error('weird failure'), 'fetch');
        const stats = provider.getErrorStats();

        expect(stats.errorTypes.unknown).toBe(1);
        expect(typeof stats.errorTypes).toBe('object');
    });

    it('handles non-Error inputs without message gracefully', () => {
        const provider = new ViewerCountProvider('test', logger);

        const result = provider._handleProviderError({}, 'fetch');

        expect(result).toBe(0);
        const stats = provider.getErrorStats();
        expect(stats.errorTypes.unknown).toBe(1);
        expect(stats.lastError).toBe('Unknown error');
    });
});

describe('TwitchViewerCountProvider', () => {
    beforeEach(() => {
        clearAllMocks();
    });

    it('returns 0 when not ready', async () => {
        const provider = new TwitchViewerCountProvider({ getStreamInfo: createMockFn() }, {}, {}, null, logger);

        await expect(provider.getViewerCount()).resolves.toBe(0);
    });

    it('returns live viewer count and resets error counters', async () => {
        const provider = new TwitchViewerCountProvider(
            { getStreamInfo: createMockFn().mockResolvedValue({ isLive: true, viewerCount: 42 }) },
            {},
            { channel: 'streamer' },
            null,
            logger
        );

        const count = await provider.getViewerCount();

        expect(count).toBe(42);
        expect(provider.errorStats.consecutiveErrors).toBe(0);
    });
});

describe('YouTubeViewerCountProvider', () => {
    beforeEach(() => {
        clearAllMocks();
    });

    it('returns 0 when required dependencies are missing', async () => {
        const provider = new YouTubeViewerCountProvider({}, {}, null, null, { logger });

        await expect(provider.getViewerCount()).resolves.toBe(0);
    });

    it('aggregates counts across active streams via service layer', async () => {
        const viewerExtractionService = {
            getAggregatedViewerCount: createMockFn().mockResolvedValue({
                success: true,
                totalCount: 75,
                successfulStreams: 1
            })
        };
        const provider = new YouTubeViewerCountProvider(
            {},
            { apiKey: 'abc' },
            () => ['video1'],
            null,
            { viewerExtractionService, logger }
        );

        const count = await provider.getViewerCount();
        expect(count).toBe(75);

        const stats = provider.getStats();
        expect(stats.successRate).toBe('100.00%');
    });

    it('routes service failures through error handler and returns 0', async () => {
        const viewerExtractionService = {
            getAggregatedViewerCount: createMockFn().mockResolvedValue({ success: false })
        };
        const provider = new YouTubeViewerCountProvider(
            {},
            { apiKey: 'abc' },
            () => ['video1'],
            null,
            { viewerExtractionService, logger }
        );

        const count = await provider.getViewerCount();
        expect(count).toBe(0);
        expect(provider.getErrorStats().totalErrors).toBe(1);
    });

    it('returns 0 without incrementing errors when no active streams', async () => {
        const provider = new YouTubeViewerCountProvider(
            {},
            { apiKey: 'abc' },
            () => [],
            null,
            { viewerExtractionService: { getAggregatedViewerCount: createMockFn() }, logger }
        );

        const count = await provider.getViewerCount();

        expect(count).toBe(0);
        expect(provider.getErrorStats().totalErrors).toBe(0);
    });

    it('resets consecutive errors after successful aggregation following a failure', async () => {
        const viewerExtractionService = {
            getAggregatedViewerCount: createMockFn()
                .mockRejectedValueOnce(new Error('network down'))
                .mockResolvedValueOnce({ success: true, totalCount: 5, successfulStreams: 1 })
        };
        const provider = new YouTubeViewerCountProvider(
            {},
            { apiKey: 'abc' },
            () => ['video1'],
            null,
            { viewerExtractionService, logger }
        );

        await provider.getViewerCount();
        expect(provider.errorStats.consecutiveErrors).toBe(1);

        const count = await provider.getViewerCount();

        expect(count).toBe(5);
        expect(provider.errorStats.consecutiveErrors).toBe(0);
    });
});

describe('TikTokViewerCountProvider', () => {
    beforeEach(() => {
        clearAllMocks();
    });

    it('handles missing platform gracefully', async () => {
        const provider = new TikTokViewerCountProvider(null, { logger });

        const count = await provider.getViewerCount();
        expect(count).toBe(0);
        expect(provider.getErrorStats().totalErrors).toBe(1);
    });

    it('returns platform viewer count when available', async () => {
        const platform = {
            connection: { isConnected: true },
            getViewerCount: createMockFn().mockResolvedValue(33)
        };
        const provider = new TikTokViewerCountProvider(platform, { logger });

        const count = await provider.getViewerCount();
        expect(count).toBe(33);
        expect(provider.errorStats.consecutiveErrors).toBe(0);
    });

    it('resets error count on success after previous failure', async () => {
        const platform = {
            connection: { isConnected: true },
            getViewerCount: createMockFn()
                .mockRejectedValueOnce(new Error('network'))
                .mockResolvedValueOnce(10)
        };
        const provider = new TikTokViewerCountProvider(platform, { logger });

        await provider.getViewerCount();
        expect(provider.errorStats.consecutiveErrors).toBe(1);

        const count = await provider.getViewerCount();
        expect(count).toBe(10);
        expect(provider.errorStats.consecutiveErrors).toBe(0);
    });

    it('is not ready when connection missing or disconnected', () => {
        const provider = new TikTokViewerCountProvider({ connection: { connected: false } }, { logger });

        expect(provider.isReady()).toBe(false);
    });
});
