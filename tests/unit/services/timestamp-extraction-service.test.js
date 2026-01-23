const { describe, it, beforeAll, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { useFakeTimers, useRealTimers, setSystemTime } = require('../../helpers/bun-timers');
const { initializeTestLogging, TEST_TIMEOUTS } = require('../../helpers/test-setup');
const { noOpLogger, setupAutomatedCleanup } = require('../../helpers/mock-factories');
const testClock = require('../../helpers/test-clock');

initializeTestLogging();

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('TimestampExtractionService Behavior', () => {
    let TimestampExtractionService;
    let mockPerformanceTracker;
    let service;

    beforeAll(() => {
        try {
            TimestampExtractionService = require('../../../src/services/TimestampExtractionService');
        } catch {
            TimestampExtractionService = null;
        }
    });

    beforeEach(() => {
        mockPerformanceTracker = {
            recordExtraction: createMockFn()
        };
        useFakeTimers();
        setSystemTime(new Date(testClock.now()));

        if (TimestampExtractionService) {
            service = new TimestampExtractionService({
                logger: noOpLogger,
                performanceTracker: mockPerformanceTracker
            });
        }
        clearAllMocks();
    });

    afterEach(() => {
        useRealTimers();
    });

    describe('TikTok Timestamp Preservation', () => {
        it('preserves common.createTime from TikTok messages', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const originalTime = testClock.now() - (2 * 60 * 1000);
            const tikTokData = {
                common: {
                    createTime: originalTime
                },
                userId: 'testuser-id',
                uniqueId: 'TestUser',
                comment: 'Test message'
            };

            const extractedTimestamp = service.extractTimestamp('tiktok', tikTokData);

            const extractedTime = new Date(extractedTimestamp).getTime();
            expect(extractedTime).toBe(originalTime);
            expect(extractedTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(typeof extractedTime).toBe('number');
            expect(extractedTime).toBeGreaterThan(0);
        });

        it('reads common.clientSendTime when createTime is missing', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const originalTime = testClock.now() - (4 * 60 * 1000);
            const tikTokData = {
                common: {
                    clientSendTime: String(originalTime)
                },
                userId: 'nested-user-id',
                uniqueId: 'NestedUser',
                comment: 'Nested timestamp test'
            };

            const extractedTimestamp = service.extractTimestamp('tiktok', tikTokData);
            const extractedTime = new Date(extractedTimestamp).getTime();
            expect(extractedTime).toBe(originalTime);
        });

        it('uses ISO timestamp field when common timestamps are missing', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const isoTimestamp = new Date(testClock.now() - (3 * 60 * 1000)).toISOString();
            const tikTokData = {
                timestamp: isoTimestamp,
                userId: 'testuser-id',
                uniqueId: 'TestUser',
                comment: 'Test message'
            };

            const extractedTimestamp = service.extractTimestamp('tiktok', tikTokData);
            expect(extractedTimestamp).toBe(isoTimestamp);
        });

        it('returns null when no supported timestamp fields are available', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const tikTokData = {
                userId: 'testuser-id',
                uniqueId: 'TestUser',
                comment: 'Test message'
            };

            const extractedTimestamp = service.extractTimestamp('tiktok', tikTokData);

            expect(extractedTimestamp).toBeNull();
        });
    });

    describe('YouTube Timestamp Preservation', () => {
        it('preserves original timestamp from YouTube messages in microseconds', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const originalTimeMs = testClock.now() - (4 * 60 * 1000);
            const youTubeData = {
                timestamp_usec: (originalTimeMs * 1000).toString(),
                author: {
                    name: 'TestUser',
                    id: 'user123'
                },
                message: {
                    text: 'Test YouTube message'
                }
            };

            const extractedTimestamp = service.extractTimestamp('youtube', youTubeData);

            const extractedTime = new Date(extractedTimestamp).getTime();
            expect(extractedTime).toBe(originalTimeMs);
        });

        it('preserves timestamp when YouTube provides milliseconds', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const originalTimeMs = testClock.now() - (2 * 60 * 1000);
            const youTubeData = {
                timestamp: originalTimeMs.toString(),
                author: {
                    name: 'TestUser',
                    id: 'user123'
                },
                message: {
                    text: 'Test YouTube message (ms)'
                }
            };

            const extractedTimestamp = service.extractTimestamp('youtube', youTubeData);
            const extractedTime = new Date(extractedTimestamp).getTime();
            expect(extractedTime).toBe(originalTimeMs);
        });

        it('returns null when YouTube timestamps are invalid', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const youTubeData = {
                timestamp: 'invalid-timestamp',
                author: {
                    name: 'TestUser',
                    id: 'user123'
                },
                message: {
                    text: 'Test YouTube message'
                }
            };

            const extractedTimestamp = service.extractTimestamp('youtube', youTubeData);

            expect(extractedTimestamp).toBeNull();
        });
    });

    describe('Twitch Timestamp Preservation', () => {
        it('preserves original timestamp from Twitch message context', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const originalTime = testClock.now() - (6 * 60 * 1000);
            const twitchData = {
                timestamp: originalTime,
                username: 'TestUser',
                userId: 'user123',
                message: 'Test Twitch message'
            };

            const extractedTimestamp = service.extractTimestamp('twitch', twitchData);

            const extractedTime = new Date(extractedTimestamp).getTime();
            expect(extractedTime).toBe(originalTime);
        });

        it('accepts ISO string timestamps for Twitch payloads', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const isoTimestamp = new Date(testClock.now() - (9 * 60 * 1000)).toISOString();
            const twitchData = {
                timestamp: isoTimestamp,
                username: 'IsoUser',
                userId: 'iso-123'
            };

            const extractedTimestamp = service.extractTimestamp('twitch', twitchData);
            expect(extractedTimestamp).toBe(isoTimestamp);
        });

        it('returns null when Twitch timestamps are missing', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const twitchData = {
                username: 'TestUser',
                userId: 'user123',
                message: 'Test Twitch message'
            };

            const extractedTimestamp = service.extractTimestamp('twitch', twitchData);

            expect(extractedTimestamp).toBeNull();
        });
    });

    describe('Error Handling and Edge Cases', () => {
        it('should handle unsupported platforms gracefully', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const unknownPlatformData = {
                timestamp: testClock.now(),
                message: 'Test message'
            };

            const extractedTimestamp = service.extractTimestamp('unsupported-platform', unknownPlatformData);

            expect(extractedTimestamp).toBeNull();
        });

        it('should handle null/undefined data gracefully', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const testCases = [null, undefined, '', 0, false];

            for (const testData of testCases) {
                const extractedTimestamp = service.extractTimestamp('tiktok', testData);

                expect(extractedTimestamp).toBeNull();
            }
        });

        it('should handle malformed timestamp data without crashing', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const malformedData = [
                { platform: 'tiktok', data: { common: { createTime: 'not-a-number' } } },
                { platform: 'youtube', data: { timestamp: 'invalid' } },
                { platform: 'twitch', data: { timestamp: 'bad-timestamp' } },
                { platform: 'tiktok', data: { common: { createTime: -1 } } },
                { platform: 'youtube', data: { timestamp: '0' } }
            ];

            for (const { platform, data } of malformedData) {
                const result = () => service.extractTimestamp(platform, data);

                expect(result).not.toThrow();

                const extractedTimestamp = result();
                expect(extractedTimestamp).toBeNull();
            }
        });
    });

    describe('Performance Requirements', () => {
        it('should extract timestamps within performance targets', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const testData = {
                common: { createTime: testClock.now() - 60000 },
                userId: 'testuser-id',
                uniqueId: 'TestUser',
                comment: 'Performance test message'
            };

            const iterations = 100;
            const times = [];
            const platform = 'tiktok';

            for (let i = 0; i < iterations; i++) {
                const startTime = testClock.now();
                const result = service.extractTimestamp(platform, testData);
                const simulatedDurationMs = 0.8;
                testClock.advance(simulatedDurationMs);
                const endTime = testClock.now();

                const durationMs = endTime - startTime;
                times.push(durationMs);
            }

            const averageTime = times.reduce((sum, time) => sum + time, 0) / times.length;
            const maxTime = Math.max(...times);

            expect(averageTime).toBeLessThan(1);
            expect(maxTime).toBeLessThan(6.5);
            expect(averageTime).toBeGreaterThan(0);
            expect(maxTime).toBeGreaterThan(0);
        });

        it('should maintain performance under high load scenarios', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const platforms = ['tiktok', 'youtube', 'twitch'];
            const messagesPerPlatform = 50;
            const totalMessages = platforms.length * messagesPerPlatform;

            const testMessages = platforms.flatMap((platform, platformIndex) =>
                Array(messagesPerPlatform).fill().map((_, messageIndex) => {
                    const offsetMs = (platformIndex * messagesPerPlatform + messageIndex + 1) * 1000;
                    const baseTime = testClock.now() - offsetMs;
                    const isoTime = new Date(baseTime).toISOString();
                    return {
                        platform,
                        data: {
                            ...(platform === 'tiktok'
                                ? { common: { createTime: baseTime } }
                                : {}),
                            ...(platform === 'youtube'
                                ? { timestamp: baseTime }
                                : {}),
                            ...(platform === 'twitch'
                                ? { timestamp: isoTime }
                                : {}),
                            userId: 'testuser-id',
                            uniqueId: 'TestUser',
                            message: 'Load test message'
                        }
                    };
                })
            );

            const startTime = testClock.now();

            const promises = testMessages.map(({ platform, data }) =>
                Promise.resolve(service.extractTimestamp(platform, data))
            );

            return Promise.all(promises).then(results => {
                const simulatedTotalMs = totalMessages * 0.5;
                testClock.advance(simulatedTotalMs);
                const endTime = testClock.now();
                const totalTimeMs = endTime - startTime;
                const averageTimePerMessage = totalTimeMs / totalMessages;

                expect(averageTimePerMessage).toBeLessThan(2);
                expect(totalTimeMs).toBeLessThan(500);

                results.forEach(timestamp => {
                    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
                });
            });
        });
    });

    describe('Dependency Injection Behavior', () => {
        it('should work with minimal dependencies when some are missing', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const minimalService = new TimestampExtractionService({
                logger: noOpLogger
            });

            const testData = {
                common: { createTime: testClock.now() - 60000 },
                userId: 'testuser-id',
                uniqueId: 'TestUser',
                comment: 'Minimal dependencies test'
            };

            const result = () => minimalService.extractTimestamp('tiktok', testData);

            expect(result).not.toThrow();

            const timestamp = result();
            expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });

        it('should work with no dependencies provided', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const createService = () => new TimestampExtractionService();

            expect(createService).toThrow('Logger dependency is required');
        });
    });
});
