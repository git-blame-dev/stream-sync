
const { 
    initializeTestLogging,
    createTestUser, 
    TEST_TIMEOUTS 
} = require('../helpers/test-setup');

const { 
    createMockLogger,
    createMockNotificationManager 
} = require('../helpers/mock-factories');

const { 
    setupAutomatedCleanup 
} = require('../helpers/mock-lifecycle');

const PlatformEventRouter = require('../../src/services/PlatformEventRouter');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Bits Goal Counter Fix', () => {
    let mockLogger;
    let mockNotificationManager;
    let mockAppRuntime;
    let mockEventBus;
    let router;

    beforeEach(() => {
        mockLogger = createMockLogger('debug', { captureConsole: true });
        mockNotificationManager = createMockNotificationManager({
            handleNotification: jest.fn().mockResolvedValue({
                success: true,
                displayed: true
            })
        });

        mockAppRuntime = {
            handleGiftNotification: jest.fn((platform, username, options = {}) => {
                const giftType = options.giftType;
                const giftCount = Number(options.giftCount);
                const amount = Number(options.amount);
                const currency = typeof options.currency === 'string' ? options.currency.trim() : '';

                if (!giftType || !Number.isFinite(giftCount) || giftCount <= 0 || !Number.isFinite(amount) || amount <= 0 || !currency) {
                    throw new Error('Gift notification requires giftType, giftCount, amount, and currency');
                }
            })
        };

        const handlers = {};
        mockEventBus = {
            subscribe: jest.fn((event, handler) => {
                if (!handlers[event]) {
                    handlers[event] = [];
                }
                handlers[event].push(handler);
                return () => {
                    handlers[event] = handlers[event].filter((h) => h !== handler);
                };
            }),
            emit: async (event, payload) => {
                if (!handlers[event]) {
                    return;
                }
                for (const handler of handlers[event]) {
                    await handler(payload);
                }
            }
        };

        router = new PlatformEventRouter({
            eventBus: mockEventBus,
            runtime: mockAppRuntime,
            notificationManager: mockNotificationManager,
            configService: { areNotificationsEnabled: jest.fn(() => true) },
            logger: mockLogger
        });
    });

    afterEach(() => {
        router?.dispose();
    });

    const emitCheer = async ({ bits, username, userId, message = '', id = 'cheer-evt-1' } = {}) => {
        const data = {
            username,
            userId,
            message,
            id,
            repeatCount: 1,
            timestamp: '2024-01-01T00:00:00.000Z',
            cheermoteInfo: { prefix: 'Cheer', isMixed: false }
        };

        if (bits !== undefined) {
            data.bits = bits;
            data.cheermoteInfo.bits = bits;
        }

        await mockEventBus.emit('platform:event', {
            platform: 'twitch',
            type: 'cheer',
            data
        });
    };

    describe('when Twitch bits cheer event occurs', () => {
        describe('and 100 bits are cheered', () => {
            it('should create gift notification with giftCount=1 and amount=100', async () => {
                const testUser = createTestUser({ username: 'BitsCheerer' });
                const bitsAmount = 100;

                await emitCheer({
                    bits: bitsAmount,
                    message: 'Great stream!',
                    username: testUser.username,
                    userId: testUser.userId,
                    id: 'cheer-evt-100'
                });

                expect(mockAppRuntime.handleGiftNotification).toHaveBeenCalledTimes(1);

                const notificationData = mockAppRuntime.handleGiftNotification.mock.calls[0][2];
                expect(notificationData.username).toBe(testUser.username);
                expect(notificationData.giftCount).toBe(1);
                expect(notificationData.amount).toBe(100);
                expect(notificationData.currency).toBe('bits');
                expect(notificationData.isBits).toBe(true);
            }, TEST_TIMEOUTS.FAST);

            it('should result in correct goal calculation (100 bits total, not 10000)', async () => {
                const testUser = createTestUser({ username: 'BitsCheerer' });
                const bitsAmount = 100;
                
                await emitCheer({
                    bits: bitsAmount,
                    username: testUser.username,
                    userId: testUser.userId,
                    id: 'cheer-evt-100-goal'
                });

                const notificationData = mockAppRuntime.handleGiftNotification.mock.calls[0][2];

                // When display-queue processes this notification:
                // individualCoinValue = notificationData.amount = 100
                // giftCount = notificationData.giftCount = 1  
                // totalGiftValue = 100 × 1 = 100 (CORRECT)
                // 
                // Previous broken behavior would have been:
                // giftCount = 100 (incorrectly set to bit amount)
                // totalGiftValue = 100 × 100 = 10,000 (WRONG)

                expect(notificationData.giftCount).toBe(1);
                expect(notificationData.amount).toBe(100);
                
                // Simulate the goal calculation that happens in display-queue.js
                const simulatedGoalValue = notificationData.amount * notificationData.giftCount;
                expect(simulatedGoalValue).toBe(100); // Should be 100, not 10,000
            }, TEST_TIMEOUTS.FAST);
        });

        describe('and 50 bits are cheered', () => {
            it('should create gift notification with giftCount=1 and amount=50', async () => {
                const testUser = createTestUser({ username: 'SmallBitsCheerer' });
                const bitsAmount = 50;
                
                await emitCheer({
                    bits: bitsAmount,
                    username: testUser.username,
                    userId: testUser.userId,
                    id: 'cheer-evt-50'
                });

                expect(mockAppRuntime.handleGiftNotification).toHaveBeenCalledTimes(1);

                const notificationData = mockAppRuntime.handleGiftNotification.mock.calls[0][2];
                expect(notificationData.giftCount).toBe(1);
                expect(notificationData.amount).toBe(50);
                expect(notificationData.currency).toBe('bits');
                expect(notificationData.isBits).toBe(true);

                const simulatedGoalValue = notificationData.amount * notificationData.giftCount;
                expect(simulatedGoalValue).toBe(50); // Should be 50, not 2,500
            }, TEST_TIMEOUTS.FAST);
        });

        describe('and 1000 bits are cheered', () => {
            it('should create gift notification with giftCount=1 and amount=1000', async () => {
                const testUser = createTestUser({ username: 'BigBitsCheerer' });
                const bitsAmount = 1000;
                
                await emitCheer({
                    bits: bitsAmount,
                    username: testUser.username,
                    userId: testUser.userId,
                    id: 'cheer-evt-1000'
                });

                expect(mockAppRuntime.handleGiftNotification).toHaveBeenCalledTimes(1);

                const notificationData = mockAppRuntime.handleGiftNotification.mock.calls[0][2];
                expect(notificationData.giftCount).toBe(1);
                expect(notificationData.amount).toBe(1000);
                expect(notificationData.currency).toBe('bits');
                expect(notificationData.isBits).toBe(true);

                const simulatedGoalValue = notificationData.amount * notificationData.giftCount;
                expect(simulatedGoalValue).toBe(1000); // Should be 1000, not 1,000,000
            }, TEST_TIMEOUTS.FAST);
        });
    });

    describe('edge cases', () => {
        it('should handle large bit amounts correctly', async () => {
            const testUser = createTestUser({ username: 'MassiveBits' });
            const largeBitsAmount = 10000;
            
            await emitCheer({
                bits: largeBitsAmount,
                username: testUser.username,
                userId: testUser.userId,
                id: 'cheer-evt-large'
            });

            const notificationData = mockAppRuntime.handleGiftNotification.mock.calls[0][2];
            
            expect(notificationData.giftCount).toBe(1);
            expect(notificationData.amount).toBe(largeBitsAmount);
            
            // Goal value should be the bit amount, not bit amount squared
            const simulatedGoalValue = notificationData.amount * notificationData.giftCount;
            expect(simulatedGoalValue).toBe(largeBitsAmount);
        }, TEST_TIMEOUTS.FAST);
    });

    describe('regression validation', () => {
        it('should prevent inflated goal increments for 100-bit cheers', async () => {
            // This test simulates the previously reported scenario:
            // Input: 100 bits
            // Expected: 100 added to goal 
            // Prior outcome: 40010 (suggests multiple 10,000 calculations)
            
            const testUser = createTestUser({ username: 'BugReporter' });
            const bitsAmount = 100;
            
            await emitCheer({
                bits: bitsAmount,
                username: testUser.username,
                userId: testUser.userId,
                id: 'cheer-evt-regression'
            });

            const notificationData = mockAppRuntime.handleGiftNotification.mock.calls[0][2];
            
            // Verify the expected data structure
            expect(notificationData.giftCount).toBe(1);     // Expected 1 instead of 100
            expect(notificationData.amount).toBe(100);      // Correct bit amount
            
            // This would have been the legacy calculation:
            // const brokenGoalValue = notificationData.amount * 100; // Using bits as giftCount
            // expect(brokenGoalValue).toBe(10000); // Incorrect result
            
            // This is the expected calculation:
            const goalValue = notificationData.amount * notificationData.giftCount;
            expect(goalValue).toBe(100); // Correct result
            
            // Ensure we're not getting the inflated numbers
            expect(goalValue).not.toBe(10000);
            expect(goalValue).not.toBe(40010);
        }, TEST_TIMEOUTS.FAST);
    });
});
