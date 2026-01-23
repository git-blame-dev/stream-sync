const { describe, expect, beforeEach, it } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { OBSEffectsManager } = require('../../../src/obs/effects');

describe('obs effects behavior', () => {
    let mockObsManager;

    const createObsManager = () => ({
        ensureConnected: createMockFn(async () => {}),
        call: createMockFn(async () => {}),
        addEventListener: createMockFn(),
        removeEventListener: createMockFn()
    });

    beforeEach(() => {
        mockObsManager = createObsManager();
    });

    it('plays media and triggers OBS calls with fire-and-forget mode', async () => {
        const manager = new OBSEffectsManager(mockObsManager, { logger: noOpLogger });

        await manager.playMediaInOBS({ mediaSource: 'testSrc', filename: 'testFile', vfxFilePath: '/test/path' }, false);

        expect(mockObsManager.ensureConnected).toHaveBeenCalled();
        expect(mockObsManager.call).toHaveBeenCalledWith('SetInputSettings', expect.any(Object));
        expect(mockObsManager.call).toHaveBeenCalledWith('TriggerMediaInputAction', expect.any(Object));
    });

    it('throws error when OBS calls fail', async () => {
        mockObsManager.call.mockRejectedValueOnce(new Error('OBS connection failed'));
        const manager = new OBSEffectsManager(mockObsManager, { logger: noOpLogger });

        await expect(
            manager.playMediaInOBS({ mediaSource: 'testSrc', filename: 'testFile', vfxFilePath: '/test/path' }, false)
        ).rejects.toThrow('OBS connection failed');
    });

    it('resolves when no obs manager present during waitForMediaCompletion', async () => {
        const manager = new OBSEffectsManager(mockObsManager, { logger: noOpLogger });
        manager.obsManager = null;

        await expect(manager.waitForMediaCompletion('testSrc')).resolves.toBeUndefined();
    });
});
