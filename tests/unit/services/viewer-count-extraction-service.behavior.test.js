const { describe, it, beforeEach, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { ViewerCountExtractionService } = require('../../../src/services/viewer-count-extraction-service');

const noOpLogger = { debug: () => {} };

describe('ViewerCountExtractionService', () => {
    let mockInnertube;
    let mockExtractor;

    beforeEach(() => {
        mockInnertube = {
            getVideoInfo: createMockFn()
        };
        mockExtractor = {
            extractConcurrentViewers: createMockFn()
        };
    });

    it('returns success with count and updates stats on extraction success', async () => {
        mockInnertube.getVideoInfo.mockResolvedValue({ info: true });
        mockExtractor.extractConcurrentViewers.mockReturnValue({
            success: true,
            count: 123,
            strategy: 'view_text',
            metadata: { attempted: ['view_text'] }
        });

        const service = new ViewerCountExtractionService(mockInnertube, {
            logger: noOpLogger,
            strategies: ['view_text'],
            YouTubeViewerExtractor: mockExtractor
        });

        const result = await service.extractViewerCount('vid1');

        expect(result.success).toBe(true);
        expect(result.count).toBe(123);
        expect(service.stats.totalRequests).toBe(1);
        expect(service.stats.successfulExtractions).toBe(1);
    });

    it('returns failure when extractor does not succeed', async () => {
        mockInnertube.getVideoInfo.mockResolvedValue({ info: true });
        mockExtractor.extractConcurrentViewers.mockReturnValue({
            success: false,
            count: 0,
            metadata: { strategiesAttempted: ['a'] }
        });

        const service = new ViewerCountExtractionService(mockInnertube, {
            logger: noOpLogger,
            YouTubeViewerExtractor: mockExtractor
        });

        const result = await service.extractViewerCount('vid1');

        expect(result.success).toBe(false);
        expect(result.count).toBe(0);
        expect(service.stats.failedExtractions).toBe(1);
    });

    it('returns failure and error message when innertube throws', async () => {
        mockInnertube.getVideoInfo.mockRejectedValue(new Error('boom'));

        const service = new ViewerCountExtractionService(mockInnertube, {
            logger: noOpLogger,
            YouTubeViewerExtractor: mockExtractor
        });

        const result = await service.extractViewerCount('vid1');

        expect(result.success).toBe(false);
        expect(result.error).toBe('boom');
        expect(service.stats.failedExtractions).toBe(1);
    });

    it('handles batch extraction with rejected promises', async () => {
        const service = new ViewerCountExtractionService(mockInnertube, {
            logger: noOpLogger,
            YouTubeViewerExtractor: mockExtractor
        });

        let call = 0;
        service.extractViewerCount = createMockFn((videoId) => {
            call++;
            if (call === 1) {
                return Promise.resolve({ success: true, count: 1, videoId });
            }
            return Promise.reject(new Error('fail'));
        });

        const results = await service.extractViewerCountsBatch(['one', 'two'], { maxConcurrency: 1 });

        expect(results).toHaveLength(2);
        expect(results[0].success).toBe(true);
        expect(results[1].success).toBe(false);
        expect(results[1].errorType).toBe('Promise');
    });

    it('aggregates zero when no video ids provided', async () => {
        const service = new ViewerCountExtractionService(mockInnertube, {
            logger: noOpLogger,
            YouTubeViewerExtractor: mockExtractor
        });

        const result = await service.getAggregatedViewerCount([]);

        expect(result.success).toBe(true);
        expect(result.totalCount).toBe(0);
        expect(result.streams).toHaveLength(0);
    });
});
