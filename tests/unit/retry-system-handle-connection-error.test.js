const { RetrySystem } = require('../../src/utils/retry-system');
const { safeSetTimeout, safeDelay } = require('../../src/utils/timeout-validator');

describe('RetrySystem.handleConnectionError', () => {
    const createLogger = () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('awaits cleanup before scheduling reconnect attempts', async () => {
        const retrySystem = new RetrySystem({ logger: createLogger() });
        retrySystem.isConnected = () => false;
        let retryCount = 0;
        retrySystem.incrementRetryCount = jest.fn().mockImplementation(() => {
            retryCount += 1;
            return 1;
        });
        retrySystem.getRetryCount = jest.fn().mockImplementation(() => retryCount);

        let cleanupResolved = false;
        const cleanupFn = jest.fn(() => new Promise((resolve) => {
            safeSetTimeout(() => {
                cleanupResolved = true;
                resolve();
            }, 1);
        }));
        const reconnectFn = jest.fn();

        retrySystem.handleConnectionError('tiktok', new Error('room-id'), reconnectFn, cleanupFn);

        // Allow cleanup promise and scheduled reconnect to run
        await safeDelay(20);

        expect(reconnectFn).toHaveBeenCalledTimes(1);
        expect(cleanupFn).toHaveBeenCalledTimes(1);
        expect(cleanupResolved).toBe(true);
    });

    it('cancels an in-flight retry timer when a newer error arrives', async () => {
        jest.useFakeTimers();
        try {
            const retrySystem = new RetrySystem({ logger: createLogger() });
            retrySystem.isConnected = () => false;
            retrySystem.incrementRetryCount = jest.fn().mockReturnValue(5);
            retrySystem.getRetryCount = jest.fn().mockReturnValue(1);

            const cleanupFn = jest.fn().mockResolvedValue();
            const reconnectFn = jest.fn();

            retrySystem.handleConnectionError('tiktok', new Error('first'), reconnectFn, cleanupFn);
            retrySystem.handleConnectionError('tiktok', new Error('second'), reconnectFn, cleanupFn);

            await Promise.resolve();
            await Promise.resolve();
            await jest.runOnlyPendingTimersAsync();

            expect(reconnectFn).toHaveBeenCalledTimes(1);
            expect(cleanupFn).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    it('continues scheduling retries when a scheduled reconnect throws', async () => {
        const retrySystem = new RetrySystem({ logger: createLogger() });
        retrySystem.isConnected = () => false;
        let retryCount = 0;
        retrySystem.incrementRetryCount = jest.fn().mockImplementation(() => {
            retryCount += 1;
            return 1;
        });
        retrySystem.getRetryCount = jest.fn().mockImplementation(() => retryCount);

        const reconnectFn = jest.fn()
            .mockImplementationOnce(() => { throw new Error('scheduled boom'); })
            .mockResolvedValueOnce();
        const cleanupFn = jest.fn().mockResolvedValue();

        retrySystem.handleConnectionError('tiktok', new Error('initial failure'), reconnectFn, cleanupFn);

        // Allow first scheduled attempt to run and trigger recursive scheduling
        await safeDelay(50);

        expect(reconnectFn).toHaveBeenCalledTimes(2);
        expect(retrySystem.getRetryCount('tiktok')).toBeGreaterThanOrEqual(2);
    });
});
