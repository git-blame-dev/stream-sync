jest.mock('../../../src/utils/platform-error-handler', () => {
    const handler = {
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    };
    return {
        createPlatformErrorHandler: jest.fn(() => handler)
    };
});

const { createOBSSourcesManager } = require('../../../src/obs/sources');
const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');

describe('obs/sources behavior', () => {
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const runtimeConstants = {
        STATUSBAR_GROUP_NAME: 'StatusGroup',
        STATUSBAR_NOTIFICATION_GROUP_NAME: 'NotifyGroup',
        NOTIFICATION_CONFIG: { fadeDelay: 10 }
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('sanitizes text and issues SetInputSettings when updating text source in test mode', async () => {
        const obsManager = {
            call: jest.fn().mockResolvedValue({}),
            ensureConnected: jest.fn().mockResolvedValue(),
            isReady: jest.fn().mockResolvedValue(true)
        };

        const sources = createOBSSourcesManager(obsManager, { logger, runtimeConstants });

        await sources.updateTextSource('ChatText', 'Hello 🌟');

        expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings', {
            inputName: 'ChatText',
            inputSettings: { text: 'Hello ' }
        });
    });

    it('caches group scene item lookups to avoid repeated OBS calls', async () => {
        const obsCall = jest.fn().mockResolvedValue({
            sceneItems: [{ sourceName: 'Logo', sceneItemId: 42 }]
        });

        const sources = createOBSSourcesManager(
            { isReady: jest.fn().mockResolvedValue(true) },
            { logger, runtimeConstants, ensureOBSConnected: jest.fn(), obsCall }
        );

        const firstLookup = await sources.getGroupSceneItemId('Logo', 'Logos');
        expect(firstLookup).toEqual({ sceneItemId: 42 });

        await sources.getGroupSceneItemId('Logo', 'Logos');
        expect(obsCall).toHaveBeenCalledTimes(1);
    });

    it('routes group lookup failures through the platform error handler and retries on subsequent calls', async () => {
        const handler = { handleEventProcessingError: jest.fn(), logOperationalError: jest.fn() };
        createPlatformErrorHandler.mockReturnValue(handler);

        const obsCall = jest.fn().mockResolvedValue({ sceneItems: [] });
        const sources = createOBSSourcesManager(
            { isReady: jest.fn().mockResolvedValue(true) },
            { logger, runtimeConstants, ensureOBSConnected: jest.fn(), obsCall }
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
