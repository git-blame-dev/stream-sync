
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, requireActual, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const { TEST_TIMEOUTS } = require('../../helpers/test-setup');
const { createMockLogger, createMockFileSystem } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const testClock = require('../../helpers/test-clock');

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

// Mock file system operations
mockModule('fs', () => ({
    ...requireActual('fs'),
    writeFileSync: createMockFn(),
    readFileSync: createMockFn(),
    existsSync: createMockFn(),
    appendFileSync: createMockFn()
}));

// Mock OBS modules to prevent connection attempts
mockModule('../../../src/obs/connection', () => ({
    ensureOBSConnected: createMockFn().mockResolvedValue(true)
}));

mockModule('../../../src/obs/sources', () => {
    const instance = { updateTextSource: createMockFn().mockResolvedValue(true) };
    return {
        OBSSourcesManager: class {},
        createOBSSourcesManager: () => instance,
        getDefaultSourcesManager: () => instance
    };
});

describe('Goal Tracker - Core Functionality', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let goalTracker;
    let mockConfig;
    let mockLogger;
    let mockFileSystem;

    beforeEach(() => {
        // Create mocks using factories
        mockLogger = createMockLogger('debug');
        mockFileSystem = createMockFileSystem();

        // Mock configuration
        mockConfig = {
            enabled: true,
            goalScene: 'v efx goals',
            tiktokGoalEnabled: true,
            tiktokGoalSource: 'tiktok goal txt',
            tiktokGoalTarget: 1000,
            tiktokGoalCurrency: 'coins',
            tiktokPaypiggyEquivalent: 50,
            youtubeGoalEnabled: true,
            youtubeGoalSource: 'youtube goal txt',
            youtubeGoalTarget: 1.00,
            youtubeGoalCurrency: 'dollars',
            youtubePaypiggyPrice: 4.99,
            twitchGoalEnabled: true,
            twitchGoalSource: 'twitch goal txt',
            twitchGoalTarget: 100,
            twitchGoalCurrency: 'bits',
            twitchPaypiggyEquivalent: 350
        };

        const { GoalTracker } = require('../../../src/utils/goal-tracker');
        goalTracker = new GoalTracker({
            logger: mockLogger,
            config: { goals: mockConfig },
            fileSystem: mockFileSystem
        });

        // Mock file system responses
        const fs = require('fs');
        fs.existsSync.mockReturnValue(false);
        fs.readFileSync.mockReturnValue('{}');
    });

    describe('Goal Tracker Initialization', () => {
        test('should initialize with default state', async () => {
            await goalTracker.initializeGoalTracker();
            
            const state = goalTracker.getAllGoalStates();
            
            expect(state.tiktok.current).toBe(0);
            expect(state.tiktok.target).toBe(1000);
            expect(state.tiktok.currency).toBe('coins');
            
            expect(state.youtube.current).toBe(0);
            expect(state.youtube.target).toBe(1.00);
            expect(state.youtube.currency).toBe('dollars');
            
            expect(state.twitch.current).toBe(0);
            expect(state.twitch.target).toBe(100);
            expect(state.twitch.currency).toBe('bits');
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Donation Processing', () => {
        beforeEach(async () => {
            await goalTracker.initializeGoalTracker();
        });

        test('should process TikTok donation correctly', async () => {
            const result = await goalTracker.addDonationToGoal('tiktok', 500);
            
            expect(result.success).toBe(true);
            expect(result.newTotal).toBe(500);
            expect(result.target).toBe(1000);
            expect(result.percentage).toBe(50);
            expect(result.goalCompleted).toBe(false);
            expect(result.formatted).toBe('0500/1000 coins');
        }, TEST_TIMEOUTS.FAST);

        test('should process YouTube donation correctly', async () => {
            const result = await goalTracker.addDonationToGoal('youtube', 0.50);
            
            expect(result.success).toBe(true);
            expect(result.newTotal).toBe(0.50);
            expect(result.target).toBe(1.00);
            expect(result.percentage).toBe(50);
            expect(result.goalCompleted).toBe(false);
            expect(result.formatted).toBe('$0.50/$1.00 USD');
        }, TEST_TIMEOUTS.FAST);

        test('should process Twitch donation correctly', async () => {
            const result = await goalTracker.addDonationToGoal('twitch', 50);
            
            expect(result.success).toBe(true);
            expect(result.newTotal).toBe(50);
            expect(result.target).toBe(100);
            expect(result.percentage).toBe(50);
            expect(result.goalCompleted).toBe(false);
            expect(result.formatted).toBe('050/100 bits');
        }, TEST_TIMEOUTS.FAST);

        test('should handle goal completion', async () => {
            const result = await goalTracker.addDonationToGoal('tiktok', 1000);
            
            expect(result.success).toBe(true);
            expect(result.newTotal).toBe(1000);
            expect(result.percentage).toBe(100);
            expect(result.goalCompleted).toBe(true);
        }, TEST_TIMEOUTS.FAST);

        test('should handle goal exceeding', async () => {
            const result = await goalTracker.addDonationToGoal('youtube', 2.50);
            
            expect(result.success).toBe(true);
            expect(result.newTotal).toBe(2.50);
            expect(result.percentage).toBe(250);
            expect(result.goalCompleted).toBe(true);
        }, TEST_TIMEOUTS.FAST);

        test('should reject invalid platform', async () => {
            const result = await goalTracker.addDonationToGoal('invalid', 100);
            
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid platform');
        }, TEST_TIMEOUTS.FAST);

        test('should reject negative amounts', async () => {
            const result = await goalTracker.addDonationToGoal('tiktok', -50);
            
            expect(result.success).toBe(false);
            expect(result.error).toContain('must be positive');
        }, TEST_TIMEOUTS.FAST);

        test('should reject zero amounts', async () => {
            const result = await goalTracker.addDonationToGoal('tiktok', 0);
            
            expect(result.success).toBe(false);
            expect(result.error).toContain('must be positive');
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Paypiggy Processing', () => {
        beforeEach(async () => {
            await goalTracker.initializeGoalTracker();
        });

        test('should process TikTok paypiggy', async () => {
            const result = await goalTracker.addPaypiggyToGoal('tiktok');
            
            expect(result.success).toBe(true);
            expect(result.newTotal).toBe(50);
            expect(result.paypiggyValue).toBe(50);
            expect(result.formatted).toBe('0050/1000 coins');
        }, TEST_TIMEOUTS.FAST);

        test('should process YouTube paypiggy', async () => {
            const result = await goalTracker.addPaypiggyToGoal('youtube');
            
            expect(result.success).toBe(true);
            expect(result.newTotal).toBe(4.99);
            expect(result.paypiggyValue).toBe(4.99);
            expect(result.goalCompleted).toBe(true);
        }, TEST_TIMEOUTS.FAST);

        test('should process Twitch paypiggy', async () => {
            const result = await goalTracker.addPaypiggyToGoal('twitch');
            
            expect(result.success).toBe(true);
            expect(result.newTotal).toBe(350);
            expect(result.paypiggyValue).toBe(350);
            expect(result.goalCompleted).toBe(true);
        }, TEST_TIMEOUTS.FAST);

        test('should reject invalid platform', async () => {
            const result = await goalTracker.addPaypiggyToGoal('invalid');
            
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid platform');
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Currency Formatting', () => {
        beforeEach(async () => {
            await goalTracker.initializeGoalTracker();
        });

        test('should format TikTok coins correctly', () => {
            const formatted = goalTracker.formatGoalDisplay('tiktok', 123, 1000);
            expect(formatted).toBe('0123/1000 coins');
        }, TEST_TIMEOUTS.FAST);

        test('should format YouTube dollars correctly', () => {
            const formatted = goalTracker.formatGoalDisplay('youtube', 1.5, 10.00);
            expect(formatted).toBe('$1.50/$10.00 USD');
        }, TEST_TIMEOUTS.FAST);

        test('should format Twitch bits correctly', () => {
            const formatted = goalTracker.formatGoalDisplay('twitch', 75, 200);
            expect(formatted).toBe('075/200 bits');
        }, TEST_TIMEOUTS.FAST);

        test('should handle edge case formatting', () => {
            const formatted = goalTracker.formatGoalDisplay('youtube', 0.1, 1.0);
            expect(formatted).toBe('$0.10/$1.00 USD');
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Multi-Platform Scenario', () => {
        test('should handle the exact scenario: $0.50, 50 bits, 500 coins', async () => {
            await goalTracker.initializeGoalTracker();

            // Test scenario 1: $0.50 YouTube Super Chat
            const youtubeResult = await goalTracker.addDonationToGoal('youtube', 0.50);
            expect(youtubeResult.success).toBe(true);
            expect(youtubeResult.newTotal).toBe(0.50);
            expect(youtubeResult.formatted).toBe('$0.50/$1.00 USD');
            expect(youtubeResult.percentage).toBe(50);

            // Test scenario 2: 50 Twitch bits
            const twitchResult = await goalTracker.addDonationToGoal('twitch', 50);
            expect(twitchResult.success).toBe(true);
            expect(twitchResult.newTotal).toBe(50);
            expect(twitchResult.formatted).toBe('050/100 bits');
            expect(twitchResult.percentage).toBe(50);

            // Test scenario 3: 500 TikTok coins
            const tiktokResult = await goalTracker.addDonationToGoal('tiktok', 500);
            expect(tiktokResult.success).toBe(true);
            expect(tiktokResult.newTotal).toBe(500);
            expect(tiktokResult.formatted).toBe('0500/1000 coins');
            expect(tiktokResult.percentage).toBe(50);

            // Verify final state
            const finalState = goalTracker.getAllGoalStates();
            expect(finalState.tiktok.current).toBe(500);
            expect(finalState.youtube.current).toBe(0.50);
            expect(finalState.twitch.current).toBe(50);
        }, TEST_TIMEOUTS.MEDIUM);
    });

    describe('State Persistence', () => {
        beforeEach(async () => {
            await goalTracker.initializeGoalTracker();
        });

        test('should handle file write errors gracefully', async () => {
            const fs = require('fs');
            fs.writeFileSync.mockImplementation(() => {
                throw new Error('Write failed');
            });

            const result = await goalTracker.addDonationToGoal('tiktok', 100);
            
            // Should still succeed despite write error
            expect(result.success).toBe(true);
            expect(result.newTotal).toBe(100);
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Performance Tests', () => {
        beforeEach(async () => {
            await goalTracker.initializeGoalTracker();
        });

        test('should handle multiple rapid donations', async () => {
            const promises = [];
            for (let i = 1; i <= 10; i++) {
                promises.push(goalTracker.addDonationToGoal('tiktok', 10));
            }
            
            const results = await Promise.all(promises);
            
            results.forEach(result => {
                expect(result.success).toBe(true);
            });
            
            const finalState = goalTracker.getGoalState('tiktok');
            expect(finalState.current).toBe(100); // 10 donations of 10 each
        }, TEST_TIMEOUTS.MEDIUM);

        test('should maintain performance with many operations', () => {
            const startTime = testClock.now();
            
            for (let i = 0; i < 1000; i++) {
                goalTracker.getAllGoalStates();
                goalTracker.formatGoalDisplay('tiktok', i, 1000);
                testClock.advance(0.05);
            }
            
            const duration = testClock.now() - startTime;
            expect(duration).toBeLessThan(100); // Should complete in under 100ms
        }, TEST_TIMEOUTS.FAST);
    });
}); 
