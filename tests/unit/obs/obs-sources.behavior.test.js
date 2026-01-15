const { describe, test, expect, beforeEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/utils/platform-error-handler', () => {
    const handler = {
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn()
    };
    return {
        createPlatformErrorHandler: createMockFn(() => handler)
    };
});

const { createOBSSourcesManager } = require('../../../src/obs/sources');
const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');

describe('obs/sources behavior', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    const logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() };
    const runtimeConstants = {
        STATUSBAR_GROUP_NAME: 'StatusGroup',
        STATUSBAR_NOTIFICATION_GROUP_NAME: 'NotifyGroup',
        NOTIFICATION_CONFIG: { fadeDelay: 10 }
    };

    beforeEach(() => {
        });

    it('sanitizes text and issues SetInputSettings when updating text source in test mode', async () => {
        const obsManager = {
            call: createMockFn().mockResolvedValue({}),
            ensureConnected: createMockFn().mockResolvedValue(),
            isReady: createMockFn().mockResolvedValue(true)
        };

        const sources = createOBSSourcesManager(obsManager, { logger, runtimeConstants });

        await sources.updateTextSource('ChatText', 'Hello 🌟');

        expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings', {
            inputName: 'ChatText',
            inputSettings: { text: 'Hello ' }
        });
    });

    it('caches group scene item lookups to avoid repeated OBS calls', async () => {
        const obsCall = createMockFn().mockResolvedValue({
            sceneItems: [{ sourceName: 'Logo', sceneItemId: 42 }]
        });

        const sources = createOBSSourcesManager(
            { isReady: createMockFn().mockResolvedValue(true) },
            { logger, runtimeConstants, ensureOBSConnected: createMockFn(), obsCall }
        );

        const firstLookup = await sources.getGroupSceneItemId('Logo', 'Logos');
        expect(firstLookup).toEqual({ sceneItemId: 42 });

        await sources.getGroupSceneItemId('Logo', 'Logos');
        expect(obsCall).toHaveBeenCalledTimes(1);
    });

    it('routes group lookup failures through the platform error handler and retries on subsequent calls', async () => {
        const handler = { handleEventProcessingError: createMockFn(), logOperationalError: createMockFn() };
        createPlatformErrorHandler.mockReturnValue(handler);

        const obsCall = createMockFn().mockResolvedValue({ sceneItems: [] });
        const sources = createOBSSourcesManager(
            { isReady: createMockFn().mockResolvedValue(true) },
            { logger, runtimeConstants, ensureOBSConnected: createMockFn(), obsCall }
        );

        await expect(sources.getGroupSceneItemId('Missing', 'Group')).rejects.toThrow(/Missing/);
        await expect(sources.getGroupSceneItemId('Missing', 'Group')).rejects.toThrow(/Missing/);

        expect(obsCall).toHaveBeenCalledTimes(2);
        expect(createPlatformErrorHandler).toHaveBeenCalled();
        expect(handler.handleEventProcessingError).toHaveBeenCalledWith(
            expect.any(Error),
            'obs-sources',
            expect.objectContaining({ sourceName: 'Missing', groupName: 'Group', context: 'OBS' }),
            expect.stringContaining('Error finding source'),
            'obs-sources'
        );
    });
});
