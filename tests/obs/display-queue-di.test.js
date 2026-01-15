
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

mockModule('../../src/core/logging', () => ({
    logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
    }
}));

mockModule('../../src/obs/sources', () => {
    const instance = {
        updateTextSource: createMockFn(),
        setSourceVisibility: createMockFn(),
        setPlatformLogoVisibility: createMockFn(),
        hideAllDisplays: createMockFn(),
        updateChatMsgText: createMockFn(),
        setNotificationPlatformLogoVisibility: createMockFn(),
        setGroupSourceVisibility: createMockFn(),
        setSourceFilterVisibility: createMockFn(),
        getGroupSceneItemId: createMockFn(),
        setChatDisplayVisibility: createMockFn(),
        setNotificationDisplayVisibility: createMockFn(),
        getSceneItemId: createMockFn()
    };
    return {
        OBSSourcesManager: class {},
        createOBSSourcesManager: () => instance,
        getDefaultSourcesManager: () => instance
    };
});

const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');

describe('DisplayQueue DI requirements', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    beforeEach(() => {
        resetModules();
    });

    it('requires an OBS manager in the constructor', () => {
        const { DisplayQueue } = require('../../src/obs/display-queue');
        expect(() => new DisplayQueue(null, {}, {}, null, createRuntimeConstantsFixture())).toThrow(/OBSConnectionManager/);
    });

    it('initializes with provided obsManager and does not call getOBSConnectionManager', () => {
        const getOBSConnectionManager = createMockFn(() => {
            throw new Error('getOBSConnectionManager should not be called');
        });

        mockModule('../../src/obs/connection', () => ({
            getOBSConnectionManager
        }));

        const mockObsManager = {
            isReady: createMockFn().mockResolvedValue(true),
            ensureConnected: createMockFn(),
            call: createMockFn(),
            addEventListener: createMockFn(),
            removeEventListener: createMockFn()
        };

        const { initializeDisplayQueue } = require('../../src/obs/display-queue');

        expect(() => initializeDisplayQueue(mockObsManager, {}, {}, null, createRuntimeConstantsFixture())).not.toThrow();
        expect(getOBSConnectionManager).not.toHaveBeenCalled();
    });

});
