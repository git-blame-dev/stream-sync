const { describe, test, expect, afterEach } = require('bun:test');

const { RetrySystem } = require('../../src/utils/retry-system');
const { safeDelay } = require('../../src/utils/timeout-validator');
const { noOpLogger } = require('../helpers/mock-factories');

describe('RetrySystem.handleConnectionError', () => {
    let retrySystem;

    afterEach(() => {
        if (retrySystem && retrySystem.retryTimers) {
            Object.values(retrySystem.retryTimers).forEach(timer => clearTimeout(timer));
        }
    });

    test('calls cleanup function on connection error', async () => {
        retrySystem = new RetrySystem({ logger: noOpLogger });

        let cleanupCalled = false;
        const cleanupFn = () => { cleanupCalled = true; };

        retrySystem.handleConnectionError('TikTok', new Error('test-error'), () => {}, cleanupFn);

        await safeDelay(100);

        expect(cleanupCalled).toBe(true);
    });

    test('increments retry count on each error', () => {
        retrySystem = new RetrySystem({ logger: noOpLogger });

        expect(retrySystem.getRetryCount('TikTok')).toBe(0);

        retrySystem.handleConnectionError('TikTok', new Error('first'), () => {}, null);
        expect(retrySystem.getRetryCount('TikTok')).toBe(1);

        retrySystem.handleConnectionError('TikTok', new Error('second'), () => {}, null);
        expect(retrySystem.getRetryCount('TikTok')).toBe(2);
    });

    test('stops retrying for 401 unauthorized errors', () => {
        retrySystem = new RetrySystem({ logger: noOpLogger });

        let reconnectCalled = false;
        const reconnectFn = () => { reconnectCalled = true; };

        retrySystem.handleConnectionError('TikTok', new Error('401 Unauthorized'), reconnectFn, null);

        expect(retrySystem.getRetryCount('TikTok')).toBe(0);
        expect(reconnectCalled).toBe(false);
    });

    test('resets retry count on connection success', () => {
        retrySystem = new RetrySystem({ logger: noOpLogger });

        retrySystem.handleConnectionError('TikTok', new Error('error'), () => {}, null);
        retrySystem.handleConnectionError('TikTok', new Error('error'), () => {}, null);
        expect(retrySystem.getRetryCount('TikTok')).toBe(2);

        retrySystem.handleConnectionSuccess('TikTok', {});
        expect(retrySystem.getRetryCount('TikTok')).toBe(0);
    });

    test('calculates increasing delay with backoff', () => {
        retrySystem = new RetrySystem({ logger: noOpLogger });

        const delay1 = retrySystem.incrementRetryCount('TikTok');
        const delay2 = retrySystem.incrementRetryCount('TikTok');
        const delay3 = retrySystem.incrementRetryCount('TikTok');

        expect(delay1).toBeGreaterThan(0);
        expect(delay2).toBeGreaterThan(delay1);
        expect(delay3).toBeGreaterThan(delay2);
    });
});
