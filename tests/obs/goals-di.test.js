
jest.mock('../../src/core/logging', () => ({
    logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
    }
}));

describe('OBSGoalsManager DI requirements', () => {
    beforeEach(() => {
        jest.resetModules();
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
        const getOBSConnectionManager = jest.fn(() => {
            throw new Error('getOBSConnectionManager should not be called');
        });

        jest.doMock('../../src/obs/connection', () => ({
            getOBSConnectionManager
        }));

        const mockObsManager = {
            isConnected: jest.fn().mockReturnValue(true),
            ensureConnected: jest.fn(),
            call: jest.fn(),
            addEventListener: jest.fn(),
            removeEventListener: jest.fn()
        };

        const { createOBSGoalsManager } = require('../../src/obs/goals');

        expect(() => createOBSGoalsManager(mockObsManager, {
            logger: require('../../src/core/logging').logger,
            configManager: { getBoolean: () => false, getString: () => '', getNumber: () => 0 },
            updateTextSource: jest.fn(),
            goalTracker: {
                initializeGoalTracker: jest.fn(),
                addDonationToGoal: jest.fn(),
                addPaypiggyToGoal: jest.fn(),
                getGoalState: jest.fn(),
                getAllGoalStates: jest.fn()
            }
        })).not.toThrow();
        expect(getOBSConnectionManager).not.toHaveBeenCalled();
    });
});
