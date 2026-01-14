
jest.mock('../../src/core/logging', () => ({
    logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
    }
}));

jest.mock('../../src/obs/sources', () => {
    const instance = {
        updateTextSource: jest.fn(),
        setSourceVisibility: jest.fn(),
        setPlatformLogoVisibility: jest.fn(),
        hideAllDisplays: jest.fn(),
        updateChatMsgText: jest.fn(),
        setNotificationPlatformLogoVisibility: jest.fn(),
        setGroupSourceVisibility: jest.fn(),
        setSourceFilterVisibility: jest.fn(),
        getGroupSceneItemId: jest.fn(),
        setChatDisplayVisibility: jest.fn(),
        setNotificationDisplayVisibility: jest.fn(),
        getSceneItemId: jest.fn()
    };
    return {
        OBSSourcesManager: class {},
        createOBSSourcesManager: () => instance,
        getDefaultSourcesManager: () => instance
    };
});

const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');

describe('DisplayQueue DI requirements', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    it('requires an OBS manager in the constructor', () => {
        const { DisplayQueue } = require('../../src/obs/display-queue');
        expect(() => new DisplayQueue(null, {}, {}, null, createRuntimeConstantsFixture())).toThrow(/OBSConnectionManager/);
    });

    it('initializes with provided obsManager and does not call getOBSConnectionManager', () => {
        const getOBSConnectionManager = jest.fn(() => {
            throw new Error('getOBSConnectionManager should not be called');
        });

        jest.doMock('../../src/obs/connection', () => ({
            getOBSConnectionManager
        }));

        const mockObsManager = {
            isReady: jest.fn().mockResolvedValue(true),
            ensureConnected: jest.fn(),
            call: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn()
        };

        const { initializeDisplayQueue } = require('../../src/obs/display-queue');

        expect(() => initializeDisplayQueue(mockObsManager, {}, {}, null, createRuntimeConstantsFixture())).not.toThrow();
        expect(getOBSConnectionManager).not.toHaveBeenCalled();
    });

});
