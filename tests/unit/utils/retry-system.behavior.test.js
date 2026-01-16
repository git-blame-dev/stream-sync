const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { resetModules } = require('../../helpers/bun-module-mocks');

const noOpLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

let safeSetTimeoutSpy;
let safeDelaySpy;
let validateTimeoutSpy;
let validateExponentialBackoffSpy;
let RetrySystem;
let ADAPTIVE_RETRY_CONFIG;

describe('RetrySystem', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    beforeEach(() => {
        resetModules();
        const timeoutValidator = require('../../../src/utils/timeout-validator');
        safeSetTimeoutSpy = spyOn(timeoutValidator, 'safeSetTimeout').mockImplementation((fn) => {
            fn();
            return 1;
        });
        safeDelaySpy = spyOn(timeoutValidator, 'safeDelay').mockImplementation(() => Promise.resolve());
        validateTimeoutSpy = spyOn(timeoutValidator, 'validateTimeout').mockImplementation((delay) => delay);
        validateExponentialBackoffSpy = spyOn(timeoutValidator, 'validateExponentialBackoff').mockImplementation((base, multiplier, retry, max) => {
            const calculated = base * Math.pow(multiplier, retry);
            return calculated > max ? max : calculated;
        });
        ({ RetrySystem, ADAPTIVE_RETRY_CONFIG } = require('../../../src/utils/retry-system'));
    });

    function createMockErrorHandler() {
        return {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
    }

    it('stops retries on authorization errors and cleans up state', () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.errorHandler = createMockErrorHandler();
        const reconnect = createMockFn();
        const cleanup = createMockFn();
        const setState = createMockFn();

        retrySystem.handleConnectionError('Twitch', new Error('401 Unauthorized'), reconnect, cleanup, setState);

        expect(cleanup).toHaveBeenCalled();
        expect(setState).toHaveBeenCalledWith('Twitch', false, null, false);
        expect(reconnect).not.toHaveBeenCalled();
        expect(safeSetTimeoutSpy).not.toHaveBeenCalled();
    });

    it('continues gracefully when connection state reset throws during auth failure', () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.errorHandler = createMockErrorHandler();
        const reconnect = createMockFn();
        const cleanup = createMockFn();
        const setState = createMockFn(() => { throw new Error('state reset failed'); });

        expect(() => retrySystem.handleConnectionError('Twitch', new Error('401 Unauthorized'), reconnect, cleanup, setState))
            .not.toThrow();
        expect(cleanup).toHaveBeenCalled();
        expect(setState).toHaveBeenCalled();
        expect(safeSetTimeoutSpy).not.toHaveBeenCalled();
    });

    it('schedules reconnect with adaptive delay and executes reconnect when not connected', async () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.errorHandler = createMockErrorHandler();
        const reconnect = createMockFn().mockResolvedValue();

        retrySystem.handleConnectionError('TikTok', new Error('temporary failure'), reconnect);
        await Promise.resolve();

        expect(validateTimeoutSpy).toHaveBeenCalled();
        expect(safeSetTimeoutSpy).toHaveBeenCalled();
        expect(reconnect).toHaveBeenCalled();
    });

    it('continues scheduled reconnect when state reset throws inside scheduler', async () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.errorHandler = createMockErrorHandler();
        const reconnect = createMockFn().mockResolvedValue();
        retrySystem.isConnected = createMockFn().mockReturnValue(false);

        retrySystem.handleConnectionError('TikTok', new Error('temporary failure'), reconnect, null, () => { throw new Error('state error'); });
        await Promise.resolve();

        expect(reconnect).toHaveBeenCalled();
    });

    it('halts scheduled reconnects after exceeding max retries', async () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger, constants: { RETRY_MAX_ATTEMPTS: 10 } });
        const errorHandler = createMockErrorHandler();
        retrySystem.errorHandler = errorHandler;
        retrySystem.platformRetryCount.TikTok = 10;

        const reconnect = createMockFn();
        retrySystem.handleConnectionError('TikTok', new Error('fail'), reconnect);
        await Promise.resolve();

        expect(reconnect).not.toHaveBeenCalled();
        expect(retrySystem.platformRetryCount.TikTok).toBeGreaterThanOrEqual(10);
        expect(errorHandler.logOperationalError).toHaveBeenCalled();
    });

    it('halts scheduled reconnects when already over max before increment', async () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger, constants: { RETRY_MAX_ATTEMPTS: 10 } });
        const errorHandler = createMockErrorHandler();
        retrySystem.errorHandler = errorHandler;
        retrySystem.platformRetryCount.YouTube = 50;

        const reconnect = createMockFn();
        retrySystem.handleConnectionError('YouTube', new Error('fail'), reconnect);
        await Promise.resolve();

        expect(reconnect).not.toHaveBeenCalled();
        expect(errorHandler.logOperationalError).toHaveBeenCalled();
    });

    it('does not cap retries when max attempts is set to zero', async () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger, constants: { RETRY_MAX_ATTEMPTS: 0 } });
        retrySystem.errorHandler = createMockErrorHandler();
        retrySystem.platformRetryCount.TikTok = 50;

        const reconnect = createMockFn().mockResolvedValue();
        retrySystem.handleConnectionError('TikTok', new Error('keep trying'), reconnect);
        await Promise.resolve();

        expect(reconnect).toHaveBeenCalled();
        expect(retrySystem.hasExceededMaxRetries('TikTok', 0)).toBe(false);
    });

    it('treats Infinity as unlimited retries', () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.platformRetryCount.YouTube = 999;

        expect(retrySystem.hasExceededMaxRetries('YouTube', Infinity)).toBe(false);
    });

    it('uses configured backoff multiplier for delays', () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.platformRetryCount.TikTok = 0;

        const firstDelay = retrySystem.calculateAdaptiveRetryDelay('TikTok');
        retrySystem.incrementRetryCount('TikTok');
        const secondDelay = retrySystem.calculateAdaptiveRetryDelay('TikTok');

        expect(secondDelay).toBeGreaterThan(firstDelay);
        expect(secondDelay / firstDelay).toBeCloseTo(ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER, 1);
        expect(secondDelay).toBeLessThanOrEqual(ADAPTIVE_RETRY_CONFIG.MAX_DELAY);
    });

    it('waits for async cleanup before scheduling reconnect', async () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.errorHandler = createMockErrorHandler();
        const reconnect = createMockFn().mockResolvedValue();
        const cleanup = createMockFn().mockResolvedValue();

        retrySystem.handleConnectionError('TikTok', new Error('temporary failure'), reconnect, cleanup);
        await Promise.resolve();
        await Promise.resolve();

        expect(cleanup).toHaveBeenCalled();
    });

    it('routes cleanup failures through platform error handler helper', async () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        const errorHandler = createMockErrorHandler();
        retrySystem.errorHandler = errorHandler;
        const reconnect = createMockFn().mockResolvedValue();
        const cleanupError = new Error('cleanup boom');
        const cleanup = createMockFn(() => { throw cleanupError; });

        retrySystem.handleConnectionError('TikTok', new Error('temporary failure'), reconnect, cleanup);
        await Promise.resolve();
        await Promise.resolve();
        await new Promise(setImmediate);

        expect(cleanup).toHaveBeenCalled();
        expect(errorHandler.handleEventProcessingError).toHaveBeenCalledWith(cleanupError, 'cleanup', { platform: 'TikTok' }, expect.any(String), 'TikTok');
    });

    it('skips scheduled reconnect when already connected', async () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.errorHandler = createMockErrorHandler();
        const reconnect = createMockFn();
        retrySystem.isConnected = createMockFn().mockReturnValue(true);

        retrySystem.handleConnectionError('YouTube', new Error('random failure'), reconnect);
        await Promise.resolve();

        expect(reconnect).not.toHaveBeenCalled();
        expect(retrySystem.isConnected).toHaveBeenCalled();
    });

    it('halts executeWithRetry after configured max retries', async () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.errorHandler = createMockErrorHandler();
        const failingCall = createMockFn().mockRejectedValue(new Error('fail-fast'));

        await expect(retrySystem.executeWithRetry('TikTok', failingCall, 1)).rejects.toThrow('fail-fast');

        expect(failingCall).toHaveBeenCalledTimes(1);
    });

    it('executes with retry until success then resets counts', async () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.errorHandler = createMockErrorHandler();
        const execute = createMockFn()
            .mockRejectedValueOnce(new Error('flaky'))
            .mockResolvedValueOnce('ok');

        const result = await retrySystem.executeWithRetry('YouTube', execute, 3);

        expect(result).toBe('ok');
        expect(safeDelaySpy).toHaveBeenCalled();
        expect(retrySystem.getRetryCount('YouTube')).toBe(0);
    });

    it('stops executeWithRetry immediately on non-retryable auth errors', async () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.errorHandler = createMockErrorHandler();
        const unauthorizedCall = createMockFn().mockRejectedValue(new Error('401 Unauthorized'));

        await expect(retrySystem.executeWithRetry('Twitch', unauthorizedCall, 3)).rejects.toThrow('401');

        expect(unauthorizedCall).toHaveBeenCalledTimes(1);
        expect(safeDelaySpy).not.toHaveBeenCalled();
    });

    it('extracts readable error messages from nested structures', () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        expect(retrySystem.extractErrorMessage('simple')).toBe('simple');
        expect(retrySystem.extractErrorMessage({ message: 'oops' })).toBe('oops');
        expect(retrySystem.extractErrorMessage({ error: { message: 'nested' } })).toBe('nested');
        expect(retrySystem.extractErrorMessage({ errors: [{ message: 'array' }] })).toBe('array');
        expect(retrySystem.extractErrorMessage({ code: 500 })).toContain('500');
    });

    it('clears timers and resets counts on success', () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.retryTimers.Twitch = 123;
        retrySystem.platformRetryCount.Twitch = 3;

        retrySystem.handleConnectionSuccess('Twitch', {}, 'reconnect');

        expect(retrySystem.getRetryCount('Twitch')).toBe(0);
        expect(retrySystem.retryTimers.Twitch).toBeUndefined();
    });

    it('routes retry errors through platform error handler helper', () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        const errorHandler = createMockErrorHandler();
        retrySystem.errorHandler = errorHandler;

        retrySystem._handleRetryError('boom', new Error('boom'), 'cleanup', 'TikTok');

        expect(errorHandler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('logs operational errors when non-Error values are provided', () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        const errorHandler = createMockErrorHandler();
        retrySystem.errorHandler = errorHandler;

        retrySystem._handleRetryError('message-only', null, 'retry', 'TikTok');

        expect(errorHandler.logOperationalError).toHaveBeenCalledWith('message-only', 'TikTok', {
            eventType: 'retry',
            platform: 'TikTok'
        });
    });

    it('computes retry statistics and honors cap', () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.platformRetryCount.TikTok = 3;

        const stats = retrySystem.getRetryStatistics();

        expect(stats.TikTok.count).toBe(3);
        expect(stats.TikTok.nextDelay).toBeGreaterThan(0);
        expect(stats.TikTok.totalTime).toBeGreaterThan(0);
        expect(typeof stats.TikTok.hasExceededMax).toBe('boolean');
    });

    it('calculates total retry time with backoff for monitoring', () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.platformRetryCount.YouTube = 2;

        const totalTime = retrySystem.calculateTotalRetryTime('YouTube');

        expect(totalTime).toBeGreaterThan(0);
        const expected = ADAPTIVE_RETRY_CONFIG.BASE_DELAY +
            ADAPTIVE_RETRY_CONFIG.BASE_DELAY * ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER;
        expect(totalTime).toBeCloseTo(expected);
    });

    it('calculates zero total retry time when no retries have occurred', () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });

        expect(retrySystem.calculateTotalRetryTime('TikTok')).toBe(0);
    });

    it('caps total retry time calculation using max delay', () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.platformRetryCount.Twitch = 10;

        const totalTime = retrySystem.calculateTotalRetryTime('Twitch');

        expect(totalTime).toBeGreaterThan(0);
        expect(totalTime).toBeLessThanOrEqual(ADAPTIVE_RETRY_CONFIG.MAX_DELAY * retrySystem.platformRetryCount.Twitch);
    });

    it('caps adaptive retry delay at max when count is high', () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });
        retrySystem.platformRetryCount.YouTube = 50;

        const delay = retrySystem.calculateAdaptiveRetryDelay('YouTube');

        expect(delay).toBeLessThanOrEqual(ADAPTIVE_RETRY_CONFIG.MAX_DELAY);
    });

    it('increments retry count for unknown platform and returns base delay', () => {
        const retrySystem = new RetrySystem({ logger: noOpLogger });

        const delay = retrySystem.incrementRetryCount('Mixer');

        expect(delay).toBeGreaterThan(0);
        expect(retrySystem.getRetryCount('Mixer')).toBe(1);
    });

    it('validates config values with fallback', () => {
        const warnCalled = { value: false };
        const trackingLogger = {
            debug: () => {},
            info: () => {},
            warn: () => { warnCalled.value = true; },
            error: () => {}
        };
        const retrySystem = new RetrySystem({ logger: trackingLogger });
        const value = retrySystem._validateConfigValue('bad', 5000, 'test');

        expect(value).toBe(5000);
        expect(warnCalled.value).toBe(true);
    });

    it('throws when retry configuration is invalid', () => {
        const originalConfig = { ...ADAPTIVE_RETRY_CONFIG };
        ADAPTIVE_RETRY_CONFIG.BASE_DELAY = 0;

        try {
            expect(() => new RetrySystem({ logger: noOpLogger })).toThrow('BASE_DELAY must be positive');
        } finally {
            Object.assign(ADAPTIVE_RETRY_CONFIG, originalConfig);
        }
    });
});
