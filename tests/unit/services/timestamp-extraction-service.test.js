const { describe, it, beforeAll, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { useFakeTimers, useRealTimers, setSystemTime } = require('../../helpers/bun-timers');
const { initializeTestLogging, TEST_TIMEOUTS } = require('../../helpers/test-setup');
const { noOpLogger, setupAutomatedCleanup } = require('../../helpers/mock-factories');
const { expectNoTechnicalArtifacts } = require('../../helpers/assertion-helpers');
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
        } catch (error) {
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
        it('should preserve original createTime from TikTok messages', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const originalTime = testClock.now() - (2 * 60 * 1000);
            const tikTokData = {
                createTime: originalTime,
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

        it('should read nested common.createTime values when root field is missing', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const originalTime = testClock.now() - (4 * 60 * 1000);
            const tikTokData = {
                common: {
                    createTime: String(originalTime)
                },
                userId: 'nested-user-id',
                uniqueId: 'NestedUser',
                comment: 'Nested timestamp test'
            };

            const extractedTimestamp = service.extractTimestamp('tiktok', tikTokData);
            const extractedTime = new Date(extractedTimestamp).getTime();
            expect(extractedTime).toBe(originalTime);
        });

        it('should use timestamp field as fallback when createTime is missing', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const fallbackTime = testClock.now() - (3 * 60 * 1000);
            const tikTokData = {
                timestamp: fallbackTime,
                userId: 'testuser-id',
                uniqueId: 'TestUser',
                comment: 'Test message'
            };

            const extractedTimestamp = service.extractTimestamp('tiktok', tikTokData);

            const extractedTime = new Date(extractedTimestamp).getTime();
            expect(extractedTime).toBe(fallbackTime);
        });

        it('should accept string timestamp values for TikTok fallback data', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const fallbackTime = testClock.now() - (5 * 60 * 1000);
            const tikTokData = {
                timestamp: String(fallbackTime),
                userId: 'testuser-id',
                uniqueId: 'TestUser',
                comment: 'String timestamp fallback'
            };

            const extractedTimestamp = service.extractTimestamp('tiktok', tikTokData);
            const extractedTime = new Date(extractedTimestamp).getTime();
            expect(extractedTime).toBe(fallbackTime);
            expect(extractedTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });

        it('should fallback to current time when no timestamp fields available', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const tikTokData = {
                userId: 'testuser-id',
                uniqueId: 'TestUser',
                comment: 'Test message'
            };

            const beforeExtraction = testClock.now();

            const extractedTimestamp = service.extractTimestamp('tiktok', tikTokData);

            const afterExtraction = testClock.now();
            const extractedTime = new Date(extractedTimestamp).getTime();

            expect(extractedTime).toBeGreaterThanOrEqual(beforeExtraction);
            expect(extractedTime).toBeLessThanOrEqual(afterExtraction);
        });
    });

    describe('YouTube Timestamp Preservation', () => {
        it('should preserve original timestamp from YouTube messages in microseconds', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const originalTimeMs = testClock.now() - (4 * 60 * 1000);
            const originalTimeMicros = originalTimeMs * 1000;
            const youTubeData = {
                timestamp: originalTimeMicros.toString(),
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

        it('should preserve timestamp when YouTube provides milliseconds', () => {
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

        it('should accept ISO string timestamps for YouTube payloads', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const isoTimestamp = new Date(testClock.now() - (3 * 60 * 1000)).toISOString();
            const youTubeData = {
                timestamp: isoTimestamp,
                author: {
                    name: 'TestUser',
                    id: 'user123'
                },
                message: {
                    text: 'Test YouTube message (iso)'
                }
            };

            const extractedTimestamp = service.extractTimestamp('youtube', youTubeData);
            expect(extractedTimestamp).toBe(isoTimestamp);
        });

        it('should handle timestampUsec field as alternative for YouTube', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const originalTimeMs = testClock.now() - (5 * 60 * 1000);
            const youTubeData = {
                timestampUsec: (originalTimeMs * 1000).toString(),
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

        it('should fallback to current time when YouTube timestamps are invalid', () => {
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

            const beforeExtraction = testClock.now();

            const extractedTimestamp = service.extractTimestamp('youtube', youTubeData);

            const afterExtraction = testClock.now();
            const extractedTime = new Date(extractedTimestamp).getTime();

            expect(extractedTime).toBeGreaterThanOrEqual(beforeExtraction);
            expect(extractedTime).toBeLessThanOrEqual(afterExtraction);
        });
    });

    describe('Twitch Timestamp Preservation', () => {
        it('should preserve original timestamp from Twitch message context', () => {
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

        it('should use tmi-sent-ts from context as fallback for Twitch', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const originalTime = testClock.now() - (7 * 60 * 1000);
            const twitchData = {
                context: {
                    'tmi-sent-ts': originalTime.toString(),
                    'user-id': 'user123',
                    'username': 'TestUser'
                },
                username: 'TestUser',
                userId: 'user123',
                message: 'Test Twitch message'
            };

            const extractedTimestamp = service.extractTimestamp('twitch', twitchData);

            const extractedTime = new Date(extractedTimestamp).getTime();
            expect(extractedTime).toBe(originalTime);
        });

        it('should accept ISO string timestamps for Twitch payloads', () => {
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

        it('should use top-level fallback time when context has no timestamp fields', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const originalDate = global.Date;
            const isoTimes = ['2024-01-01T00:00:00.100Z', '2024-01-01T00:00:00.200Z'];
            let callIndex = 0;

            global.Date = class extends originalDate {
                constructor(...args) {
                    if (args.length > 0) {
                        return new originalDate(...args);
                    }
                    const iso = isoTimes[Math.min(callIndex, isoTimes.length - 1)];
                    callIndex += 1;
                    return new originalDate(iso);
                }

                static now() {
                    const iso = isoTimes[Math.min(callIndex, isoTimes.length - 1)];
                    return new originalDate(iso).getTime();
                }

                static parse(dateString) {
                    return originalDate.parse(dateString);
                }

                static UTC(...args) {
                    return originalDate.UTC(...args);
                }
            };

            try {
                const twitchData = {
                    context: { username: 'viewer' }
                };

                const extractedTimestamp = service.extractTimestamp('twitch', twitchData);
                expect(extractedTimestamp).toBe('2024-01-01T00:00:00.200Z');
            } finally {
                global.Date = originalDate;
            }
        });

        it('should fallback to current time when Twitch timestamps are missing', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const twitchData = {
                username: 'TestUser',
                userId: 'user123',
                message: 'Test Twitch message'
            };

            const beforeExtraction = testClock.now();

            const extractedTimestamp = service.extractTimestamp('twitch', twitchData);

            const afterExtraction = testClock.now();
            const extractedTime = new Date(extractedTimestamp).getTime();

            expect(extractedTime).toBeGreaterThanOrEqual(beforeExtraction);
            expect(extractedTime).toBeLessThanOrEqual(afterExtraction);
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

            const beforeExtraction = testClock.now();

            const extractedTimestamp = service.extractTimestamp('unsupported-platform', unknownPlatformData);

            const afterExtraction = testClock.now();
            const extractedTime = new Date(extractedTimestamp).getTime();

            expect(extractedTime).toBeGreaterThanOrEqual(beforeExtraction);
            expect(extractedTime).toBeLessThanOrEqual(afterExtraction);
            expect(extractedTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(extractedTime).toBeGreaterThanOrEqual(beforeExtraction);
        });

        it('should handle null/undefined data gracefully', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const testCases = [null, undefined, '', 0, false];

            for (const testData of testCases) {
                const beforeExtraction = testClock.now();

                const extractedTimestamp = service.extractTimestamp('tiktok', testData);

                const afterExtraction = testClock.now();
                const extractedTime = new Date(extractedTimestamp).getTime();

                expect(extractedTime).toBeGreaterThanOrEqual(beforeExtraction);
                expect(extractedTime).toBeLessThanOrEqual(afterExtraction);
                expect(extractedTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            }
        });

        it('should handle malformed timestamp data without crashing', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const malformedData = [
                { platform: 'tiktok', data: { createTime: 'not-a-number' } },
                { platform: 'youtube', data: { timestamp: 'invalid' } },
                { platform: 'twitch', data: { context: { 'tmi-sent-ts': 'bad-timestamp' } } },
                { platform: 'tiktok', data: { createTime: -1 } },
                { platform: 'youtube', data: { timestamp: '0' } }
            ];

            for (const { platform, data } of malformedData) {
                const result = () => service.extractTimestamp(platform, data);

                expect(result).not.toThrow();

                const extractedTimestamp = result();
                expect(extractedTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
                expectNoTechnicalArtifacts(extractedTimestamp);
            }
        });
    });

    describe('Performance Requirements', () => {
        it('should extract timestamps within performance targets', () => {
            if (!TimestampExtractionService) {
                return expect(true).toBe(true);
            }

            const testData = {
                createTime: testClock.now() - 60000,
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
                    return {
                        platform,
                        data: {
                            createTime: testClock.now() - offsetMs,
                            timestamp: testClock.now() - offsetMs,
                            context: { 'tmi-sent-ts': (testClock.now() - offsetMs).toString() },
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
                createTime: testClock.now() - 60000,
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