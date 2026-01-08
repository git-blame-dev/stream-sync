// Use real implementation (jest.setup mocks the platform by default).
jest.unmock('../../../src/platforms/tiktok');

const { TikTokPlatform } = require('../../../src/platforms/tiktok');

describe('TikTokPlatform raw event logging', () => {
    const createPlatform = ({ dataLoggingEnabled }) => {
        const platform = Object.create(TikTokPlatform.prototype);
        platform.config = { dataLoggingEnabled };
        platform.logger = { warn: jest.fn() };
        platform.logRawPlatformData = jest.fn().mockResolvedValue();
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
