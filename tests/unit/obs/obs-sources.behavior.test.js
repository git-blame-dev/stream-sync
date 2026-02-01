const { describe, expect, beforeEach, it } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createOBSSourcesManager } = require('../../../src/obs/sources');

describe('obs/sources behavior', () => {
    let mockLogger;
    let sourcesConfig;

    beforeEach(() => {
        mockLogger = noOpLogger;
        sourcesConfig = {
            chatGroupName: 'TestStatusGroup',
            notificationGroupName: 'TestNotifyGroup',
            fadeDelay: 10
        };
    });

    it('sanitizes text and issues SetInputSettings when updating text source', async () => {
        const mockCall = createMockFn()
            .mockResolvedValueOnce({ inputSettings: {} })
            .mockResolvedValueOnce();
        const mockEnsureConnected = createMockFn().mockResolvedValue();

        const sources = createOBSSourcesManager(
            { isReady: createMockFn().mockResolvedValue(true) },
            { logger: mockLogger, ...sourcesConfig, ensureOBSConnected: mockEnsureConnected, obsCall: mockCall }
        );

        await sources.updateTextSource('TestChatText', 'Hello 🌟');

        expect(mockCall).toHaveBeenCalledWith('GetInputSettings', { inputName: 'TestChatText' });
        expect(mockCall).toHaveBeenCalledWith('SetInputSettings', {
            inputName: 'TestChatText',
            inputSettings: { text: 'Hello ' },
            overlay: false
        });
    });

    it('caches group scene item lookups to avoid repeated OBS calls', async () => {
        const obsCall = createMockFn().mockResolvedValue({
            sceneItems: [{ sourceName: 'TestLogo', sceneItemId: 42 }]
        });

        const sources = createOBSSourcesManager(
            { isReady: createMockFn().mockResolvedValue(true) },
            { logger: mockLogger, ...sourcesConfig, ensureOBSConnected: createMockFn(), obsCall }
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
            { logger: mockLogger, ...sourcesConfig, ensureOBSConnected: createMockFn(), obsCall }
        );

        await expect(sources.getGroupSceneItemId('TestMissing', 'TestGroup')).rejects.toThrow(/TestMissing/);
        await expect(sources.getGroupSceneItemId('TestMissing', 'TestGroup')).rejects.toThrow(/TestMissing/);

        expect(obsCall).toHaveBeenCalledTimes(2);
    });
});
