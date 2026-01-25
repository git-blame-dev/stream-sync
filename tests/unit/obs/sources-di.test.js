
const { describe, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { createSourcesConfigFixture } = require('../../helpers/runtime-constants-fixture');
const { noOpLogger } = require('../../helpers/mock-factories');
const { OBSSourcesManager, createOBSSourcesManager } = require('../../../src/obs/sources');

describe('OBSSourcesManager DI requirements', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('exposes only DI-focused exports (no wrapper functions)', () => {
        const sources = require('../../../src/obs/sources');
        const exportedKeys = Object.keys(sources).sort();
        expect(exportedKeys).toEqual([
            'OBSSourcesManager',
            'createOBSSourcesManager',
            'getDefaultSourcesManager'
        ]);
    });

    it('requires an OBS manager in the constructor', () => {
        expect(() => new OBSSourcesManager()).toThrow(/OBSSourcesManager requires OBSConnectionManager/);
    });

    it('uses injected obsManager for operations', async () => {
        const mockObsManager = {
            ensureConnected: createMockFn().mockResolvedValue(),
            call: createMockFn().mockResolvedValue({ sceneItemId: 42 }),
            addEventListener: createMockFn(),
            removeEventListener: createMockFn(),
            isConnected: createMockFn().mockReturnValue(true),
            isReady: createMockFn().mockResolvedValue(true)
        };

        const sourcesManager = createOBSSourcesManager(mockObsManager, {
            logger: noOpLogger,
            ...createSourcesConfigFixture(),
            ensureOBSConnected: mockObsManager.ensureConnected,
            obsCall: mockObsManager.call
        });

        const result = await sourcesManager.getSceneItemId('test-scene', 'test-source');

        expect(mockObsManager.call).toHaveBeenCalledWith('GetSceneItemId', {
            sceneName: 'test-scene',
            sourceName: 'test-source'
        });
        expect(result).toEqual({ sceneItemId: 42, sceneName: 'test-scene' });
    });
});
