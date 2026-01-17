const { describe, it, beforeEach, afterEach, expect, jest } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { useFakeTimers, useRealTimers } = require('../../helpers/bun-timers');
const TimestampExtractionService = require('../../../src/services/TimestampExtractionService');
const testClock = require('../../helpers/test-clock');

describe('TimestampExtractionService behavior', () => {
    let performanceTracker;

    beforeEach(() => {
        useFakeTimers();
        jest.setSystemTime(new Date(testClock.now()));
        performanceTracker = { recordExtraction: createMockFn() };
        clearAllMocks();
    });

    afterEach(() => {
        useRealTimers();
    });

    it('preserves TikTok createTime and falls back to current time', () => {
        const service = new TimestampExtractionService({ logger: noOpLogger, performanceTracker });
        const created = testClock.now() - 120000;

        const fromCreateTime = service.extractTimestamp('tiktok', { createTime: created });
        expect(new Date(fromCreateTime).getTime()).toBe(created);

        const fallback = service.extractTimestamp('tiktok', {});
        expect(new Date(fallback).toISOString()).toBe(new Date(testClock.now()).toISOString());
    });

    it('converts YouTube microsecond timestamps and falls back for invalid', () => {
        const service = new TimestampExtractionService({ logger: noOpLogger, performanceTracker });
        const micros = testClock.now() * 1000;

        const ts = service.extractTimestamp('youtube', { timestamp: micros.toString() });
        expect(ts).toBe(new Date(Math.floor(micros / 1000)).toISOString());

        const fallback = service.extractTimestamp('youtube', { timestamp: {} });
        expect(new Date(fallback).toISOString()).toBe(new Date(testClock.now()).toISOString());
    });

    it('falls back to current time for unsupported platforms', () => {
        const service = new TimestampExtractionService({ logger: noOpLogger, performanceTracker });

        const result = service.extractTimestamp('unknown', {});

        expect(result).toBe(new Date(testClock.now()).toISOString());
    });
});
