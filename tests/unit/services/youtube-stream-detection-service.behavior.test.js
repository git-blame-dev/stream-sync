const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');
const { YouTubeStreamDetectionService } = require('../../../src/services/youtube-stream-detection-service');
const testClock = require('../../helpers/test-clock');

const logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() };

describe('YouTubeStreamDetectionService behavior', () => {
    let dateNowSpy;

    beforeEach(() => {
        clearAllMocks();
        dateNowSpy = spyOn(Date, 'now').mockImplementation(() => testClock.now());
    });

    afterEach(() => {
        restoreAllMocks();
    });

    it('returns error response for invalid channel handle', async () => {
        const service = new YouTubeStreamDetectionService({}, { logger });
        const result = await service.detectLiveStreams(null);

        expect(result.success).toBe(false);
        expect(result.retryable).toBe(false);
        expect(result.message).toContain('Unable to detect streams');
    });

    it('short-circuits when circuit breaker is open', async () => {
        const service = new YouTubeStreamDetectionService({}, { logger });
        service._circuitBreaker.isOpen = true;
        service._circuitBreaker.lastFailureTime = testClock.now();
        service._circuitBreaker.cooldownPeriod = 10_000;

        const result = await service.detectLiveStreams('channel');

        expect(result.success).toBe(false);
        expect(result.retryable).toBe(true);
        expect(service._metrics.totalRequests).toBe(1);
    });

    it('formats successful detection with validated video IDs', async () => {
        const service = new YouTubeStreamDetectionService({}, { logger });
        service._performDetection = createMockFn().mockResolvedValue({
            streams: [{ videoId: 'ABCDEFGHIJK' }, { videoId: 'invalid' }],
            hasContent: true,
            detectionMethod: 'youtubei'
        });

        const result = await service.detectLiveStreams('@test');

        expect(result.success).toBe(true);
        expect(result.videoIds).toEqual(['ABCDEFGHIJK', 'invalid']);
        expect(result.message).toContain('Found 2 live streams');
        expect(result.detectionMethod).toBe('youtubei');
    });

    it('opens circuit breaker after repeated failures', async () => {
        const service = new YouTubeStreamDetectionService({}, { logger });
        service._performDetection = createMockFn().mockRejectedValue(new Error('timeout error'));

        await service.detectLiveStreams('channel');
        await service.detectLiveStreams('channel');
        await service.detectLiveStreams('channel');

        expect(service._circuitBreaker.isOpen).toBe(true);
        expect(service._metrics.failedRequests).toBe(3);
    });
});
