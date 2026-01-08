jest.mock('../../../src/utils/timeout-validator', () => ({
    validateTimeout: jest.fn((v) => v),
    safeSetInterval: jest.fn(() => null)
}));

jest.mock('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: jest.fn(() => ({
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    }))
}));

jest.mock('../../../src/core/logging', () => ({
    logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));

const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');
const ManagerModule = require('../../../src/services/innertube-instance-manager');

const runtimeConstants = createRuntimeConstantsFixture();
ManagerModule.setRuntimeConstants(runtimeConstants);
const InnertubeInstanceManager = ManagerModule.getInstance().constructor;

const resetManager = async () => {
    await ManagerModule.cleanup();
    ManagerModule._resetInstance();
};

describe('InnertubeInstanceManager behavior', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        ManagerModule.setRuntimeConstants(runtimeConstants);
        await resetManager();
    });

    afterAll(async () => {
        await resetManager();
    });

    it('caches healthy instances and reuses them', async () => {
        const createFn = jest.fn(async () => ({ id: 'instance' }));
        const manager = new InnertubeInstanceManager({ instanceTimeout: 5000 });

        const first = await manager.getInstance('default', createFn);
        const second = await manager.getInstance('default', createFn);

        expect(first).toBe(second);
        expect(createFn).toHaveBeenCalledTimes(1);
        expect(manager.getStats().activeInstances).toBe(1);
    });

    it('creates new instance when cached is unhealthy', async () => {
        const createFn = jest.fn()
            .mockResolvedValueOnce({ id: 'one' })
            .mockResolvedValueOnce({ id: 'two' });
        const manager = new InnertubeInstanceManager({ instanceTimeout: 5000 });

        await manager.getInstance('default', createFn);
        manager.markInstanceUnhealthy('default');
        const next = await manager.getInstance('default', createFn);

        expect(next.id).toBe('two');
        expect(createFn).toHaveBeenCalledTimes(2);
    });

    it('cleans up oldest instance when exceeding maxInstances', async () => {
        const first = { dispose: jest.fn(), session: { close: jest.fn() } };
        const second = { dispose: jest.fn(), session: { close: jest.fn() } };
        const third = { dispose: jest.fn(), session: { close: jest.fn() } };
        const createFn = jest.fn()
            .mockResolvedValueOnce(first)
            .mockResolvedValueOnce(second)
            .mockResolvedValueOnce(third);

        const manager = new InnertubeInstanceManager({ instanceTimeout: 5000 });
        manager.maxInstances = 2;

        await manager.getInstance('a', createFn);
        await manager.getInstance('b', createFn);
        manager.activeInstances.get('a').lastAccessed = 0;
        manager.activeInstances.get('b').lastAccessed = 1;
        await manager.getInstance('c', createFn);

        expect(createFn).toHaveBeenCalledTimes(3);
        expect(manager.getStats().activeInstances).toBe(2);
    });

    it('disposes all instances on cleanup', async () => {
        const inst = { dispose: jest.fn(), session: { close: jest.fn() } };
        const manager = new InnertubeInstanceManager({ instanceTimeout: 5000 });
        manager._cacheInstance('x', inst);

        await manager.cleanup();

        expect(manager.disposed).toBe(true);
        expect(manager.getStats().activeInstances).toBe(0);
    });
});
