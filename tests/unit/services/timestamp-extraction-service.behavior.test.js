const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { useFakeTimers, useRealTimers, setSystemTime } = require('../../helpers/bun-timers');
const TimestampExtractionService = require('../../../src/services/TimestampExtractionService');
const testClock = require('../../helpers/test-clock');

describe('TimestampExtractionService behavior', () => {
    let performanceTracker;

    beforeEach(() => {
        useFakeTimers();
        setSystemTime(new Date(testClock.now()));
        performanceTracker = { recordExtraction: createMockFn() };
        clearAllMocks();
    });

    afterEach(() => {
        useRealTimers();
    });

    it('preserves TikTok common.createTime and returns null when missing', () => {
        const service = new TimestampExtractionService({ logger: noOpLogger, performanceTracker });
        const created = testClock.now() - 120000;

        const fromCreateTime = service.extractTimestamp('tiktok', { common: { createTime: created } });
        expect(new Date(fromCreateTime).getTime()).toBe(created);

        const fallback = service.extractTimestamp('tiktok', {});
        expect(fallback).toBeNull();
    });

    it('converts YouTube microsecond timestamps and returns null for invalid', () => {
        const service = new TimestampExtractionService({ logger: noOpLogger, performanceTracker });
        const micros = testClock.now() * 1000;

        const ts = service.extractTimestamp('youtube', { timestamp_usec: micros.toString() });
        expect(ts).toBe(new Date(Math.floor(micros / 1000)).toISOString());

        const fallback = service.extractTimestamp('youtube', { timestamp: {} });
        expect(fallback).toBeNull();
    });

    it('returns null for unsupported platforms', () => {
        const service = new TimestampExtractionService({ logger: noOpLogger, performanceTracker });

        const result = service.extractTimestamp('unknown', {});

        expect(result).toBeNull();
    });

    it('initializes with runtime config toggles and exposes status', async () => {
        const service = new TimestampExtractionService({ logger: noOpLogger, performanceTracker });

        await service.initialize({ caching: false, metrics: false });

        const status = service.getStatus();
        expect(status.status).toBe('initialized');
        expect(status.state.isInitialized).toBe(true);
        expect(status.config.enableCaching).toBe(false);
        expect(status.config.enableMetrics).toBe(false);
        expect(status.health.status).toBe('degraded');
    });

    it('updates lifecycle state across start, pause, resume, and stop', async () => {
        const service = new TimestampExtractionService({ logger: noOpLogger, performanceTracker });

        await service.start();
        let status = service.getStatus();
        expect(status.status).toBe('running');
        expect(status.state.isInitialized).toBe(true);

        await service.pause();
        status = service.getStatus();
        expect(status.state.isPaused).toBe(true);

        await service.resume();
        status = service.getStatus();
        expect(status.state.isPaused).toBe(false);

        await service.stop();
        status = service.getStatus();
        expect(status.status).toBe('stopped');
    });

    it('tracks cache utilization and error counts for failed extractions', () => {
        const service = new TimestampExtractionService({ logger: noOpLogger, performanceTracker });

        service.extractTimestamp('twitch', { timestamp: '2024-01-01T00:00:00Z' });
        service.extractTimestamp('twitch', { timestamp: 'invalid' });

        const metrics = service.getMetrics();
        expect(metrics.platformDistribution.twitch).toBe(2);
        expect(metrics.errorBreakdown.total).toBe(1);
        expect(metrics.cacheUtilization.size).toBe(2);
    });

    it('omits cache utilization when caching is disabled', () => {
        const service = new TimestampExtractionService({
            logger: noOpLogger,
            performanceTracker,
            enableCaching: false
        });

        const metrics = service.getMetrics();
        expect(metrics.cacheUtilization).toBeNull();
    });

    it('rejects invalid performance tracker and cache configurations', () => {
        expect(() => new TimestampExtractionService({ logger: noOpLogger, performanceTracker: {} }))
            .toThrow('Invalid performanceTracker configuration: missing recordExtraction method');
        expect(() => new TimestampExtractionService({ logger: noOpLogger, cacheLimit: -1 }))
            .toThrow('Invalid cacheLimit configuration: must be a non-negative integer');
    });
});
