const { describe, expect, beforeEach, it } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { OBSEffectsManager, getDefaultEffectsManager, resetDefaultEffectsManager } = require('../../../src/obs/effects.ts');
const effectsCompatModule = require('../../../src/obs/effects.js');

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
        resetDefaultEffectsManager();
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

    it('resolves when media playback ended event is emitted for the source', async () => {
        const manager = new OBSEffectsManager(mockObsManager, { logger: noOpLogger });

        const pending = manager.waitForMediaCompletion('testSrc');
        const mediaEndHandler = mockObsManager.addEventListener.mock.calls[0][1];
        mediaEndHandler({ inputName: 'testSrc' });

        await expect(pending).resolves.toBeUndefined();
        expect(mockObsManager.removeEventListener).toHaveBeenCalledTimes(1);
    });

    it('rejects waiting for media completion when obs manager lacks event listener support', async () => {
        const manager = new OBSEffectsManager({
            ensureConnected: createMockFn(async () => {}),
            call: createMockFn(async () => {})
        }, { logger: noOpLogger });

        await expect(manager.waitForMediaCompletion('testSrc')).rejects.toThrow('event listener support');
    });

    it('triggers media input action through OBS manager', async () => {
        const manager = new OBSEffectsManager(mockObsManager, { logger: noOpLogger });

        await manager.triggerMediaAction('testSrc', 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART');

        expect(mockObsManager.ensureConnected).toHaveBeenCalledTimes(1);
        expect(mockObsManager.call).toHaveBeenCalledWith('TriggerMediaInputAction', {
            inputName: 'testSrc',
            mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
        });
    });

    it('propagates media input action failures', async () => {
        mockObsManager.call.mockRejectedValueOnce(new Error('action failed'));
        const manager = new OBSEffectsManager(mockObsManager, { logger: noOpLogger });

        await expect(manager.triggerMediaAction('testSrc', 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART')).rejects.toThrow('action failed');
    });

    it('returns a stable default effects manager instance', () => {
        const first = getDefaultEffectsManager();
        const second = getDefaultEffectsManager();

        expect(first).toBeDefined();
        expect(first).toBe(second);
    });

    it('wires default effects manager to real default sources manager instance', () => {
        const manager = getDefaultEffectsManager();

        expect(manager.sourcesManager).toBeDefined();
        expect(typeof manager.sourcesManager.updateTextSource).toBe('function');
    });

    it('supports resetting default effects manager singleton', () => {
        const first = getDefaultEffectsManager();

        resetDefaultEffectsManager();

        const second = getDefaultEffectsManager();
        expect(second).not.toBe(first);
    });

    it('preserves named exports through the commonjs compatibility wrapper', () => {
        expect(effectsCompatModule.OBSEffectsManager).toBe(OBSEffectsManager);
        expect(effectsCompatModule.getDefaultEffectsManager).toBe(getDefaultEffectsManager);
    });
});
