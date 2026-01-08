jest.mock('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: jest.fn(() => ({
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    }))
}));

const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const { OBSEffectsManager } = require('../../../src/obs/effects');

describe('obs effects behavior', () => {
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn() };

    const createObsManager = () => ({
        ensureConnected: jest.fn(async () => {}),
        call: jest.fn(async () => {}),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
    });

    beforeEach(() => {
        jest.clearAllMocks();
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
        const handler = { handleEventProcessingError: jest.fn(), logOperationalError: jest.fn() };
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
