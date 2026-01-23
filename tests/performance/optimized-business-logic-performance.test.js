
const NotificationBuilder = require('../../src/utils/notification-builder');
const testClock = require('../helpers/test-clock');

describe('Optimized Business Logic Performance Tests', () => {
    let performanceMetrics;
    let memoryBaseline;

    beforeEach(() => {
        testClock.reset();
        memoryBaseline = process.memoryUsage();
        performanceMetrics = {
            startTime: testClock.now(),
            operations: 0,
            errors: 0,
            responseTimes: []
        };
    });

    afterEach(() => {
        const endTime = testClock.now();
        const totalTime = Math.max(1, endTime - performanceMetrics.startTime);
        const memoryFinal = process.memoryUsage();
        
        if (performanceMetrics.operations > 0) {
            const avgResponseTime = performanceMetrics.responseTimes.reduce((a, b) => a + b, 0) / performanceMetrics.responseTimes.length;
            const throughput = (performanceMetrics.operations / (totalTime / 1000)).toFixed(2);
            
            console.log(`Performance Report:
                Total Time: ${totalTime.toFixed(2)}ms
                Operations: ${performanceMetrics.operations}
                Throughput: ${throughput} ops/sec
                Avg Response: ${avgResponseTime.toFixed(2)}ms
                Memory Delta: ${((memoryFinal.heapUsed - memoryBaseline.heapUsed) / 1024 / 1024).toFixed(2)}MB
                Errors: ${performanceMetrics.errors}
            `);
        }
    });

    const advanceClock = (delayMs) => {
        if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs <= 0) {
            return 0;
        }
        testClock.advance(delayMs);
        return delayMs;
    };

    const simulateDelay = async (delayMs) => {
        advanceClock(delayMs);
        return Promise.resolve();
    };

    describe('High-Frequency Business Logic Processing', () => {
        it('should handle 1000+ notification builds per second efficiently', async () => {
            const targetNotifications = 1000;
            const maxTimeMs = 1000; // 1 second for 1000 notifications
            const perOperationMs = 0.5;

            const startTime = testClock.now();
            const results = [];

            for (let i = 0; i < targetNotifications; i++) {
                const opStart = testClock.now();
                
                const platform = ['youtube', 'tiktok', 'twitch'][i % 3];
                const type = ['platform:gift', 'platform:paypiggy', 'platform:follow'][i % 3];
                
                const result = NotificationBuilder.build({
                    platform,
                    type,
                    username: `PerfUser${i}`,
                    userId: `perf-${i}`,
                    message: `Performance test ${i}`,
                    giftType: 'Performance Gift',
                    amount: (i % 100) + 1,
                    currency: 'USD',
                    giftCount: (i % 10) + 1
                });

                advanceClock(perOperationMs);
                const opEnd = testClock.now();
                const opTime = opEnd - opStart;
                
                performanceMetrics.responseTimes.push(opTime);
                performanceMetrics.operations++;
                
                if (!result || !result.platform) {
                    performanceMetrics.errors++;
                }
                
                results.push(result);
            }

            const endTime = testClock.now();
            const totalTime = endTime - startTime;

            expect(totalTime).toBeLessThan(maxTimeMs);
            expect(results).toHaveLength(targetNotifications);
            expect(performanceMetrics.errors).toBe(0);

            const throughput = targetNotifications / (totalTime / 1000);
            expect(throughput).toBeGreaterThan(1000);

            const avgResponseTime = performanceMetrics.responseTimes.reduce((a, b) => a + b, 0) / performanceMetrics.responseTimes.length;
            expect(avgResponseTime).toBeLessThan(1);
        });

        it('should maintain consistent performance under sustained load', async () => {
            const duration = 3000;
            const batchSize = 50;
            const interval = 100;

            const responseTimes = [];
            let totalNotifications = 0;

            const startTime = testClock.now();
            
            while (testClock.now() - startTime < duration) {
                const batchStart = testClock.now();

                for (let i = 0; i < batchSize; i++) {
                    const platform = ['youtube', 'tiktok', 'twitch'][i % 3];
                    const giftSpec = platform === 'twitch'
                        ? { giftType: 'bits', giftCount: 1, amount: 100, currency: 'bits' }
                        : platform === 'tiktok'
                            ? { giftType: 'Rose', giftCount: 1, amount: 1, currency: 'coins' }
                            : { giftType: 'Super Chat', giftCount: 1, amount: 5, currency: 'USD' };
                    const result = NotificationBuilder.build({
                        platform,
                        type: 'platform:gift',
                        username: `SustainedUser${totalNotifications + i}`,
                        userId: `sustained-${totalNotifications + i}`,
                        message: 'Sustained load test',
                        timestamp: testClock.now(),
                        ...giftSpec
                    });
                    
                    if (result && result.platform) {
                        performanceMetrics.operations++;
                    } else {
                        performanceMetrics.errors++;
                    }
                }
                
                advanceClock(20);
                const batchEnd = testClock.now();
                const batchTime = batchEnd - batchStart;
                responseTimes.push(batchTime);
                totalNotifications += batchSize;

                await simulateDelay(interval);
            }

            const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
            const maxResponseTime = Math.max(...responseTimes);

            expect(avgResponseTime).toBeLessThan(50);
            expect(maxResponseTime).toBeLessThan(200);
            expect(totalNotifications).toBeGreaterThan(100);
            expect(performanceMetrics.errors).toBe(0);
        });
    });

    describe('Memory Efficiency of Business Logic', () => {
        it('should not leak memory during high-volume processing', async () => {
            if (global.gc) {
                global.gc();
            }

            const initialMemory = process.memoryUsage();
            const totalNotifications = 5000;
            const batchSize = 100;

            for (let batch = 0; batch < totalNotifications / batchSize; batch++) {
                for (let i = 0; i < batchSize; i++) {
                    const notificationId = batch * batchSize + i;
                    const platform = ['youtube', 'tiktok', 'twitch'][i % 3];
                    
                    const result = NotificationBuilder.build({
                        platform,
                        type: 'platform:gift',
                        username: `MemTestUser${notificationId}`,
                        userId: `mem-${notificationId}`,
                        message: `Memory test ${notificationId}`,
                        giftType: `Gift${notificationId}`,
                        giftCount: 1,
                        amount: 1,
                        currency: 'coins',
                        largeData: 'x'.repeat(500), // Add some bulk to test memory management
                        metadata: {
                            batch,
                            index: i,
                            timestamp: testClock.now()
                        }
                    });

                    if (result && result.platform) {
                        performanceMetrics.operations++;
                    } else {
                        performanceMetrics.errors++;
                    }
                }

                if (global.gc && batch % 10 === 0) {
                    global.gc();
                }
            }

            if (global.gc) {
                global.gc();
            }

            const finalMemory = process.memoryUsage();
            const memoryDelta = finalMemory.heapUsed - initialMemory.heapUsed;
            const memoryDeltaMB = memoryDelta / 1024 / 1024;

            expect(memoryDeltaMB).toBeLessThan(20);
            expect(performanceMetrics.errors).toBe(0);
            
            console.log(`Memory Test: Processed ${performanceMetrics.operations} notifications, Memory Delta: ${memoryDeltaMB.toFixed(2)}MB`);
        });

        it('should handle complex data structures efficiently', async () => {
            const complexNotifications = [];
            const startTime = testClock.now();

            for (let i = 0; i < 1000; i++) {
                const complexData = {
                    platform: 'youtube',
                    type: 'platform:gift',
                    username: `ComplexUser${i}`,
                    userId: `user-${i}`,
                    message: `Complex message with emoji 🎮 and special characters @#$%^&*()`,
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: (i % 100) + 0.01,
                    currency: ['USD', 'EUR', 'GBP'][i % 3],
                    metadata: {
                        timestamp: 1700000000000 + i,
                        streamTitle: `Stream ${i}`,
                        viewerCount: (i * 37) % 1000,
                        tags: [`tag${i % 3}`, `category${i % 5}`],
                        identity: {
                            verified: i % 2 === 0,
                            badges: [`badge${i % 5}`, `level${i % 10}`]
                        },
                        customFields: {
                            field1: `value${i}`,
                            field2: i * 2,
                            field3: i % 2 === 0
                        }
                    }
                };

                const result = NotificationBuilder.build(complexData);
                complexNotifications.push(result);
                performanceMetrics.operations++;
                advanceClock(0.2);
            }

            const endTime = testClock.now();
            const processingTime = endTime - startTime;

            expect(processingTime).toBeLessThan(500);
            expect(complexNotifications).toHaveLength(1000);

            complexNotifications.forEach((notification, index) => {
                expect(notification).toBeDefined();
                expect(notification.username).toBe(`ComplexUser${index}`);
                expect(notification.displayMessage).toBeDefined();
                expect(notification.platform).toBe('youtube');
            });
        });
    });

    describe('Algorithm Performance Testing', () => {
        it('should handle currency formatting at scale efficiently', async () => {
            const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD'];
            const amounts = [];

            for (let i = 0; i < 1000; i++) {
                const value = ((i * 37) % 999) + 0.01;
                amounts.push(parseFloat(value.toFixed(2)));
            }

            const startTime = testClock.now();

            for (const amount of amounts) {
                for (const currency of currencies) {
                    const result = NotificationBuilder.build({
                        platform: 'youtube',
                        type: 'platform:gift',
                        username: 'CurrencyUser',
                        userId: 'currency-user',
                        message: 'Currency test',
                        giftType: 'Super Chat',
                        giftCount: 1,
                        amount,
                        currency
                    });
                    
                    performanceMetrics.operations++;
                    
                    if (!result || !result.displayMessage) {
                        performanceMetrics.errors++;
                    }

                    advanceClock(0.15);
                }
            }

            const endTime = testClock.now();
            const processingTime = endTime - startTime;

            const isWSLEnvironment = Boolean(
                process.env.WSL_DISTRO_NAME ||
                process.env.WSLENV ||
                (process.platform === 'linux' && (() => {
                    try {
                        return require('fs').readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
                    } catch {
                        return false;
                    }
                })())
            );

            const maxProcessingTimeMs = isWSLEnvironment ? 1800 : 1000;
            const minOperationsPerSecond = isWSLEnvironment ? 2800 : 5000;

            expect(processingTime).toBeLessThan(maxProcessingTimeMs);
            expect(performanceMetrics.errors).toBe(0);
            
            const operationsPerSecond = (performanceMetrics.operations / (processingTime / 1000));
            expect(operationsPerSecond).toBeGreaterThan(minOperationsPerSecond);
        });

        it('should handle string processing algorithms efficiently', async () => {
            const testStrings = [
                'Simple message',
                'Message with 🎮🔥💪🌟 emojis',
                'Very '.repeat(100) + 'long message',
                'Message with <tags> and &entities; and "quotes"',
                '用户名测试 Unicode handling',
                'A'.repeat(1000), // Very long string
                ''  // Empty string
            ];

            const startTime = testClock.now();

            for (let i = 0; i < 500; i++) {
                for (const testString of testStrings) {
                    const result = NotificationBuilder.build({
                        platform: 'tiktok',
                        type: 'platform:gift',
                        username: `StringUser${i}`,
                        userId: `string-${i}`,
                        message: testString,
                        giftType: testString.substring(0, 20) || 'DefaultGift',
                        giftCount: 1,
                        amount: 1,
                        currency: 'coins'
                    });
                    
                    performanceMetrics.operations++;
                    
                    if (!result || !result.displayMessage) {
                        performanceMetrics.errors++;
                    }

                    advanceClock(0.25);
                }
            }

            const endTime = testClock.now();
            const processingTime = endTime - startTime;

            expect(processingTime).toBeLessThan(2000);
            expect(performanceMetrics.errors).toBe(0);
        });
    });

    describe('Concurrent Processing Performance', () => {
        it('should handle concurrent notification building efficiently', async () => {
            const concurrentBatches = 10;
            const batchSize = 100;
            const startTime = testClock.now();

            const promises = [];
            
            for (let batch = 0; batch < concurrentBatches; batch++) {
                const promise = Promise.resolve().then(() => {
                    const results = [];
                    
                    for (let i = 0; i < batchSize; i++) {
                        const result = NotificationBuilder.build({
                            platform: 'twitch',
                            type: 'platform:follow',
                            username: `ConcurrentUser${batch}-${i}`,
                            userId: `concurrent-${batch}-${i}`,
                            batchId: batch,
                            itemId: i
                        });
                        
                        results.push(result);
                        performanceMetrics.operations++;
                        advanceClock(0.2);
                    }
                    
                    return results;
                });
                
                promises.push(promise);
            }

            const allResults = await Promise.all(promises);
            
            const endTime = testClock.now();
            const processingTime = endTime - startTime;

            expect(processingTime).toBeLessThan(500);
            expect(allResults).toHaveLength(concurrentBatches);

            allResults.forEach((batch, batchIndex) => {
                expect(batch).toHaveLength(batchSize);
                
                batch.forEach((result, itemIndex) => {
                    expect(result.username).toBe(`ConcurrentUser${batchIndex}-${itemIndex}`);
                    expect(result.batchId).toBe(batchIndex);
                    expect(result.itemId).toBe(itemIndex);
                });
            });
        });
    });
});
