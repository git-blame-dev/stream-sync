const { describe, expect, it, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { withTimeout } = require('../../../src/utils/timeout-wrapper.ts');
const { expectNoTechnicalArtifacts } = require('../../helpers/assertion-helpers');

export {};

const fail = (message: string) => {
    throw new Error(message);
};

describe('Timeout Wrapper Utility - User Experience', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    describe('Operation Completion Within Timeout', () => {
        it('should allow successful operations to complete normally', async () => {
            const quickOperation = Promise.resolve('Operation completed successfully');

            const result = await withTimeout(quickOperation, 1000, 'test operation');

            expect(result).toBe('Operation completed successfully');
        });

        it('should preserve operation results without modification', async () => {
            const complexData = {
                streamData: { title: 'Live Stream', viewers: 150 },
                userExperience: 'excellent'
            };
            const operation = Promise.resolve(complexData);

            const result = await withTimeout(operation, 500, 'data operation');

            expect(result).toEqual(complexData);
            expect(result.streamData.title).toBe('Live Stream');
            expect(result.streamData.viewers).toBe(150);
        });
    });

    describe('Fast Failure for Hanging Operations', () => {
        it('should provide immediate error recovery when operations hang', async () => {
            const hangingOperation = new Promise<never>(() => {});

            try {
                await withTimeout(hangingOperation, 100, 'YouTube search');
                fail('Expected timeout error');
            } catch (error: unknown) {
                const timeoutError = error as Error;
                expect(timeoutError.message).toContain('YouTube search timeout after 100ms');
                expect(timeoutError.message).toContain('timeout');
                expectNoTechnicalArtifacts(timeoutError.message);
                expect(error).toBeInstanceOf(Error);
                expect(timeoutError.name).toBe('Error');
            }
        });

        it('should provide clear context for different operation types', async () => {
            const hangingOperations = [
                { promise: new Promise<never>(() => {}), name: 'YouTube API connection', expectedContext: 'YouTube API connection' },
                { promise: new Promise<never>(() => {}), name: 'stream detection', expectedContext: 'stream detection' },
                { promise: new Promise<never>(() => {}), name: 'viewer count fetch', expectedContext: 'viewer count fetch' }
            ];

            for (const operation of hangingOperations) {
                try {
                    await withTimeout(operation.promise, 50, operation.name);
                    fail(`Expected timeout for ${operation.name}`);
                } catch (error: unknown) {
                    const timeoutError = error as Error;
                    expect(timeoutError.message).toContain(operation.expectedContext);
                    expect(timeoutError.message).toContain('timeout');
                    expectNoTechnicalArtifacts(timeoutError.message);
                }
            }
        });
    });

    describe('User Experience Quality Standards', () => {
        it('should ensure error messages contain no technical implementation details', async () => {
            const testCases = [
                { operation: new Promise<never>(() => {}), name: 'user stream search', timeout: 50 },
                { operation: new Promise<never>(() => {}), name: 'viewer statistics refresh', timeout: 75 },
                { operation: new Promise<never>(() => {}), name: 'notification delivery', timeout: 25 }
            ];

            for (const testCase of testCases) {
                try {
                    await withTimeout(testCase.operation, testCase.timeout, testCase.name);
                    fail(`Expected timeout for ${testCase.name}`);
                } catch (error: unknown) {
                    const timeoutError = error as Error;
                    expectNoTechnicalArtifacts(timeoutError.message);
                    expect(timeoutError.message).not.toContain('Promise');
                    expect(timeoutError.message).not.toContain('reject');
                    expect(timeoutError.message).not.toContain('resolve');
                    expect(timeoutError.message).not.toContain('setTimeout');
                    expect(timeoutError.message).toContain(testCase.name);
                    expect(timeoutError.message).toContain('timeout');
                }
            }
        });
    });

    describe('Performance and Resource Management', () => {
        it('should preserve data integrity across multiple timeout operations', async () => {
            const results: string[] = [];

            for (let i = 0; i < 10; i++) {
                const quickOperation = Promise.resolve(`result-${i}`);
                const result = await withTimeout(quickOperation, 1000, `test-${i}`);
                results.push(result);
            }

            expect(results).toHaveLength(10);
            results.forEach((result, index) => {
                expect(result).toBe(`result-${index}`);
                expect(typeof result).toBe('string');
                expectNoTechnicalArtifacts(result);
            });

            const expectedSequence = Array.from({ length: 10 }, (_, i) => `result-${i}`);
            expect(results).toEqual(expectedSequence);
        });

        it('should handle multiple simultaneous timeout failures gracefully', async () => {
            const timeoutOperations = Array.from({ length: 5 }, (_, i) =>
                withTimeout(new Promise<never>(() => {}), 25, `cleanup-test-${i}`)
            );

            const results = await Promise.allSettled(timeoutOperations);

            expect(results).toHaveLength(5);
            results.forEach((result, index) => {
                expect(result.status).toBe('rejected');
                if (result.status === 'rejected') {
                    const message = (result.reason as Error).message;
                    expect(message).toContain('timeout');
                    expect(message).toContain(`cleanup-test-${index}`);
                    expectNoTechnicalArtifacts(message);
                }
            });

            const errorMessages = results
                .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
                .map((result) => (result.reason as Error).message);
            const uniqueMessages = new Set(errorMessages);
            expect(uniqueMessages.size).toBe(5);
        });
    });
});
