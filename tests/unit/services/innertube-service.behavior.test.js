jest.mock('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: jest.fn(() => ({
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    }))
}));

const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const { InnertubeService } = require('../../../src/services/innertube-service');

describe('InnertubeService behavior', () => {
    const createInstance = () => ({ getInfo: jest.fn(async () => ({ video: 'info' })) });
    let factory;
    let logger;
    let handler;

    beforeEach(() => {
        jest.clearAllMocks();
        factory = { createWithTimeout: jest.fn(async () => createInstance()) };
        logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        handler = { handleEventProcessingError: jest.fn(), logOperationalError: jest.fn() };
        createPlatformErrorHandler.mockReturnValue(handler);
    });

    it('reuses cached instances and tracks stats', async () => {
        const service = new InnertubeService(factory, { logger });

        const first = await service.getSharedInstance('shared');
        const second = await service.getSharedInstance('shared');

        expect(first).toBe(second);
        expect(service.stats.cacheMisses).toBe(1);
        expect(service.stats.cacheHits).toBe(1);
        expect(service.stats.instancesCreated).toBe(1);
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('Using cached instance'),
            'innertube-service'
        );
    });

    it('wraps getInfo with provided timeout helper and updates lastUsed', async () => {
        const withTimeout = jest.fn(async (promise, timeout, label) => promise);
        const service = new InnertubeService(factory, { logger, withTimeout });

        const result = await service.getVideoInfo('abc123', { timeout: 5000, instanceKey: 'custom' });
        const cached = service.instanceCache.get('custom');

        expect(result).toEqual({ video: 'info' });
        expect(withTimeout).toHaveBeenCalledWith(expect.any(Promise), 5000, 'YouTube getInfo call');
        expect(cached.lastUsed).toBeGreaterThanOrEqual(cached.created);
    });

    it('cleans up stale instances', async () => {
        const service = new InnertubeService(factory, { logger });
        const instance = await service.getSharedInstance('old');
        service.instanceCache.set('old', { instance, created: 0, lastUsed: 0 });

        service.cleanup(1);

        expect(service.instanceCache.has('old')).toBe(false);
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('Cleaned up'),
            'innertube-service'
        );
    });

    it('logs and throws on factory failure', async () => {
        const error = new Error('boom');
        factory.createWithTimeout.mockRejectedValue(error);
        const service = new InnertubeService(factory, { logger });

        await expect(service.getSharedInstance('fail')).rejects.toThrow('InnertubeService instance creation failed');
        expect(service.stats.errors).toBe(1);

        expect(handler.handleEventProcessingError).toHaveBeenCalledWith(
            error,
            'innertube-service',
            null,
            expect.stringContaining('Failed to get instance')
        );
    });
});
