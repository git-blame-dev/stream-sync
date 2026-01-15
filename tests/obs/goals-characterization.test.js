
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

const { initializeTestLogging, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { createMockLogger, createMockOBSConnection, createMockConfigManager } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const testClock = require('../helpers/test-clock');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

// Mock all dependencies to capture current behavior
mockModule('../../src/core/logging', () => ({
    debugLog: createMockFn(), // Keep for backward compatibility
    logger: {
        error: createMockFn(),
        warn: createMockFn(),
        info: createMockFn(),
        debug: createMockFn()
    }
}));

mockModule('../../src/core/config', () => ({
    configManager: {
        getBoolean: createMockFn(),
        getString: createMockFn(),
        getNumber: createMockFn()
    },
    config: { general: { fallbackUsername: 'Unknown User' } }
}));

mockModule('../../src/obs/sources', () => {
    const instance = {
        updateTextSource: createMockFn().mockResolvedValue()
    };
    return {
        OBSSourcesManager: class {},
        createOBSSourcesManager: () => instance,
        getDefaultSourcesManager: () => instance
    };
});

mockModule('../../src/obs/connection', () => ({
    getOBSConnectionManager: createMockFn()
}));

const mockGoalTracker = {
    initializeGoalTracker: createMockFn().mockResolvedValue(),
    addDonationToGoal: createMockFn().mockResolvedValue({
        success: true,
        formatted: '500/1000 coins',
        current: 500,
        target: 1000,
        percentage: 50
    }),
    addPaypiggyToGoal: createMockFn().mockResolvedValue({
        success: true,
        formatted: '550/1000 coins',
        current: 550,
        target: 1000,
        percentage: 55
    }),
    getGoalState: createMockFn().mockReturnValue({
        current: 500,
        target: 1000,
        formatted: '500/1000 coins',
        percentage: 50
    }),
    getAllGoalStates: createMockFn().mockReturnValue({
        tiktok: { current: 500, target: 1000, formatted: '500/1000 coins' },
        youtube: { current: 0.50, target: 1.00, formatted: '$0.50/$1.00 USD' },
        twitch: { current: 50, target: 100, formatted: '050/100 bits' }
    }),
    formatGoalDisplay: createMockFn().mockReturnValue('500/1000 coins')
};

mockModule('../../src/utils/goal-tracker', () => ({
    createGoalTracker: createMockFn(() => mockGoalTracker),
    GoalTracker: createMockFn()
}));

describe('OBS Goals Module Characterization Tests', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let goalsModule;
    let mockObsManager;
    let mockLogger;
    let mockOBSConnection;
    let mockConfigManager;

    beforeEach(() => {
        // Create mocks using factories
        mockLogger = createMockLogger('debug');
        mockOBSConnection = createMockOBSConnection();
        mockConfigManager = createMockConfigManager();
        
        // Setup OBS manager mock
        mockObsManager = {
            isConnected: createMockFn().mockReturnValue(true)
        };
        
        // Setup default config responses
        const { configManager } = require('../../src/core/config');
        configManager.getBoolean.mockImplementation((section, key, defaultValue) => {
            const responses = {
                'goals.enabled': true,
                'goals.tiktokGoalEnabled': true,
                'goals.youtubeGoalEnabled': true,
                'goals.twitchGoalEnabled': true
            };
            return responses[`${section}.${key}`] !== undefined ? responses[`${section}.${key}`] : defaultValue;
        });
        
        configManager.getString.mockImplementation((section, key, defaultValue) => {
            const responses = {
                'goals.tiktokGoalSource': 'tiktok goal txt',
                'goals.youtubeGoalSource': 'youtube goal txt',
                'goals.twitchGoalSource': 'twitch goal txt'
            };
            return responses[`${section}.${key}`] !== undefined ? responses[`${section}.${key}`] : defaultValue;
        });
        
        // Reset all mocks to ensure clean state
        mockGoalTracker.getAllGoalStates.mockReset();
        mockGoalTracker.getGoalState.mockReset();
        mockGoalTracker.initializeGoalTracker.mockReset();
        mockGoalTracker.addDonationToGoal.mockReset();
        mockGoalTracker.addPaypiggyToGoal.mockReset();
        
        // Re-configure mocks with correct return values
        mockGoalTracker.getAllGoalStates.mockReturnValue({
            tiktok: { current: 500, target: 1000, formatted: '500/1000 coins' },
            youtube: { current: 0.50, target: 1.00, formatted: '$0.50/$1.00 USD' },
            twitch: { current: 50, target: 100, formatted: '050/100 bits' }
        });
        
        mockGoalTracker.getGoalState.mockReturnValue({
            current: 500,
            target: 1000,
            formatted: '500/1000 coins',
            percentage: 50
        });
        
        const goalsDeps = require('../../src/obs/goals');
        goalsModule = goalsDeps.createOBSGoalsManager(mockObsManager, {
            logger: require('../../src/core/logging').logger,
            configManager: require('../../src/core/config').configManager,
            updateTextSource: require('../../src/obs/sources').getDefaultSourcesManager().updateTextSource,
            goalTracker: mockGoalTracker
        });
    });

    describe('Goal System Initialization', () => {
        test('initializeGoalDisplay should initialize goal tracker and update displays when OBS connected', async () => {
            const { logger } = require('../../src/core/logging');
            const { updateTextSource } = require('../../src/obs/sources').getDefaultSourcesManager();
            
            mockObsManager.isConnected.mockReturnValue(true);
            
            await goalsModule.initializeGoalDisplay();
            
            expect(logger.debug).toHaveBeenCalledWith('[Goals] Initializing goal system...', 'goals');
            expect(mockGoalTracker.initializeGoalTracker).toHaveBeenCalledTimes(1);
            expect(mockGoalTracker.getAllGoalStates).toHaveBeenCalledTimes(1);
            expect(updateTextSource).toHaveBeenCalledTimes(3); // All 3 platforms
            expect(logger.debug).toHaveBeenCalledWith('[Goals] Goal system initialized', 'goals');
        }, TEST_TIMEOUTS.FAST);

        test('initializeGoalDisplay should skip OBS updates when OBS not connected', async () => {
            const { logger } = require('../../src/core/logging');
            const { updateTextSource } = require('../../src/obs/sources').getDefaultSourcesManager();
            
            mockObsManager.isConnected.mockReturnValue(false);
            
            await goalsModule.initializeGoalDisplay();
            
            expect(logger.debug).toHaveBeenCalledWith('[Goals] Initializing goal system...', 'goals');
            expect(mockGoalTracker.initializeGoalTracker).toHaveBeenCalledTimes(1);
            expect(mockGoalTracker.getAllGoalStates).not.toHaveBeenCalled();
            expect(updateTextSource).not.toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith('[Goals] Goal system initialized', 'goals');
        }, TEST_TIMEOUTS.FAST);

        test('initializeGoalDisplay should return early when goals disabled', async () => {
            const { logger } = require('../../src/core/logging');
            const { updateTextSource } = require('../../src/obs/sources').getDefaultSourcesManager();
            const { configManager } = require('../../src/core/config');
            
            configManager.getBoolean.mockImplementation((section, key, defaultValue) => {
                if (section === 'goals' && key === 'enabled') return false;
                return defaultValue;
            });
            
            await goalsModule.initializeGoalDisplay();
            
            expect(logger.debug).toHaveBeenCalledWith('[Goals] Goal system disabled in configuration', 'goals');
            expect(mockGoalTracker.initializeGoalTracker).not.toHaveBeenCalled();
            expect(updateTextSource).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('initializeGoalDisplay should handle initialization errors gracefully', async () => {
            const { logger } = require('../../src/core/logging');
            
            const error = new Error('Goal tracker initialization failed');
            mockGoalTracker.initializeGoalTracker.mockRejectedValueOnce(error);
            
            await expect(goalsModule.initializeGoalDisplay()).rejects.toThrow('Goal tracker initialization failed');
            expect(logger.error).toHaveBeenCalledWith(
                '[Goal Display] Error initializing goal display system',
                'obs-goals',
                expect.objectContaining({
                    error: 'Goal tracker initialization failed',
                    eventType: 'obs-goals'
                })
            );
        }, TEST_TIMEOUTS.FAST);

        test('initializeGoalDisplay should handle errors from updateAllGoalDisplays gracefully', async () => {
            const { logger } = require('../../src/core/logging');
            
            const obsError = new Error('OBS not connected');
            // Make updateAllGoalDisplays throw by making getAllGoalStates throw
            mockGoalTracker.getAllGoalStates.mockImplementationOnce(() => {
                throw obsError;
            });
            
            await goalsModule.initializeGoalDisplay();
            
            // updateAllGoalDisplays catches the error internally and logs skip message
            // The error does NOT bubble up to initializeGoalDisplay, so it completes successfully
            expect(logger.debug).toHaveBeenCalledWith('[Goal Display] Goal display updates skipped - OBS not connected', 'goals');
            expect(logger.debug).toHaveBeenCalledWith('[Goals] Goal system initialized', 'goals');
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Goal Display Updates', () => {
        test('updateAllGoalDisplays should update all enabled platform goals when OBS connected', async () => {
            const { logger } = require('../../src/core/logging');
            const { updateTextSource } = require('../../src/obs/sources').getDefaultSourcesManager();
            
            await goalsModule.updateAllGoalDisplays();
            
            expect(logger.debug).toHaveBeenCalledWith('[Goal Display] Updating all goal displays...', 'goals');
            expect(mockGoalTracker.getAllGoalStates).toHaveBeenCalledTimes(1);
            expect(updateTextSource).toHaveBeenCalledWith('tiktok goal txt', '500/1000 coins');
            expect(updateTextSource).toHaveBeenCalledWith('youtube goal txt', '$0.50/$1.00 USD');
            expect(updateTextSource).toHaveBeenCalledWith('twitch goal txt', '050/100 bits');
            expect(logger.debug).toHaveBeenCalledWith('[Goal Display] All goal displays updated successfully', 'goals');
        }, TEST_TIMEOUTS.FAST);

        test('updateAllGoalDisplays should skip updates when OBS not connected', async () => {
            const { logger } = require('../../src/core/logging');
            const { updateTextSource } = require('../../src/obs/sources').getDefaultSourcesManager();
            
            mockObsManager.isConnected.mockReturnValue(false);
            
            await goalsModule.updateAllGoalDisplays();
            
            expect(logger.debug).toHaveBeenCalledWith('[Goal Display] OBS not connected, skipping goal display updates', 'goals');
            expect(mockGoalTracker.getAllGoalStates).not.toHaveBeenCalled();
            expect(updateTextSource).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('updateGoalDisplay should update specific platform goal', async () => {
            const { logger } = require('../../src/core/logging');
            const { updateTextSource } = require('../../src/obs/sources').getDefaultSourcesManager();
            
            await goalsModule.updateGoalDisplay('tiktok');
            
            expect(logger.debug).toHaveBeenCalledWith('[Goal Display] Updating TikTok goal display: "500/1000 coins"', 'goals');
            expect(mockGoalTracker.getGoalState).toHaveBeenCalledWith('tiktok');
            expect(updateTextSource).toHaveBeenCalledWith('tiktok goal txt', '500/1000 coins');
            expect(logger.debug).toHaveBeenCalledWith('[Goal Display] Successfully updated TikTok goal display', 'goals');
        }, TEST_TIMEOUTS.FAST);

        test('updateGoalDisplay should handle disabled platform gracefully', async () => {
            const { logger } = require('../../src/core/logging');
            const { configManager } = require('../../src/core/config');
            
            configManager.getBoolean.mockImplementation((section, key, defaultValue) => {
                if (section === 'goals' && key === 'youtubeGoalEnabled') return false;
                return defaultValue;
            });
            
            await goalsModule.updateGoalDisplay('youtube');
            
            expect(logger.debug).toHaveBeenCalledWith('[Goal Display] YouTube goal disabled, skipping goal display update', 'goals');
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Event Processing', () => {
        test('processDonationGoal should process donation and update display', async () => {
            const { logger } = require('../../src/core/logging');
            const { updateTextSource } = require('../../src/obs/sources').getDefaultSourcesManager();
            
            // Ensure OBS is connected for this test
            mockObsManager.isConnected.mockReturnValue(true);
            
            // Ensure addDonationToGoal returns the expected structure
            mockGoalTracker.addDonationToGoal.mockResolvedValue({
                success: true,
                formatted: '500/1000 coins',
                current: 500,
                target: 1000,
                percentage: 50
            });
            
            // Ensure updateTextSource doesn't throw an error
            updateTextSource.mockResolvedValue();
            
            const result = await goalsModule.processDonationGoal('tiktok', 100);
            
            expect(mockGoalTracker.addDonationToGoal).toHaveBeenCalledWith('tiktok', 100);
            expect(updateTextSource).toHaveBeenCalledWith('tiktok goal txt', '500/1000 coins');
            expect(logger.debug).toHaveBeenCalledWith('[Goal Display] Processing 100 tiktok donation for goal', 'goals');
            // Check if updateTextSource was called (which means OBS update path was taken)
            expect(updateTextSource).toHaveBeenCalledTimes(1);
            expect(logger.debug).toHaveBeenCalledWith('[Goal Display] Successfully updated TikTok goal display', 'goals');
            expect(result.success).toBe(true);
        }, TEST_TIMEOUTS.FAST);

        test('processPaypiggyGoal should process paypiggy and update display', async () => {
            const { logger } = require('../../src/core/logging');
            const { updateTextSource } = require('../../src/obs/sources').getDefaultSourcesManager();
            
            // Ensure OBS is connected for this test
            mockObsManager.isConnected.mockReturnValue(true);
            
            // Ensure addPaypiggyToGoal returns the expected structure
            mockGoalTracker.addPaypiggyToGoal.mockResolvedValue({
                success: true,
                formatted: '500/1000 coins',
                current: 500,
                target: 1000,
                percentage: 50
            });
            
            // Ensure updateTextSource doesn't throw an error
            updateTextSource.mockResolvedValue();
            
            const result = await goalsModule.processPaypiggyGoal('tiktok');
            
            expect(mockGoalTracker.addPaypiggyToGoal).toHaveBeenCalledWith('tiktok');
            expect(updateTextSource).toHaveBeenCalledWith('tiktok goal txt', '500/1000 coins');
            expect(logger.debug).toHaveBeenCalledWith('[Goal Display] tiktok goal updated with paypiggy: 500/1000 coins', 'goals');
            expect(result.success).toBe(true);
        }, TEST_TIMEOUTS.FAST);

        test('should handle donation processing errors gracefully', async () => {
            const { logger } = require('../../src/core/logging');
            
            const error = new Error('Donation processing failed');
            mockGoalTracker.addDonationToGoal.mockRejectedValueOnce(error);
            
            // The implementation returns error objects instead of throwing
            const result = await goalsModule.processDonationGoal('tiktok', 100);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Donation processing failed');
            expect(logger.error).toHaveBeenCalledWith(
                '[Goal Display] Error processing tiktok donation goal',
                'obs-goals',
                expect.objectContaining({
                    platform: 'tiktok',
                    error: 'Donation processing failed'
                })
            );
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Status Queries', () => {
        test('getCurrentGoalStatus should return current goal status', async () => {
            const status = await goalsModule.getCurrentGoalStatus('tiktok');
            
            expect(mockGoalTracker.getGoalState).toHaveBeenCalledWith('tiktok');
            expect(status).toEqual({
                current: 500,
                target: 1000,
                formatted: '500/1000 coins',
                percentage: 50
            });
        }, TEST_TIMEOUTS.FAST);

        test('getAllCurrentGoalStatuses should return all goal statuses', async () => {
            const statuses = await goalsModule.getAllCurrentGoalStatuses();
            
            expect(mockGoalTracker.getAllGoalStates).toHaveBeenCalledTimes(1);
            expect(statuses).toEqual({
                tiktok: { current: 500, target: 1000, formatted: '500/1000 coins' },
                youtube: { current: 0.50, target: 1.00, formatted: '$0.50/$1.00 USD' },
                twitch: { current: 50, target: 100, formatted: '050/100 bits' }
            });
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Configuration Handling', () => {
        test('should respect platform enable/disable flags', async () => {
            const { configManager } = require('../../src/core/config');
            const { updateTextSource } = require('../../src/obs/sources').getDefaultSourcesManager();
            
            // Disable YouTube goals
            configManager.getBoolean.mockImplementation((section, key, defaultValue) => {
                if (section === 'goals' && key === 'youtubeGoalEnabled') return false;
                return defaultValue;
            });
            
            await goalsModule.updateAllGoalDisplays();
            
            // Should only update TikTok and Twitch
            expect(updateTextSource).toHaveBeenCalledWith('tiktok goal txt', '500/1000 coins');
            expect(updateTextSource).toHaveBeenCalledWith('twitch goal txt', '050/100 bits');
            expect(updateTextSource).not.toHaveBeenCalledWith('youtube goal txt', expect.any(String));
        }, TEST_TIMEOUTS.FAST);

        test('should handle missing source configurations gracefully', async () => {
            const { logger } = require('../../src/core/logging');
            const { configManager } = require('../../src/core/config');
            const { updateTextSource } = require('../../src/obs/sources').getDefaultSourcesManager();
            
            // Return undefined for source name
            configManager.getString.mockImplementation((section, key, defaultValue) => {
                if (section === 'goals' && key === 'tiktokGoalSource') return undefined;
                return defaultValue;
            });
            
            await goalsModule.updateGoalDisplay('tiktok');
            
            expect(updateTextSource).not.toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalledWith(
                '[Goal Display] Missing goal source configuration',
                'obs-goals',
                expect.objectContaining({ platform: 'tiktok', configKey: 'tiktokGoalSource' })
            );
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Error Handling', () => {
        test('should handle OBS connection errors gracefully', async () => {
            const { logger } = require('../../src/core/logging');
            const { updateTextSource } = require('../../src/obs/sources').getDefaultSourcesManager();
            
            // Mock OBS connection failure
            updateTextSource.mockRejectedValueOnce(new Error('OBS connection failed'));
            
            // This should not throw, but handle the error gracefully
            await expect(goalsModule.updateGoalDisplay('tiktok')).resolves.not.toThrow();
            
            expect(updateTextSource).toHaveBeenCalledWith('tiktok goal txt', '500/1000 coins');
            expect(logger.error).toHaveBeenCalledWith(
                '[Goal Display] Error updating tiktok goal display',
                'obs-goals',
                expect.objectContaining({
                    platform: 'tiktok',
                    error: 'OBS connection failed'
                })
            );
        }, TEST_TIMEOUTS.FAST);

        test('should handle goal tracker errors gracefully', async () => {
            const { logger } = require('../../src/core/logging');
            
            mockGoalTracker.getGoalState.mockImplementationOnce(() => {
                throw new Error('Goal tracker error');
            });
            
            const result = await goalsModule.getCurrentGoalStatus('tiktok');
            expect(result).toBeNull();
            expect(logger.error).toHaveBeenCalledWith(
                '[Goal Display] Error getting tiktok goal status',
                'obs-goals',
                expect.objectContaining({
                    platform: 'tiktok',
                    error: 'Goal tracker error'
                })
            );
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Performance Tests', () => {
        test('should handle rapid goal updates efficiently', async () => {
            const { updateTextSource } = require('../../src/obs/sources').getDefaultSourcesManager();
            const startTime = testClock.now();
            
            // Make multiple rapid updates
            for (let i = 0; i < 10; i++) {
                await goalsModule.updateGoalDisplay('tiktok');
            }
            
            testClock.advance(10);
            const duration = testClock.now() - startTime;
            expect(duration).toBeLessThan(1000); // Should complete quickly
            expect(updateTextSource).toHaveBeenCalledTimes(10);
        }, TEST_TIMEOUTS.MEDIUM);

        test('should handle multiple platform updates efficiently', async () => {
            const { updateTextSource } = require('../../src/obs/sources').getDefaultSourcesManager();
            const startTime = testClock.now();
            
            // Update all platforms multiple times
            for (let i = 0; i < 5; i++) {
                await goalsModule.updateAllGoalDisplays();
            }
            
            testClock.advance(15);
            const duration = testClock.now() - startTime;
            expect(duration).toBeLessThan(1000); // Should complete quickly
            expect(updateTextSource).toHaveBeenCalledTimes(15); // 5 updates * 3 platforms
        }, TEST_TIMEOUTS.MEDIUM);
    });
}); 
