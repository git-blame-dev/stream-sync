const { describe, it, expect } = require('bun:test');

const {
    createMockOBSForTesting,
    createTestConfig,
    createRealSourcesManager,
    createRealGoalTracker,
    createRealGoalsManager,
    createDisplayQueueDependencies
} = require('./display-queue-test-factory');

describe('display-queue-test-factory behavior', () => {
    it('creates a mock OBS dependency with callable operations', async () => {
        const mockOBS = createMockOBSForTesting();

        expect(typeof mockOBS.call).toBe('function');
        expect(typeof mockOBS.isConnected).toBe('function');
        expect(typeof mockOBS.isReady).toBe('function');
        expect(typeof mockOBS.ensureConnected).toBe('function');
        expect(mockOBS.isConnected()).toBe(true);
        await expect(mockOBS.call('GetVersion')).resolves.toEqual({});
    });

    it('builds deterministic goal configuration defaults', () => {
        const config = createTestConfig();

        expect(config.goals.tiktokGoalEnabled).toBe(true);
        expect(config.goals.tiktokGoalTarget).toBe(1000);
        expect(config.goals.youtubeGoalEnabled).toBe(true);
        expect(config.goals.twitchGoalTarget).toBe(500);
    });

    it('creates real sources and goals managers wired to shared tracker dependencies', () => {
        const mockOBS = createMockOBSForTesting();
        const sourcesManager = createRealSourcesManager(mockOBS);
        const goalTracker = createRealGoalTracker();
        const goalsManager = createRealGoalsManager(mockOBS, sourcesManager, goalTracker);

        expect(typeof sourcesManager.updateTextSource).toBe('function');
        expect(typeof goalTracker.getAllGoalStates).toBe('function');
        expect(typeof goalsManager.processDonationGoal).toBe('function');
    });

    it('creates bundled display queue dependencies with expected managers', () => {
        const dependencies = createDisplayQueueDependencies();

        expect(typeof dependencies.mockOBS.call).toBe('function');
        expect(typeof dependencies.sourcesManager.updateTextSource).toBe('function');
        expect(typeof dependencies.goalsManager.processDonationGoal).toBe('function');
        expect(typeof dependencies.goalTracker.getAllGoalStates).toBe('function');
    });
});
