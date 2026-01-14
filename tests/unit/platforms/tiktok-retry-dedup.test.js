const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { unmockModule, restoreAllModuleMocks, resetModules } = require('../helpers/bun-module-mocks');

unmockModule('../../../src/platforms/tiktok');

const { TikTokPlatform } = require('../../../src/platforms/tiktok');
const { createMockTikTokPlatformDependencies } = require('../../helpers/mock-factories');

describe('TikTokPlatform retry deduplication', () => {
    const baseConfig = { enabled: true, username: 'retry_tester' };

    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    it('only schedules one retry when queueRetry is invoked multiple times before a reconnect starts', () => {
        const retrySystem = { handleConnectionError: createMockFn() };
        const dependencies = createMockTikTokPlatformDependencies();
        dependencies.retrySystem = retrySystem;
        dependencies.logger = dependencies.logger || {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
        dependencies.connectionFactory = dependencies.connectionFactory || {
            createConnection: createMockFn()
        };

        const platform = new TikTokPlatform(baseConfig, dependencies);

        platform.queueRetry(new Error('first'));
        platform.queueRetry(new Error('second'));

        expect(retrySystem.handleConnectionError).toHaveBeenCalledTimes(1);
    });

    it('requeues a retry when the reconnect attempt fails, without double scheduling', async () => {
        const retrySystem = { handleConnectionError: createMockFn() };
        const dependencies = createMockTikTokPlatformDependencies();
        dependencies.retrySystem = retrySystem;
        dependencies.logger = dependencies.logger || {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
        dependencies.connectionFactory = dependencies.connectionFactory || {
            createConnection: createMockFn()
        };

        const platform = new TikTokPlatform(baseConfig, dependencies);

        // First reconnect attempt fails, second succeeds
        platform._connect = createMockFn()
            .mockRejectedValueOnce(new Error('connect-failed'))
            .mockResolvedValueOnce(true);

        retrySystem.handleConnectionError.mockImplementation((platformName, err, reconnectFn) => reconnectFn());

        platform.queueRetry(new Error('initial'));
        // Allow async queueRetry/reconnectFn chain to run
        await Promise.resolve();
        await Promise.resolve();

        expect(retrySystem.handleConnectionError).toHaveBeenCalledTimes(2);
        expect(platform._connect).toHaveBeenCalledTimes(2);
    });

    it('logs connect invocation even when a connect is already in flight', async () => {
        const dependencies = createMockTikTokPlatformDependencies();
        dependencies.logger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
        dependencies.connectionFactory = {
            createConnection: createMockFn()
        };

        const platform = new TikTokPlatform(baseConfig, dependencies);

        // Simulate an in-flight connect to exercise the early-return path
        platform.connectingPromise = Promise.resolve('inflight');

        await platform._connect(platform.handlers);

        const connectLog = dependencies.logger.debug.mock.calls.find(
            ([message]) => typeof message === 'string' && message.includes('connect() invoked')
        );

        expect(connectLog).toBeDefined();
        expect(connectLog[1]).toBe('tiktok');
    });
});
