
const { describe, test, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { withTimeout, withTimeoutAll, createTimeoutWrapper, createTimeoutPromise, createTimeoutController } = require('../../../src/utils/timeout-wrapper');
const { expectNoTechnicalArtifacts } = require('../../helpers/assertion-helpers');
const { waitForDelay } = require('../../helpers/time-utils');

const fail = (message) => {
    throw new Error(message);
};

describe('Timeout Wrapper Utility - User Experience', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    describe('Operation Completion Within Timeout', () => {
        it('should allow successful operations to complete normally', async () => {
            // Given: A quick operation that completes within timeout
            const quickOperation = Promise.resolve('Operation completed successfully');
            
            // When: Wrapping with timeout protection
            const result = await withTimeout(quickOperation, 1000, 'test operation');
            
            // Then: User receives successful result
            expect(result).toBe('Operation completed successfully');
        });

        it('should preserve operation results without modification', async () => {
            // Given: Operation returning complex data
            const complexData = { 
                streamData: { title: 'Live Stream', viewers: 150 },
                userExperience: 'excellent'
            };
            const operation = Promise.resolve(complexData);
            
            // When: Processing through timeout wrapper
            const result = await withTimeout(operation, 500, 'data operation');
            
            // Then: User receives complete, unmodified data
            expect(result).toEqual(complexData);
            expect(result.streamData.title).toBe('Live Stream');
            expect(result.streamData.viewers).toBe(150);
        });
    });

    describe('Fast Failure for Hanging Operations', () => {
        it('should provide immediate error recovery when operations hang', async () => {
            // Given: An operation that would hang indefinitely
            const hangingOperation = new Promise(() => {}); // Never resolves
            
            // When: User attempts operation with timeout protection
            try {
                await withTimeout(hangingOperation, 100, 'YouTube search');
                fail('Expected timeout error');
            } catch (error) {
                // Then: User receives immediate, actionable error feedback
                expect(error.message).toContain('YouTube search timeout after 100ms');
                expect(error.message).toContain('timeout');
                expectNoTechnicalArtifacts(error.message);
                
                // And: Error provides clear context for user understanding
                expect(error).toBeInstanceOf(Error);
                expect(error.name).toBe('Error');
            }
        });

        it('should provide clear context for different operation types', async () => {
            // Given: Different types of operations that hang
            const hangingOperations = [
                { promise: new Promise(() => {}), name: 'YouTube API connection', expectedContext: 'YouTube API connection' },
                { promise: new Promise(() => {}), name: 'stream detection', expectedContext: 'stream detection' },
                { promise: new Promise(() => {}), name: 'viewer count fetch', expectedContext: 'viewer count fetch' }
            ];
            
            for (const operation of hangingOperations) {
                // When: Operation times out
                try {
                    await withTimeout(operation.promise, 50, operation.name);
                    fail(`Expected timeout for ${operation.name}`);
                } catch (error) {
                    // Then: User receives specific, helpful error message
                    expect(error.message).toContain(operation.expectedContext);
                    expect(error.message).toContain('timeout');
                    expectNoTechnicalArtifacts(error.message);
                }
            }
        });
    });

    describe('Batch Operation Timeout Protection', () => {
        it('should handle multiple successful operations with all results preserved', async () => {
            // Given: Multiple quick operations
            const operations = [
                Promise.resolve('Stream 1 data'),
                Promise.resolve('Stream 2 data'),
                Promise.resolve('Stream 3 data')
            ];
            
            // When: Processing batch operations
            const results = await withTimeoutAll(operations, 500, 'multi-stream detection');
            
            // Then: User receives all results completely and accurately
            expect(results).toHaveLength(3);
            expect(results[0]).toBe('Stream 1 data');
            expect(results[1]).toBe('Stream 2 data');
            expect(results[2]).toBe('Stream 3 data');
            
            // And: All results are valid, user-ready data
            results.forEach(result => {
                expect(typeof result).toBe('string');
                expect(result.length).toBeGreaterThan(0);
                expectNoTechnicalArtifacts(result);
            });
        });

        it('should provide clear error recovery when any batch operation hangs', async () => {
            // Given: Mixed operations - some succeed, one hangs
            const operations = [
                Promise.resolve('Quick result'),
                new Promise(() => {}), // Hangs
                Promise.resolve('Another quick result')
            ];
            
            // When: User attempts batch operation
            try {
                await withTimeoutAll(operations, 100, 'YouTube batch search');
                fail('Expected batch timeout');
            } catch (error) {
                // Then: User receives clear batch failure information
                expect(error.message).toContain('YouTube batch search');
                expect(error.message).toContain('timeout');
                expectNoTechnicalArtifacts(error.message);
                
                // And: Error indicates which operation in batch failed
                expect(error.message).toMatch(/\[1\]/); // Index of hanging operation
                expect(error).toBeInstanceOf(Error);
            }
        });
    });

    describe('Service-Specific Timeout Wrappers', () => {
        it('should create specialized wrappers with appropriate defaults', async () => {
            // Given: YouTube-specific timeout wrapper
            const youtubeTimeout = createTimeoutWrapper(2000, 'YouTube API');
            const quickOperation = Promise.resolve('YouTube data loaded');
            
            // When: Using service-specific wrapper
            const result = await youtubeTimeout(quickOperation, 'stream search');
            
            // Then: User receives expected YouTube service response
            expect(result).toBe('YouTube data loaded');
        });

        it('should provide service-specific error messages when timing out', async () => {
            // Given: TikTok-specific timeout wrapper
            const tiktokTimeout = createTimeoutWrapper(50, 'TikTok Live');
            const hangingOperation = new Promise(() => {});
            
            // When: TikTok operation times out
            try {
                await tiktokTimeout(hangingOperation, 'live stream connection');
                fail('Expected TikTok timeout');
            } catch (error) {
                // Then: User receives TikTok-specific error context
                expect(error.message).toContain('TikTok Live live stream connection');
                expect(error.message).toContain('timeout after 50ms');
                expectNoTechnicalArtifacts(error.message);
            }
        });

        it('should allow custom timeout overrides for specific operations', async () => {
            // Given: Service wrapper with default timeout
            const serviceTimeout = createTimeoutWrapper(1000, 'API Service');
            const hangingOperation = new Promise(() => {});
            
            // When: Using custom timeout for specific operation
            try {
                await serviceTimeout(hangingOperation, 'critical operation', 100);
                fail('Expected custom timeout');
            } catch (error) {
                // Then: User receives service-specific timeout error with custom timing
                expect(error.message).toContain('API Service critical operation');
                expect(error.message).toContain('timeout after 100ms');
                expectNoTechnicalArtifacts(error.message);
                
                // And: Error maintains consistent service context
                expect(error.message).toMatch(/^API Service/);
                expect(error).toBeInstanceOf(Error);
            }
        });
    });

    describe('Timeout Controller Integration', () => {
        it('should clear scheduled timeout when protected operations resolve early', async () => {
            const controller = createTimeoutController(25, { operationName: 'instant operation' });
            const timeoutSpy = createMockFn();
            controller.timeoutPromise.catch(timeoutSpy);
            await expect(controller.wrap(Promise.resolve('ready'))).resolves.toBe('ready');
            await waitForDelay(50);
            expect(timeoutSpy).not.toHaveBeenCalled();
        });

        it('should allow custom timeout messaging via options object', async () => {
            const hangingOperation = new Promise(() => {});
            try {
                await withTimeout(hangingOperation, 25, { errorMessage: 'Custom timeout failure' });
                fail('Expected timeout');
            } catch (error) {
                expect(error.message).toBe('Custom timeout failure');
                expectNoTechnicalArtifacts(error.message);
            }
        });
    });

    describe('User Experience Quality Standards', () => {
        it('should ensure error messages contain no technical implementation details', async () => {
            // Given: Various timeout scenarios
            const testCases = [
                { operation: new Promise(() => {}), name: 'user stream search', timeout: 50 },
                { operation: new Promise(() => {}), name: 'viewer statistics refresh', timeout: 75 },
                { operation: new Promise(() => {}), name: 'notification delivery', timeout: 25 }
            ];
            
            for (const testCase of testCases) {
                // When: Operation times out
                try {
                    await withTimeout(testCase.operation, testCase.timeout, testCase.name);
                    fail(`Expected timeout for ${testCase.name}`);
                } catch (error) {
                    // Then: Error message is user-friendly
                    expectNoTechnicalArtifacts(error.message);
                    expect(error.message).not.toContain('Promise');
                    expect(error.message).not.toContain('reject');
                    expect(error.message).not.toContain('resolve');
                    expect(error.message).not.toContain('setTimeout');
                    expect(error.message).toContain(testCase.name);
                    expect(error.message).toContain('timeout');
                }
            }
        });

        it('should maintain consistent timeout behavior across all wrapper types', async () => {
            // Given: Different wrapper configurations
            const wrappers = [
                { name: 'basic', wrapper: (op) => withTimeout(op, 50, 'basic operation') },
                { name: 'service', wrapper: createTimeoutWrapper(50, 'Test Service') },
                { name: 'custom', wrapper: (op) => Promise.race([op, createTimeoutPromise(50, 'Custom timeout')]) }
            ];
            
            for (const wrapperConfig of wrappers) {
                const hangingOperation = new Promise(() => {});
                
                // When: Using different wrapper types
                try {
                    await wrapperConfig.wrapper(hangingOperation);
                    fail(`Expected timeout for ${wrapperConfig.name} wrapper`);
                } catch (error) {
                    // Then: All wrappers provide consistent error recovery behavior
                    expect(error.message).toContain('timeout');
                    expect(error).toBeInstanceOf(Error);
                    expectNoTechnicalArtifacts(error.message);
                }
            }
        });
    });

    describe('Performance and Resource Management', () => {
        it('should preserve data integrity across multiple timeout operations', async () => {
            // Given: Multiple sequential operations
            const results = [];
            
            // When: Running multiple timeout scenarios
            for (let i = 0; i < 10; i++) {
                const quickOperation = Promise.resolve(`result-${i}`);
                const result = await withTimeout(quickOperation, 1000, `test-${i}`);
                results.push(result);
            }
            
            // Then: All operations preserve data integrity and user expectations
            expect(results).toHaveLength(10);
            results.forEach((result, index) => {
                expect(result).toBe(`result-${index}`);
                expect(typeof result).toBe('string');
                expectNoTechnicalArtifacts(result);
            });
            
            // And: Results maintain sequential order for user predictability
            const expectedSequence = Array.from({ length: 10 }, (_, i) => `result-${i}`);
            expect(results).toEqual(expectedSequence);
        });

        it('should handle multiple simultaneous timeout failures gracefully', async () => {
            // Given: Operations that will timeout
            const timeoutOperations = Array(5).fill().map((_, i) => 
                withTimeout(new Promise(() => {}), 25, `cleanup-test-${i}`)
            );
            
            // When: Multiple operations timeout simultaneously
            const results = await Promise.allSettled(timeoutOperations);
            
            // Then: All operations fail gracefully with proper error context
            expect(results).toHaveLength(5);
            results.forEach((result, index) => {
                expect(result.status).toBe('rejected');
                expect(result.reason.message).toContain('timeout');
                expect(result.reason.message).toContain(`cleanup-test-${index}`);
                expectNoTechnicalArtifacts(result.reason.message);
            });
            
            // And: Each error provides specific operation context for user debugging
            const errorMessages = results.map(r => r.reason.message);
            const uniqueMessages = new Set(errorMessages);
            expect(uniqueMessages.size).toBe(5); // Each operation has unique error message
        });
    });
});
