const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { initializeTestLogging } = require('../../helpers/test-setup');
const goals = require('../../../src/obs/goals');
const { OBSGoalsManager, createOBSGoalsManager } = require('../../../src/obs/goals');

initializeTestLogging();

describe('OBSGoalsManager DI requirements', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    beforeEach(() => {
        initializeTestLogging();
    });

    it('exposes only DI-focused exports (no wrapper functions)', () => {
        const exportedKeys = Object.keys(goals).sort();
        expect(exportedKeys).toEqual([
            'OBSGoalsManager',
            'createOBSGoalsManager',
            'getDefaultGoalsManager'
        ]);
    });

    it('requires an OBS manager in the constructor', () => {
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

        const goalsManager = createOBSGoalsManager(mockObsManager, {
            logger: noOpLogger,
            configManager: { getBoolean: () => true, getString: () => 'goal-source', getNumber: () => 0 },
            updateTextSource: createMockFn(),
            goalTracker: mockGoalTracker,
            runtimeConstants: { NOTIFICATION_PLATFORM_LOGOS: {}, CHAT_PLATFORM_LOGOS: {} }
        });

        const status = await goalsManager.getCurrentGoalStatus('tiktok');

        expect(mockGoalTracker.getGoalState).toHaveBeenCalledWith('tiktok');
        expect(status).toEqual({ current: 100, target: 500, formatted: '100/500' });
    });
});
