
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

describe('OBSGoalsManager DI requirements', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    beforeEach(() => {
        resetModules();
    });

    it('exposes only DI-focused exports (no wrapper functions)', () => {
        const goals = require('../../src/obs/goals');
        const exportedKeys = Object.keys(goals).sort();
        expect(exportedKeys).toEqual([
            'OBSGoalsManager',
            'createOBSGoalsManager',
            'getDefaultGoalsManager'
        ]);
    });

    it('requires an OBS manager in the constructor', () => {
        const { OBSGoalsManager } = require('../../src/obs/goals');
        expect(() => new OBSGoalsManager()).toThrow(/OBSGoalsManager requires OBSConnectionManager/);
    });

    it('initializes with provided obsManager without calling getOBSConnectionManager', () => {
        const getOBSConnectionManager = createMockFn(() => {
            throw new Error('getOBSConnectionManager should not be called');
        });

        mockModule('../../src/obs/connection', () => ({
            getOBSConnectionManager
        }));

        const mockObsManager = {
            isConnected: createMockFn().mockReturnValue(true),
            ensureConnected: createMockFn(),
            call: createMockFn(),
            addEventListener: createMockFn(),
            removeEventListener: createMockFn()
        };

        const { createOBSGoalsManager } = require('../../src/obs/goals');

        expect(() => createOBSGoalsManager(mockObsManager, {
            logger: require('../../src/core/logging').logger,
            configManager: { getBoolean: () => false, getString: () => '', getNumber: () => 0 },
            updateTextSource: createMockFn(),
            goalTracker: {
                initializeGoalTracker: createMockFn(),
                addDonationToGoal: createMockFn(),
                addPaypiggyToGoal: createMockFn(),
                getGoalState: createMockFn(),
                getAllGoalStates: createMockFn()
            }
        })).not.toThrow();
        expect(getOBSConnectionManager).not.toHaveBeenCalled();
    });
});
