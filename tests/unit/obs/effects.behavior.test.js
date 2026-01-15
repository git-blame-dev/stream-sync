const { describe, test, expect, beforeEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: createMockFn(() => ({
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn()
    }))
}));

const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const { OBSEffectsManager } = require('../../../src/obs/effects');

describe('obs effects behavior', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    const logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn() };

    const createObsManager = () => ({
        ensureConnected: createMockFn(async () => {}),
        call: createMockFn(async () => {}),
        addEventListener: createMockFn(),
        removeEventListener: createMockFn()
    });

    beforeEach(() => {
        });

    it('plays media and triggers OBS calls with fire-and-forget mode', async () => {
        const obsManager = createObsManager();
        const manager = new OBSEffectsManager(obsManager, { logger });

        await manager.playMediaInOBS({ mediaSource: 'src', filename: 'file', vfxFilePath: '/path' }, false);

        expect(obsManager.ensureConnected).toHaveBeenCalled();
        expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings', expect.any(Object));
        expect(obsManager.call).toHaveBeenCalledWith('TriggerMediaInputAction', expect.any(Object));
    });

    it('routes errors through platform error handler when OBS calls fail', async () => {
        const handler = { handleEventProcessingError: createMockFn(), logOperationalError: createMockFn() };
        createPlatformErrorHandler.mockReturnValue(handler);
        const obsManager = createObsManager();
        obsManager.call.mockRejectedValueOnce(new Error('fail'));
        const manager = new OBSEffectsManager(obsManager, { logger });
        manager.errorHandler = handler;

        await expect(manager.playMediaInOBS({ mediaSource: 'src', filename: 'file', vfxFilePath: '/path' }, false)).rejects.toThrow('fail');
        expect(handler.handleEventProcessingError).toHaveBeenCalled();
    });

    it('waitForMediaCompletion resolves when no obs manager present', async () => {
        const obsManager = createObsManager();
        const manager = new OBSEffectsManager(obsManager, { logger });
        manager.obsManager = null;

        await expect(manager.waitForMediaCompletion('src')).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalled();
    });
});
