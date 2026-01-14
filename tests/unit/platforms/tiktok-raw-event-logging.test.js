const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { unmockModule, restoreAllModuleMocks, resetModules } = require('../helpers/bun-module-mocks');

// Use real implementation (jest.setup mocks the platform by default).
unmockModule('../../../src/platforms/tiktok');

const { TikTokPlatform } = require('../../../src/platforms/tiktok');

describe('TikTokPlatform raw event logging', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    const createPlatform = ({ dataLoggingEnabled }) => {
        const platform = Object.create(TikTokPlatform.prototype);
        platform.config = { dataLoggingEnabled };
        platform.logger = { warn: createMockFn() };
        platform.logRawPlatformData = createMockFn().mockResolvedValue();
        return platform;
    };

    it('logs raw events when data logging is enabled', async () => {
        const platform = createPlatform({ dataLoggingEnabled: true });

        await platform._logRawEvent('gift', { id: 'gift-1' });

        expect(platform.logRawPlatformData).toHaveBeenCalledTimes(1);
    });

    it('skips raw event logging when disabled', async () => {
        const platform = createPlatform({ dataLoggingEnabled: false });

        await platform._logRawEvent('gift', { id: 'gift-1' });

        expect(platform.logRawPlatformData).not.toHaveBeenCalled();
    });
});
