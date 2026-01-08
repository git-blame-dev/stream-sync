jest.mock('../../../src/utils/timeout-wrapper', () => ({
    withTimeout: jest.fn((promise) => promise)
}));

const { withTimeout } = require('../../../src/utils/timeout-wrapper');
const { InnertubeFactory } = require('../../../src/factories/innertube-factory');

describe('InnertubeFactory behavior', () => {
    const restoreCache = () => {
        InnertubeFactory._innertubeClassCache = null;
        InnertubeFactory._importPromise = null;
    };

    beforeEach(() => {
        restoreCache();
        jest.clearAllMocks();
    });

    afterEach(() => {
        restoreCache();
    });

    it('creates an instance via cached class and surfaces contextual errors', async () => {
        const create = jest.fn().mockResolvedValue({ instance: true });
        const getSpy = jest.spyOn(InnertubeFactory, '_getInnertubeClass').mockResolvedValue({ create });

        const result = await InnertubeFactory.createInstance();

        expect(result).toEqual({ instance: true });
        expect(create).toHaveBeenCalled();

        const failingCreate = jest.fn().mockRejectedValue(new Error('boom'));
        getSpy.mockResolvedValueOnce({ create: failingCreate });
        InnertubeFactory._innertubeClassCache = null;

        await expect(InnertubeFactory.createInstance()).rejects.toThrow('Innertube creation failed: boom');
    });

    it('passes config through and respects timeout wrapper when provided', async () => {
        jest.spyOn(InnertubeFactory, 'createWithConfig').mockResolvedValue(Promise.resolve('configured'));
        withTimeout.mockImplementation(async (promise, timeout, options) => {
            expect(options.operationName).toBe('Innertube creation');
            expect(options.errorMessage).toContain('500');
            return promise;
        });

        const result = await InnertubeFactory.createWithTimeout(500, { debug: true });

        expect(InnertubeFactory.createWithConfig).toHaveBeenCalledWith({ debug: true });
        expect(withTimeout).toHaveBeenCalledWith(
            expect.any(Promise),
            500,
            expect.objectContaining({ operationName: 'Innertube creation' })
        );
        expect(result).toBe('configured');
    });

    it('provides lazy class references and stats reflecting cache usage', async () => {
        InnertubeFactory._innertubeClassCache = { create: jest.fn() };
        const lazy = InnertubeFactory.createLazyReference();

        const resolved = await lazy();
        expect(resolved).toBe(InnertubeFactory._innertubeClassCache);

        const stats = InnertubeFactory.getStats();
        expect(stats.cached).toBe(true);
        expect(stats.supportedMethods).toContain('createWithTimeout');
    });
});
