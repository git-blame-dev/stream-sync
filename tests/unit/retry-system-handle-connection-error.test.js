const { describe, test, expect, afterEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { useFakeTimers, useRealTimers, runOnlyPendingTimers } = require('../helpers/bun-timers');

const { RetrySystem } = require('../../src/utils/retry-system');
const { safeSetTimeout, safeDelay } = require('../../src/utils/timeout-validator');

describe('RetrySystem.handleConnectionError', () => {
    const createLogger = () => ({
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn()
    });

    afterEach(() => {
        restoreAllMocks();
        clearAllMocks();
    });

    it('awaits cleanup before scheduling reconnect attempts', async () => {
        const retrySystem = new RetrySystem({ logger: createLogger() });
        retrySystem.isConnected = () => false;
        let retryCount = 0;
        retrySystem.incrementRetryCount = createMockFn().mockImplementation(() => {
            retryCount += 1;
            return 1;
        });
        retrySystem.getRetryCount = createMockFn().mockImplementation(() => retryCount);

        let cleanupResolved = false;
        const cleanupFn = createMockFn(() => new Promise((resolve) => {
            safeSetTimeout(() => {
                cleanupResolved = true;
                resolve();
            }, 1);
        }));
        const reconnectFn = createMockFn();

        retrySystem.handleConnectionError('tiktok', new Error('room-id'), reconnectFn, cleanupFn);

        // Allow cleanup promise and scheduled reconnect to run
        await safeDelay(20);

        expect(reconnectFn).toHaveBeenCalledTimes(1);
        expect(cleanupFn).toHaveBeenCalledTimes(1);
        expect(cleanupResolved).toBe(true);
    });

    it('cancels an in-flight retry timer when a newer error arrives', async () => {
        useFakeTimers();
        try {
            const retrySystem = new RetrySystem({ logger: createLogger() });
            retrySystem.isConnected = () => false;
            retrySystem.incrementRetryCount = createMockFn().mockReturnValue(5);
            retrySystem.getRetryCount = createMockFn().mockReturnValue(1);

            const cleanupFn = createMockFn().mockResolvedValue();
            const reconnectFn = createMockFn();

            retrySystem.handleConnectionError('tiktok', new Error('first'), reconnectFn, cleanupFn);
            retrySystem.handleConnectionError('tiktok', new Error('second'), reconnectFn, cleanupFn);

            await Promise.resolve();
            await Promise.resolve();
            await runOnlyPendingTimers();

            expect(reconnectFn).toHaveBeenCalledTimes(1);
            expect(cleanupFn).toHaveBeenCalledTimes(2);
        } finally {
            useRealTimers();
        }
    });

    it('continues scheduling retries when a scheduled reconnect throws', async () => {
        const retrySystem = new RetrySystem({ logger: createLogger() });
        retrySystem.isConnected = () => false;
        let retryCount = 0;
        retrySystem.incrementRetryCount = createMockFn().mockImplementation(() => {
            retryCount += 1;
            return 1;
        });
        retrySystem.getRetryCount = createMockFn().mockImplementation(() => retryCount);

        const reconnectFn = createMockFn()
            .mockImplementationOnce(() => { throw new Error('scheduled boom'); })
            .mockResolvedValueOnce();
        const cleanupFn = createMockFn().mockResolvedValue();

        retrySystem.handleConnectionError('tiktok', new Error('initial failure'), reconnectFn, cleanupFn);

        // Allow first scheduled attempt to run and trigger recursive scheduling
        await safeDelay(50);

        expect(reconnectFn).toHaveBeenCalledTimes(2);
        expect(retrySystem.getRetryCount('tiktok')).toBeGreaterThanOrEqual(2);
    });
});
