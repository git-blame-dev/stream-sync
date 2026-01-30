const { describe, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { createTestUser, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { noOpLogger, createMockNotificationManager } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { createConfigFixture } = require('../helpers/config-fixture');
const PlatformEventRouter = require('../../src/services/PlatformEventRouter');

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
        mockLogger = noOpLogger;
        mockNotificationManager = createMockNotificationManager({
            handleNotification: createMockFn().mockResolvedValue({
                success: true,
                displayed: true
            })
        });

        mockAppRuntime = {
            handleGiftNotification: createMockFn((platform, username, options = {}) => {
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
            subscribe: createMockFn((event, handler) => {
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
            config: createConfigFixture({ general: { followsEnabled: true, giftsEnabled: true, messagesEnabled: true } }),
            logger: mockLogger
        });
    });

    afterEach(() => {
        restoreAllMocks();
        router?.dispose();
    });

    const emitGift = async ({ bits, username, userId, message = '', id = 'cheer-evt-1' } = {}) => {
        const data = {
            username,
            userId,
            message,
            id,
            repeatCount: 1,
            timestamp: '2024-01-01T00:00:00.000Z',
            giftType: 'bits',
            giftCount: 1,
            amount: bits,
            currency: 'bits',
            cheermoteInfo: { prefix: 'Cheer', isMixed: false }
        };

        if (bits !== undefined) {
            data.bits = bits;
            data.cheermoteInfo.bits = bits;
        }

        await mockEventBus.emit('platform:event', {
            platform: 'twitch',
            type: 'platform:gift',
            data
        });
    };

    describe('when Twitch bits gift event occurs', () => {
        describe('and 100 bits are sent', () => {
            it('should create gift notification with giftCount=1 and amount=100', async () => {
                const testUser = createTestUser({ username: 'BitsCheerer' });
                const bitsAmount = 100;

                await emitGift({
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
            }, TEST_TIMEOUTS.FAST);

            it('should result in correct goal calculation (100 bits total, not 10000)', async () => {
                const testUser = createTestUser({ username: 'BitsCheerer' });
                const bitsAmount = 100;
                
                await emitGift({
                    bits: bitsAmount,
                    username: testUser.username,
                    userId: testUser.userId,
                    id: 'cheer-evt-100-goal'
                });

                const notificationData = mockAppRuntime.handleGiftNotification.mock.calls[0][2];

                expect(notificationData.giftCount).toBe(1);
                expect(notificationData.amount).toBe(100);

                const simulatedGoalValue = notificationData.amount * notificationData.giftCount;
                expect(simulatedGoalValue).toBe(100);
            }, TEST_TIMEOUTS.FAST);
        });

        describe('and 50 bits are sent', () => {
            it('should create gift notification with giftCount=1 and amount=50', async () => {
                const testUser = createTestUser({ username: 'SmallBitsCheerer' });
                const bitsAmount = 50;
                
                await emitGift({
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

                const simulatedGoalValue = notificationData.amount * notificationData.giftCount;
                expect(simulatedGoalValue).toBe(50);
            }, TEST_TIMEOUTS.FAST);
        });

        describe('and 1000 bits are sent', () => {
            it('should create gift notification with giftCount=1 and amount=1000', async () => {
                const testUser = createTestUser({ username: 'BigBitsCheerer' });
                const bitsAmount = 1000;
                
                await emitGift({
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

                const simulatedGoalValue = notificationData.amount * notificationData.giftCount;
                expect(simulatedGoalValue).toBe(1000);
            }, TEST_TIMEOUTS.FAST);
        });
    });

    describe('edge cases', () => {
        it('should handle large bit amounts correctly', async () => {
            const testUser = createTestUser({ username: 'MassiveBits' });
            const largeBitsAmount = 10000;
            
            await emitGift({
                bits: largeBitsAmount,
                username: testUser.username,
                userId: testUser.userId,
                id: 'cheer-evt-large'
            });

            const notificationData = mockAppRuntime.handleGiftNotification.mock.calls[0][2];
            
            expect(notificationData.giftCount).toBe(1);
            expect(notificationData.amount).toBe(largeBitsAmount);

            const simulatedGoalValue = notificationData.amount * notificationData.giftCount;
            expect(simulatedGoalValue).toBe(largeBitsAmount);
        }, TEST_TIMEOUTS.FAST);
    });

    describe('regression validation', () => {
        it('should prevent inflated goal increments for 100-bit cheers', async () => {
            const testUser = createTestUser({ username: 'BugReporter' });
            const bitsAmount = 100;
            
            await emitGift({
                bits: bitsAmount,
                username: testUser.username,
                userId: testUser.userId,
                id: 'cheer-evt-regression'
            });

            const notificationData = mockAppRuntime.handleGiftNotification.mock.calls[0][2];
            
            expect(notificationData.giftCount).toBe(1);
            expect(notificationData.amount).toBe(100);

            const goalValue = notificationData.amount * notificationData.giftCount;
            expect(goalValue).toBe(100);
            expect(goalValue).not.toBe(10000);
            expect(goalValue).not.toBe(40010);
        }, TEST_TIMEOUTS.FAST);
    });
});
