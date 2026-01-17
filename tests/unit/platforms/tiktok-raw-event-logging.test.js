const { describe, it, expect, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { createMockTikTokPlatformDependencies } = require('../../helpers/mock-factories');

const { TikTokPlatform } = require('../../../src/platforms/tiktok');

describe('TikTokPlatform raw event logging', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const createPlatform = (configOverrides = {}) => {
        const config = {
            enabled: true,
            username: 'testDataLogger',
            dataLoggingEnabled: false,
            ...configOverrides
        };
        const dependencies = createMockTikTokPlatformDependencies();
        return new TikTokPlatform(config, dependencies);
    };

    it('completes without error when data logging is enabled', async () => {
        const platform = createPlatform({ dataLoggingEnabled: true });
        const eventData = { type: 'gift', giftId: 'test-gift-1' };

        await expect(platform.logRawPlatformData('gift', eventData)).resolves.toBeUndefined();
    });

    it('completes without error when data logging is disabled', async () => {
        const platform = createPlatform({ dataLoggingEnabled: false });
        const eventData = { type: 'gift', giftId: 'test-gift-1' };

        await expect(platform.logRawPlatformData('gift', eventData)).resolves.toBeUndefined();
    });
});
