
const { describe, test, expect, beforeEach, it } = require('bun:test');
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

const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');

describe('OBSSourcesManager DI requirements', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    beforeEach(() => {
        resetModules();
    });

    it('exposes only DI-focused exports (no wrapper functions)', () => {
        const sources = require('../../src/obs/sources');
        const exportedKeys = Object.keys(sources).sort();
        expect(exportedKeys).toEqual([
            'OBSSourcesManager',
            'createOBSSourcesManager',
            'getDefaultSourcesManager'
        ]);
    });

    it('requires an OBS manager in the constructor', () => {
        const { OBSSourcesManager } = require('../../src/obs/sources');
        expect(() => new OBSSourcesManager()).toThrow(/OBSSourcesManager requires OBSConnectionManager/);
    });

    it('initializes with provided obsManager without calling getOBSConnectionManager', () => {
        const getOBSConnectionManager = createMockFn(() => {
            throw new Error('getOBSConnectionManager should not be called');
        });

        mockModule('../../src/obs/connection', () => ({
            getOBSConnectionManager
        }));

        const mockObsManager = {
            ensureConnected: createMockFn().mockResolvedValue(),
            call: createMockFn().mockResolvedValue({}),
            addEventListener: createMockFn(),
            removeEventListener: createMockFn(),
            isConnected: createMockFn().mockReturnValue(true)
        };

        const { createOBSSourcesManager } = require('../../src/obs/sources');

        expect(() => createOBSSourcesManager(mockObsManager, {
            runtimeConstants: createRuntimeConstantsFixture()
        })).not.toThrow();
        expect(getOBSConnectionManager).not.toHaveBeenCalled();
    });

    it('marks the default sources manager as degraded when OBS manager is unavailable', () => {
        mockModule('../../src/obs/connection', () => ({
            getOBSConnectionManager: () => {
                throw new Error('OBS manager unavailable');
            }
        }));

        resetModules();
        const { getDefaultSourcesManager } = require('../../src/obs/sources');
        const sourcesManager = getDefaultSourcesManager({
            runtimeConstants: createRuntimeConstantsFixture()
        });

        expect(sourcesManager.isDegraded).toBe(true);
    });
});
