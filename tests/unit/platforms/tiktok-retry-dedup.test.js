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
        const retryCalls = [];
        const retrySystem = { handleConnectionError: (...args) => retryCalls.push(args) };
        const dependencies = createMockTikTokPlatformDependencies();
        dependencies.retrySystem = retrySystem;
        dependencies.logger = noOpLogger;
        dependencies.connectionFactory = dependencies.connectionFactory || {
            createConnection: createMockFn()
        };

        const platform = new TikTokPlatform(baseConfig, dependencies);

        platform.queueRetry(new Error('first'));
        platform.queueRetry(new Error('second'));

        expect(retryCalls).toHaveLength(1);
    });

    it('requeues a retry when the reconnect attempt fails, without double scheduling', async () => {
        const retryCalls = [];
        const retrySystem = {
            handleConnectionError: (platformName, err, reconnectFn) => {
                retryCalls.push({ platformName, err, reconnectFn });
                reconnectFn();
            }
        };
        const dependencies = createMockTikTokPlatformDependencies();
        dependencies.retrySystem = retrySystem;
        dependencies.logger = noOpLogger;
        dependencies.connectionFactory = dependencies.connectionFactory || {
            createConnection: createMockFn()
        };

        const platform = new TikTokPlatform(baseConfig, dependencies);

        const connectCalls = [];
        platform._connect = async () => {
            connectCalls.push(true);
            if (connectCalls.length === 1) {
                throw new Error('connect-failed');
            }
            return true;
        };

        platform.queueRetry(new Error('initial'));
        await Promise.resolve();
        await Promise.resolve();

        expect(retryCalls).toHaveLength(2);
        expect(connectCalls).toHaveLength(2);
    });
});
