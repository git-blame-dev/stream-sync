const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { TikTokPlatform } = require('../../../src/platforms/tiktok');
const { createMockTikTokPlatformDependencies, noOpLogger } = require('../../helpers/mock-factories');

describe('TikTokPlatform retry deduplication', () => {
    const baseConfig = { enabled: true, username: 'retry_tester' };

    afterEach(() => {
        restoreAllMocks();
    });

    it('only schedules one retry when queueRetry is invoked multiple times before a reconnect starts', () => {
        const retrySystem = { handleConnectionError: createMockFn() };
        const dependencies = createMockTikTokPlatformDependencies();
        dependencies.retrySystem = retrySystem;
        dependencies.logger = noOpLogger;
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
        dependencies.logger = noOpLogger;
        dependencies.connectionFactory = dependencies.connectionFactory || {
            createConnection: createMockFn()
        };

        const platform = new TikTokPlatform(baseConfig, dependencies);

        platform._connect = createMockFn()
            .mockRejectedValueOnce(new Error('connect-failed'))
            .mockResolvedValueOnce(true);

        retrySystem.handleConnectionError.mockImplementation((platformName, err, reconnectFn) => reconnectFn());

        platform.queueRetry(new Error('initial'));
        await Promise.resolve();
        await Promise.resolve();

        expect(retrySystem.handleConnectionError).toHaveBeenCalledTimes(2);
        expect(platform._connect).toHaveBeenCalledTimes(2);
    });
});
