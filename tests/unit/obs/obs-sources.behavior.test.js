const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { createMockLogger } = require('../../helpers/mock-factories');
const { createOBSSourcesManager } = require('../../../src/obs/sources');

describe('obs/sources behavior', () => {
    let mockLogger;
    let runtimeConstants;

    beforeEach(() => {
        mockLogger = createMockLogger();
        runtimeConstants = {
            STATUSBAR_GROUP_NAME: 'TestStatusGroup',
            STATUSBAR_NOTIFICATION_GROUP_NAME: 'TestNotifyGroup',
            NOTIFICATION_CONFIG: { fadeDelay: 10 }
        };
    });

    it('sanitizes text and issues SetInputSettings when updating text source', async () => {
        const obsManager = {
            call: createMockFn().mockResolvedValue({}),
            ensureConnected: createMockFn().mockResolvedValue(),
            isReady: createMockFn().mockResolvedValue(true)
        };

        const sources = createOBSSourcesManager(obsManager, { logger: mockLogger, runtimeConstants });

        await sources.updateTextSource('TestChatText', 'Hello 🌟');

        expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings', {
            inputName: 'TestChatText',
            inputSettings: { text: 'Hello ' }
        });
    });

    it('caches group scene item lookups to avoid repeated OBS calls', async () => {
        const obsCall = createMockFn().mockResolvedValue({
            sceneItems: [{ sourceName: 'TestLogo', sceneItemId: 42 }]
        });

        const sources = createOBSSourcesManager(
            { isReady: createMockFn().mockResolvedValue(true) },
            { logger: mockLogger, runtimeConstants, ensureOBSConnected: createMockFn(), obsCall }
        );

        const firstLookup = await sources.getGroupSceneItemId('TestLogo', 'TestLogos');
        expect(firstLookup).toEqual({ sceneItemId: 42 });

        await sources.getGroupSceneItemId('TestLogo', 'TestLogos');
        expect(obsCall).toHaveBeenCalledTimes(1);
    });

    it('retries lookup on subsequent calls when source is not found', async () => {
        const obsCall = createMockFn().mockResolvedValue({ sceneItems: [] });
        const sources = createOBSSourcesManager(
            { isReady: createMockFn().mockResolvedValue(true) },
            { logger: mockLogger, runtimeConstants, ensureOBSConnected: createMockFn(), obsCall }
        );

        await expect(sources.getGroupSceneItemId('TestMissing', 'TestGroup')).rejects.toThrow(/TestMissing/);
        await expect(sources.getGroupSceneItemId('TestMissing', 'TestGroup')).rejects.toThrow(/TestMissing/);

        expect(obsCall).toHaveBeenCalledTimes(2);
    });
});
