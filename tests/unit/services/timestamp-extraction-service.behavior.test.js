const TimestampExtractionService = require('../../../src/services/TimestampExtractionService');

const testClock = require('../../helpers/test-clock');

describe('TimestampExtractionService behavior', () => {
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), isDebugEnabled: () => false };
    const performanceTracker = { recordExtraction: jest.fn() };

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(testClock.now()));
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('preserves TikTok createTime and falls back to current time', () => {
        const service = new TimestampExtractionService({ logger, performanceTracker });
        const created = testClock.now() - 120000;

        const fromCreateTime = service.extractTimestamp('tiktok', { createTime: created });
        expect(new Date(fromCreateTime).getTime()).toBe(created);

        const fallback = service.extractTimestamp('tiktok', {});
        expect(new Date(fallback).toISOString()).toBe(new Date(testClock.now()).toISOString());
    });

    it('converts YouTube microsecond timestamps and warns on invalid', () => {
        const service = new TimestampExtractionService({ logger, performanceTracker });
        const micros = testClock.now() * 1000;

        const ts = service.extractTimestamp('youtube', { timestamp: micros.toString() });
        expect(ts).toBe(new Date(Math.floor(micros / 1000)).toISOString());

        service.extractTimestamp('youtube', { timestamp: {} });
        expect(logger.warn).toHaveBeenCalled();
    });

    it('routes unsupported platform errors through handler and falls back', () => {
        const service = new TimestampExtractionService({ logger, performanceTracker });

        const result = service.extractTimestamp('unknown', {});
        const [logMessage, logContext, metadata] = logger.error.mock.calls[0];

        expect(logMessage).toContain('Timestamp extraction failed for unknown');
        expect(logContext).toBe('timestamp-service');
        expect(metadata).toMatchObject({ eventType: 'unsupported-platform' });
        expect(result).toBe(new Date(testClock.now()).toISOString());
    });
});
