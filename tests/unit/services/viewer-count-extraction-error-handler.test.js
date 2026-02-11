const { describe, it, beforeEach, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { ViewerCountExtractionService } = require('../../../src/services/viewer-count-extraction-service');

describe('ViewerCountExtractionService error handler integration', () => {
    let mockInnertube;
    let mockExtractor;
    let mockLogger;

    beforeEach(() => {
        mockInnertube = {
            getVideoInfo: createMockFn()
        };
        mockExtractor = {
            extractConcurrentViewers: createMockFn()
        };
        mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
    });

    it('routes extraction error through error handler at visible log level', async () => {
        mockInnertube.getVideoInfo.mockRejectedValue(new Error('innertube failed'));

        const service = new ViewerCountExtractionService(mockInnertube, {
            logger: mockLogger,
            YouTubeViewerExtractor: mockExtractor
        });

        const result = await service.extractViewerCount('test-vid-1');

        expect(result.success).toBe(false);
        expect(mockLogger.error).toHaveBeenCalled();
        const errorCall = mockLogger.error.mock.calls[0];
        expect(errorCall[0]).toContain('test-vid-1');
    });
});
