
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { resetModules, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');
const { noOpLogger } = require('../helpers/mock-factories');
const { initializeTestLogging } = require('../helpers/test-setup');

initializeTestLogging();

describe('OBSGoalsManager DI requirements', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    beforeEach(() => {
        resetModules();
        initializeTestLogging();
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

    it('uses injected dependencies for operations', async () => {
        const mockObsManager = {
            isConnected: createMockFn().mockReturnValue(true),
            ensureConnected: createMockFn(),
            call: createMockFn(),
            addEventListener: createMockFn(),
            removeEventListener: createMockFn()
        };

        const mockGoalTracker = {
            initializeGoalTracker: createMockFn().mockResolvedValue(),
            addDonationToGoal: createMockFn(),
            addPaypiggyToGoal: createMockFn(),
            getGoalState: createMockFn().mockReturnValue({ current: 100, target: 500, formatted: '100/500' }),
            getAllGoalStates: createMockFn().mockReturnValue({})
        };

        const { createOBSGoalsManager } = require('../../src/obs/goals');
        const goalsManager = createOBSGoalsManager(mockObsManager, {
            logger: noOpLogger,
            configManager: { getBoolean: () => true, getString: () => 'goal-source', getNumber: () => 0 },
            updateTextSource: createMockFn(),
            goalTracker: mockGoalTracker
        });

        const status = await goalsManager.getCurrentGoalStatus('tiktok');

        expect(mockGoalTracker.getGoalState).toHaveBeenCalledWith('tiktok');
        expect(status).toEqual({ current: 100, target: 500, formatted: '100/500' });
    });
});
