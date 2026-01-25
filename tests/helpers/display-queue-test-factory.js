const { createMockFn } = require('./bun-mock-utils');
const { noOpLogger } = require('./mock-factories');
const { createSourcesConfigFixture } = require('./runtime-constants-fixture');
const { createOBSSourcesManager } = require('../../src/obs/sources');
const { createGoalTracker } = require('../../src/utils/goal-tracker');

function createMockOBSForTesting() {
    return {
        call: createMockFn().mockResolvedValue({}),
        isConnected: () => true,
        isReady: createMockFn().mockResolvedValue(true),
        ensureConnected: createMockFn().mockResolvedValue()
    };
}

function createTestConfig() {
    return {
        goals: {
            tiktokGoalEnabled: true,
            tiktokGoalTarget: 1000,
            youtubeGoalEnabled: true,
            youtubeGoalTarget: 100,
            twitchGoalEnabled: true,
            twitchGoalTarget: 500
        }
    };
}

function createRealSourcesManager(mockOBS) {
    return createOBSSourcesManager(mockOBS, {
        ...createSourcesConfigFixture(),
        logger: noOpLogger,
        ensureOBSConnected: createMockFn().mockResolvedValue(),
        obsCall: mockOBS.call
    });
}

function createRealGoalTracker(config = createTestConfig()) {
    return createGoalTracker({
        logger: noOpLogger,
        config
    });
}

function createRealGoalsManager(mockOBS, realSourcesManager, realGoalTracker) {
    const { createOBSGoalsManager } = require('../../src/obs/goals');
    const config = createTestConfig();

    return createOBSGoalsManager(mockOBS, {
        logger: noOpLogger,
        config,
        configManager: { getSection: () => ({}) },
        updateTextSource: realSourcesManager.updateTextSource,
        goalTracker: realGoalTracker
    });
}

function createDisplayQueueDependencies() {
    const mockOBS = createMockOBSForTesting();
    const realSourcesManager = createRealSourcesManager(mockOBS);
    const realGoalTracker = createRealGoalTracker();
    const realGoalsManager = createRealGoalsManager(mockOBS, realSourcesManager, realGoalTracker);

    return {
        mockOBS,
        sourcesManager: realSourcesManager,
        goalsManager: realGoalsManager,
        goalTracker: realGoalTracker
    };
}

module.exports = {
    createMockOBSForTesting,
    createTestConfig,
    createRealSourcesManager,
    createRealGoalTracker,
    createRealGoalsManager,
    createDisplayQueueDependencies
};
