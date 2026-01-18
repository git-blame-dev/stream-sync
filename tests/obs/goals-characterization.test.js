
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { TEST_TIMEOUTS } = require('../helpers/test-setup');
const { noOpLogger, createMockSourcesManager } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const testClock = require('../helpers/test-clock');
const { createOBSGoalsManager } = require('../../src/obs/goals');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('OBS Goals Module Characterization Tests', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let goalsModule;
    let mockObsManager;
    let mockConfigManager;
    let mockSourcesManager;
    let mockGoalTracker;

    beforeEach(() => {
        mockSourcesManager = createMockSourcesManager();

        mockObsManager = {
            isConnected: createMockFn().mockReturnValue(true)
        };

        mockConfigManager = {
            getBoolean: createMockFn().mockImplementation((section, key, defaultValue) => {
                const responses = {
                    'goals.enabled': true,
                    'goals.tiktokGoalEnabled': true,
                    'goals.youtubeGoalEnabled': true,
                    'goals.twitchGoalEnabled': true
                };
                return responses[`${section}.${key}`] !== undefined ? responses[`${section}.${key}`] : defaultValue;
            }),
            getString: createMockFn().mockImplementation((section, key, defaultValue) => {
                const responses = {
                    'goals.tiktokGoalSource': 'tiktok goal txt',
                    'goals.youtubeGoalSource': 'youtube goal txt',
                    'goals.twitchGoalSource': 'twitch goal txt'
                };
                return responses[`${section}.${key}`] !== undefined ? responses[`${section}.${key}`] : defaultValue;
            }),
            getNumber: createMockFn()
        };

        mockGoalTracker = {
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

        goalsModule = createOBSGoalsManager(mockObsManager, {
            logger: noOpLogger,
            configManager: mockConfigManager,
            updateTextSource: mockSourcesManager.updateTextSource,
            goalTracker: mockGoalTracker,
            runtimeConstants: { NOTIFICATION_PLATFORM_LOGOS: {}, CHAT_PLATFORM_LOGOS: {} }
        });
    });

    describe('Goal System Initialization', () => {
        test('initializeGoalDisplay should initialize goal tracker and update displays when OBS connected', async () => {
            const { updateTextSource } = mockSourcesManager;

            mockObsManager.isConnected.mockReturnValue(true);

            await goalsModule.initializeGoalDisplay();

            expect(mockGoalTracker.initializeGoalTracker).toHaveBeenCalled();
            expect(mockGoalTracker.getAllGoalStates).toHaveBeenCalled();
            expect(updateTextSource).toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('initializeGoalDisplay should skip OBS updates when OBS not connected', async () => {
            const { updateTextSource } = mockSourcesManager;

            mockObsManager.isConnected.mockReturnValue(false);

            await goalsModule.initializeGoalDisplay();

            expect(mockGoalTracker.initializeGoalTracker).toHaveBeenCalled();
            expect(mockGoalTracker.getAllGoalStates).not.toHaveBeenCalled();
            expect(updateTextSource).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('initializeGoalDisplay should return early when goals disabled', async () => {
            const { updateTextSource } = mockSourcesManager;

            mockConfigManager.getBoolean.mockImplementation((section, key, defaultValue) => {
                if (section === 'goals' && key === 'enabled') return false;
                return defaultValue;
            });

            await goalsModule.initializeGoalDisplay();

            expect(mockGoalTracker.initializeGoalTracker).not.toHaveBeenCalled();
            expect(updateTextSource).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('initializeGoalDisplay should handle initialization errors gracefully', async () => {
            const error = new Error('Goal tracker initialization failed');
            mockGoalTracker.initializeGoalTracker.mockRejectedValueOnce(error);

            await expect(goalsModule.initializeGoalDisplay()).rejects.toThrow('Goal tracker initialization failed');
        }, TEST_TIMEOUTS.FAST);

        test('initializeGoalDisplay should handle errors from updateAllGoalDisplays gracefully', async () => {
            const obsError = new Error('OBS not connected');
            mockGoalTracker.getAllGoalStates.mockImplementationOnce(() => {
                throw obsError;
            });

            await expect(goalsModule.initializeGoalDisplay()).resolves.toBeUndefined();
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Goal Display Updates', () => {
        test('updateAllGoalDisplays should update all enabled platform goals when OBS connected', async () => {
            const { updateTextSource } = mockSourcesManager;

            await goalsModule.updateAllGoalDisplays();

            expect(mockGoalTracker.getAllGoalStates).toHaveBeenCalled();
            expect(updateTextSource).toHaveBeenCalledWith('tiktok goal txt', '500/1000 coins');
            expect(updateTextSource).toHaveBeenCalledWith('youtube goal txt', '$0.50/$1.00 USD');
            expect(updateTextSource).toHaveBeenCalledWith('twitch goal txt', '050/100 bits');
        }, TEST_TIMEOUTS.FAST);

        test('updateAllGoalDisplays should skip updates when OBS not connected', async () => {
            const { updateTextSource } = mockSourcesManager;

            mockObsManager.isConnected.mockReturnValue(false);

            await goalsModule.updateAllGoalDisplays();

            expect(mockGoalTracker.getAllGoalStates).not.toHaveBeenCalled();
            expect(updateTextSource).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('updateGoalDisplay should update specific platform goal', async () => {
            const { updateTextSource } = mockSourcesManager;

            await goalsModule.updateGoalDisplay('tiktok');

            expect(mockGoalTracker.getGoalState).toHaveBeenCalledWith('tiktok');
            expect(updateTextSource).toHaveBeenCalledWith('tiktok goal txt', '500/1000 coins');
        }, TEST_TIMEOUTS.FAST);

        test('updateGoalDisplay should handle disabled platform gracefully', async () => {
            const { updateTextSource } = mockSourcesManager;

            mockConfigManager.getBoolean.mockImplementation((section, key, defaultValue) => {
                if (section === 'goals' && key === 'youtubeGoalEnabled') return false;
                return defaultValue;
            });

            await goalsModule.updateGoalDisplay('youtube');

            expect(updateTextSource).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Event Processing', () => {
        test('processDonationGoal should process donation and update display', async () => {
            const { updateTextSource } = mockSourcesManager;

            mockObsManager.isConnected.mockReturnValue(true);

            mockGoalTracker.addDonationToGoal.mockResolvedValue({
                success: true,
                formatted: '500/1000 coins',
                current: 500,
                target: 1000,
                percentage: 50
            });

            updateTextSource.mockResolvedValue();

            const result = await goalsModule.processDonationGoal('tiktok', 100);

            expect(mockGoalTracker.addDonationToGoal).toHaveBeenCalledWith('tiktok', 100);
            expect(updateTextSource).toHaveBeenCalledWith('tiktok goal txt', '500/1000 coins');
            expect(result.success).toBe(true);
        }, TEST_TIMEOUTS.FAST);

        test('processPaypiggyGoal should process paypiggy and update display', async () => {
            const { updateTextSource } = mockSourcesManager;

            mockObsManager.isConnected.mockReturnValue(true);

            mockGoalTracker.addPaypiggyToGoal.mockResolvedValue({
                success: true,
                formatted: '500/1000 coins',
                current: 500,
                target: 1000,
                percentage: 50
            });

            updateTextSource.mockResolvedValue();

            const result = await goalsModule.processPaypiggyGoal('tiktok');

            expect(mockGoalTracker.addPaypiggyToGoal).toHaveBeenCalledWith('tiktok');
            expect(updateTextSource).toHaveBeenCalledWith('tiktok goal txt', '500/1000 coins');
            expect(result.success).toBe(true);
        }, TEST_TIMEOUTS.FAST);

        test('should handle donation processing errors gracefully', async () => {
            const error = new Error('Donation processing failed');
            mockGoalTracker.addDonationToGoal.mockRejectedValueOnce(error);

            const result = await goalsModule.processDonationGoal('tiktok', 100);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Donation processing failed');
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

            expect(mockGoalTracker.getAllGoalStates).toHaveBeenCalled();
            expect(statuses).toEqual({
                tiktok: { current: 500, target: 1000, formatted: '500/1000 coins' },
                youtube: { current: 0.50, target: 1.00, formatted: '$0.50/$1.00 USD' },
                twitch: { current: 50, target: 100, formatted: '050/100 bits' }
            });
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Configuration Handling', () => {
        test('should respect platform enable/disable flags', async () => {
            const { updateTextSource } = mockSourcesManager;

            mockConfigManager.getBoolean.mockImplementation((section, key, defaultValue) => {
                if (section === 'goals' && key === 'youtubeGoalEnabled') return false;
                return defaultValue;
            });

            await goalsModule.updateAllGoalDisplays();

            expect(updateTextSource).toHaveBeenCalledWith('tiktok goal txt', '500/1000 coins');
            expect(updateTextSource).toHaveBeenCalledWith('twitch goal txt', '050/100 bits');
            expect(updateTextSource).not.toHaveBeenCalledWith('youtube goal txt', expect.any(String));
        }, TEST_TIMEOUTS.FAST);

        test('should handle missing source configurations gracefully', async () => {
            const { updateTextSource } = mockSourcesManager;

            mockConfigManager.getString.mockImplementation((section, key, defaultValue) => {
                if (section === 'goals' && key === 'tiktokGoalSource') return undefined;
                return defaultValue;
            });

            await goalsModule.updateGoalDisplay('tiktok');

            expect(updateTextSource).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Error Handling', () => {
        test('should handle OBS connection errors gracefully', async () => {
            const { updateTextSource } = mockSourcesManager;

            updateTextSource.mockRejectedValueOnce(new Error('OBS connection failed'));

            await expect(goalsModule.updateGoalDisplay('tiktok')).resolves.toBeUndefined();
        }, TEST_TIMEOUTS.FAST);

        test('should handle goal tracker errors gracefully', async () => {
            mockGoalTracker.getGoalState.mockImplementationOnce(() => {
                throw new Error('Goal tracker error');
            });

            const result = await goalsModule.getCurrentGoalStatus('tiktok');
            expect(result).toBeNull();
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Performance Tests', () => {
        test('should handle rapid goal updates efficiently', async () => {
            const startTime = testClock.now();

            for (let i = 0; i < 10; i++) {
                await goalsModule.updateGoalDisplay('tiktok');
            }

            testClock.advance(10);
            const duration = testClock.now() - startTime;
            expect(duration).toBeLessThan(1000);
        }, TEST_TIMEOUTS.MEDIUM);

        test('should handle multiple platform updates efficiently', async () => {
            const startTime = testClock.now();

            for (let i = 0; i < 5; i++) {
                await goalsModule.updateAllGoalDisplays();
            }

            testClock.advance(15);
            const duration = testClock.now() - startTime;
            expect(duration).toBeLessThan(1000);
        }, TEST_TIMEOUTS.MEDIUM);
    });
});
