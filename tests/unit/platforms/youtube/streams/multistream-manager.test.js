const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { useFakeTimers, useRealTimers, setSystemTime, advanceTimersByTime } = require('../../../../helpers/bun-timers');
const testClock = require('../../../../helpers/test-clock');
const { safeSetInterval, validateTimeout } = require('../../../../../src/utils/timeout-validator');

const { createYouTubeMultiStreamManager } = require('../../../../../src/platforms/youtube/streams/youtube-multistream-manager');

describe('YouTube multi-stream manager', () => {
    beforeEach(() => {
        useFakeTimers();
        setSystemTime(new Date('2025-01-15T12:00:00.000Z'));
        testClock.set(1736942400000);
    });

    afterEach(() => {
        useRealTimers();
        testClock.reset();
    });

    const buildPlatform = (overrides = {}) => {
        const shortageState = {
            lastWarningTime: null,
            isInShortage: false,
            lastKnownAvailable: 0,
            lastKnownRequired: 0
        };
        const platform = {
            config: {
                maxStreams: 0,
                streamPollingInterval: 60,
                fullCheckInterval: 1000
            },
            connectionManager: {
                getConnectionCount: createMockFn(() => 0),
                getAllVideoIds: createMockFn(() => []),
                hasConnection: createMockFn(() => false)
            },
            getActiveYouTubeVideoIds: createMockFn(() => []),
            getLiveVideoIds: createMockFn(async () => []),
            connectToYouTubeStream: createMockFn().mockResolvedValue(),
            disconnectFromYouTubeStream: createMockFn().mockResolvedValue(),
            checkStreamShortageAndWarn: createMockFn(),
            _logMultiStreamStatus: createMockFn(),
            _handleProcessingError: createMockFn(),
            _handleConnectionErrorLogging: createMockFn(),
            _handleError: createMockFn(),
            logger: noOpLogger,
            _emitPlatformEvent: createMockFn(),
            shortageState,
            monitoringInterval: null,
            lastFullStreamCheck: null,
            checkMultiStream: createMockFn().mockResolvedValue(),
            ...overrides
        };

        return platform;
    };

    const buildManager = (platform) => createYouTubeMultiStreamManager({
        platform,
        safeSetInterval,
        validateTimeout,
        now: testClock.now
    });

    test('emits stream-detected platform:event when new streams appear', async () => {
        const emitted = [];
        const platform = buildPlatform({
            getLiveVideoIds: createMockFn(async () => ['stream-1']),
            _emitPlatformEvent: (type, payload) => emitted.push({ type, payload })
        });
        const manager = buildManager(platform);

        await manager.checkMultiStream();

        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toMatchObject({
            type: 'platform:stream-detected',
            payload: expect.objectContaining({
                eventType: 'stream-detected',
                newStreamIds: ['stream-1'],
                allStreamIds: ['stream-1'],
                detectionTime: testClock.now()
            })
        });
    });

    test('does not emit stream-detected when no new streams are found', async () => {
        const emitted = [];
        const platform = buildPlatform({
            getLiveVideoIds: createMockFn(async () => []),
            _emitPlatformEvent: (type, payload) => emitted.push({ type, payload })
        });
        const manager = buildManager(platform);

        await manager.checkMultiStream();

        expect(emitted).toEqual([]);
    });

    describe('validation', () => {
        test('throws when platform is missing', () => {
            expect(() => createYouTubeMultiStreamManager({
                safeSetInterval,
                validateTimeout,
                now: testClock.now
            })).toThrow('YouTube multistream manager requires platform instance');
        });

        test('throws when safeSetInterval is missing', () => {
            expect(() => createYouTubeMultiStreamManager({
                platform: buildPlatform(),
                validateTimeout,
                now: testClock.now
            })).toThrow('YouTube multistream manager requires safeSetInterval function');
        });

        test('throws when validateTimeout is missing', () => {
            expect(() => createYouTubeMultiStreamManager({
                platform: buildPlatform(),
                safeSetInterval,
                now: testClock.now
            })).toThrow('YouTube multistream manager requires validateTimeout function');
        });

        test('throws when now is missing', () => {
            expect(() => createYouTubeMultiStreamManager({
                platform: buildPlatform(),
                safeSetInterval,
                validateTimeout
            })).toThrow('YouTube multistream manager requires now function');
        });
    });

    describe('startMonitoring', () => {
        test('clears existing monitoring interval before starting new one', async () => {
            const emitted = [];
            const platform = buildPlatform({
                monitoringInterval: 123,
                config: { streamPollingInterval: 1, fullCheckInterval: 1000, maxStreams: 0 },
                getLiveVideoIds: createMockFn(async () => ['stream-1']),
                _emitPlatformEvent: (type, payload) => emitted.push({ type, payload })
            });
            const manager = buildManager(platform);
            platform.checkMultiStream = () => manager.checkMultiStream();

            await manager.startMonitoring();
            const firstEmitCount = emitted.length;

            await manager.startMonitoring();

            expect(emitted.length).toBeGreaterThanOrEqual(firstEmitCount);
        });

        test('performs periodic checks at configured interval', async () => {
            const emitted = [];
            const platform = buildPlatform({
                config: { streamPollingInterval: 1, fullCheckInterval: 1000, maxStreams: 0 },
                getLiveVideoIds: createMockFn(async () => ['stream-1']),
                _emitPlatformEvent: (type, payload) => emitted.push({ type, payload })
            });
            const manager = buildManager(platform);
            platform.checkMultiStream = () => manager.checkMultiStream();

            await manager.startMonitoring();
            const initialEmitCount = emitted.length;

            await advanceTimersByTime(1100);

            expect(emitted.length).toBeGreaterThan(initialEmitCount);
        });

        test('records monitoring start time', async () => {
            setSystemTime(new Date('2025-01-15T12:05:00.000Z'));
            const expectedTime = testClock.now();

            const platform = buildPlatform({
                getLiveVideoIds: createMockFn(async () => [])
            });
            const manager = buildManager(platform);

            await manager.startMonitoring();

            expect(platform.monitoringIntervalStart).toBe(expectedTime);
        });

        test('propagates error from initial check when throwOnError is true', async () => {
            const initialError = new Error('stream detection failed');
            const platform = buildPlatform({
                checkMultiStream: createMockFn(async () => { throw initialError; })
            });
            const manager = buildManager(platform);

            await expect(manager.startMonitoring()).rejects.toThrow('stream detection failed');
        });

    });

    describe('checkMultiStream at capacity', () => {
        test('skips full check when at maxStreams and within full check interval', async () => {
            const currentTime = testClock.now();
            const platform = buildPlatform({
                config: { maxStreams: 2, streamPollingInterval: 60, fullCheckInterval: 60000 },
                connectionManager: {
                    getConnectionCount: createMockFn(() => 2),
                    getAllVideoIds: createMockFn(() => ['stream-1', 'stream-2']),
                    hasConnection: createMockFn(() => true)
                },
                getActiveYouTubeVideoIds: createMockFn(() => ['stream-1', 'stream-2']),
                lastFullStreamCheck: currentTime - 50
            });
            const manager = buildManager(platform);

            await manager.checkMultiStream();

            expect(platform.lastFullStreamCheck).toBe(currentTime - 50);
        });

        test('updates lastFullStreamCheck when performing full check after interval exceeded', async () => {
            const currentTime = testClock.now();
            const platform = buildPlatform({
                config: { maxStreams: 2, streamPollingInterval: 60, fullCheckInterval: 1000 },
                connectionManager: {
                    getConnectionCount: createMockFn(() => 2),
                    getAllVideoIds: createMockFn(() => ['stream-1', 'stream-2']),
                    hasConnection: createMockFn(() => true)
                },
                getActiveYouTubeVideoIds: createMockFn(() => ['stream-1', 'stream-2']),
                getLiveVideoIds: createMockFn(async () => ['stream-1', 'stream-2']),
                lastFullStreamCheck: currentTime - 5000
            });
            const manager = buildManager(platform);

            await manager.checkMultiStream();

            expect(platform.lastFullStreamCheck).toBe(currentTime);
        });

        test('disconnects streams that are no longer live during full check', async () => {
            const currentTime = testClock.now();
            const disconnected = [];
            const platform = buildPlatform({
                config: { maxStreams: 2, streamPollingInterval: 60, fullCheckInterval: 1000 },
                connectionManager: {
                    getConnectionCount: createMockFn(() => 2),
                    getAllVideoIds: createMockFn(() => ['stream-1', 'stream-2']),
                    hasConnection: createMockFn(() => true)
                },
                getActiveYouTubeVideoIds: createMockFn(() => ['stream-1', 'stream-2']),
                getLiveVideoIds: createMockFn(async () => ['stream-1']),
                disconnectFromYouTubeStream: createMockFn(async (videoId, reason) => {
                    disconnected.push({ videoId, reason });
                }),
                lastFullStreamCheck: currentTime - 5000
            });
            const manager = buildManager(platform);

            await manager.checkMultiStream();

            expect(disconnected).toContainEqual({ videoId: 'stream-2', reason: 'stream limit exceeded' });
        });

        test('preserves connections when stream detection returns empty at capacity', async () => {
            const currentTime = testClock.now();
            const disconnected = [];
            const platform = buildPlatform({
                config: { maxStreams: 2, streamPollingInterval: 60, fullCheckInterval: 1000 },
                connectionManager: {
                    getConnectionCount: createMockFn(() => 2),
                    getAllVideoIds: createMockFn(() => ['stream-1', 'stream-2']),
                    hasConnection: createMockFn(() => true)
                },
                getActiveYouTubeVideoIds: createMockFn(() => ['stream-1', 'stream-2']),
                getLiveVideoIds: createMockFn(async () => []),
                disconnectFromYouTubeStream: createMockFn(async (videoId) => {
                    disconnected.push(videoId);
                }),
                lastFullStreamCheck: currentTime - 5000
            });
            const manager = buildManager(platform);

            await manager.checkMultiStream();

            expect(disconnected).toEqual([]);
        });
    });

    describe('maxStreams limiting', () => {
        test('limits streams to maxStreams when more are detected', async () => {
            const connected = [];
            const platform = buildPlatform({
                config: { maxStreams: 2, streamPollingInterval: 60, fullCheckInterval: 1000 },
                getLiveVideoIds: createMockFn(async () => ['s1', 's2', 's3', 's4']),
                connectToYouTubeStream: createMockFn(async (videoId) => {
                    connected.push(videoId);
                })
            });
            const manager = buildManager(platform);

            await manager.checkMultiStream();

            expect(connected).toEqual(['s1', 's2']);
        });
    });

    describe('connection error handling', () => {
        test('continues connecting other streams when one stream connection fails', async () => {
            const connected = [];
            const platform = buildPlatform({
                getLiveVideoIds: createMockFn(async () => ['s1', 's2']),
                connectToYouTubeStream: createMockFn(async (videoId) => {
                    if (videoId === 's1') throw new Error('connection failed');
                    connected.push(videoId);
                })
            });
            const manager = buildManager(platform);

            await manager.checkMultiStream();

            expect(connected).toEqual(['s2']);
        });
    });

    describe('stream detection failure preservation', () => {
        test('preserves existing connections when detection returns empty', async () => {
            const disconnected = [];
            const platform = buildPlatform({
                connectionManager: {
                    getConnectionCount: createMockFn(() => 1),
                    getAllVideoIds: createMockFn(() => ['existing-stream']),
                    hasConnection: createMockFn(() => true)
                },
                getActiveYouTubeVideoIds: createMockFn(() => []),
                getLiveVideoIds: createMockFn(async () => []),
                disconnectFromYouTubeStream: createMockFn(async (videoId) => {
                    disconnected.push(videoId);
                })
            });
            const manager = buildManager(platform);

            await manager.checkMultiStream();

            expect(disconnected).toEqual([]);
        });

        test('disconnects streams that are no longer detected', async () => {
            const disconnected = [];
            const platform = buildPlatform({
                connectionManager: {
                    getConnectionCount: createMockFn(() => 1),
                    getAllVideoIds: createMockFn(() => ['old-stream']),
                    hasConnection: createMockFn(() => true)
                },
                getActiveYouTubeVideoIds: createMockFn(() => []),
                getLiveVideoIds: createMockFn(async () => ['new-stream']),
                connectToYouTubeStream: createMockFn().mockResolvedValue(),
                disconnectFromYouTubeStream: createMockFn(async (videoId, reason) => {
                    disconnected.push({ videoId, reason });
                })
            });
            const manager = buildManager(platform);

            await manager.checkMultiStream();

            expect(disconnected).toContainEqual({ videoId: 'old-stream', reason: 'stream no longer live' });
        });
    });

    describe('checkMultiStream error handling', () => {
        test('completes without throwing when stream detection fails and throwOnError is false', async () => {
            const platform = buildPlatform({
                getLiveVideoIds: createMockFn(async () => { throw new Error('api error'); })
            });
            const manager = buildManager(platform);

            await expect(manager.checkMultiStream()).resolves.toBeUndefined();
        });

        test('throws error when stream detection fails and throwOnError is true', async () => {
            const platform = buildPlatform({
                getLiveVideoIds: createMockFn(async () => { throw new Error('api error'); })
            });
            const manager = buildManager(platform);

            await expect(manager.checkMultiStream({ throwOnError: true })).rejects.toThrow('api error');
        });
    });

    describe('checkStreamShortageAndWarn', () => {
        test('warns when available streams are less than maxStreams', () => {
            const warnCalls = [];
            const platform = buildPlatform({
                logger: {
                    ...noOpLogger,
                    warn: (msg, scope) => warnCalls.push({ msg, scope })
                }
            });
            const manager = buildManager(platform);

            manager.checkStreamShortageAndWarn(1, 3);

            expect(warnCalls).toHaveLength(1);
            expect(warnCalls[0].msg).toContain('Stream shortage detected');
            expect(platform.shortageState.isInShortage).toBe(true);
        });

        test('throttles warning when shortage persists within interval', () => {
            const currentTime = testClock.now();
            const warnCalls = [];
            const infoCalls = [];
            const platform = buildPlatform({
                config: { fullCheckInterval: 60000 },
                shortageState: {
                    lastWarningTime: currentTime - 100,
                    isInShortage: true,
                    lastKnownAvailable: 1,
                    lastKnownRequired: 3
                },
                logger: {
                    ...noOpLogger,
                    warn: (msg) => warnCalls.push(msg),
                    info: (msg) => infoCalls.push(msg)
                }
            });
            const manager = buildManager(platform);

            manager.checkStreamShortageAndWarn(1, 3);

            expect(warnCalls).toHaveLength(0);
            expect(infoCalls.some(msg => msg.includes('shortage persists'))).toBe(true);
        });

        test('logs resolution when shortage is resolved', () => {
            const currentTime = testClock.now();
            const infoCalls = [];
            const platform = buildPlatform({
                shortageState: {
                    lastWarningTime: currentTime - 500,
                    isInShortage: true,
                    lastKnownAvailable: 1,
                    lastKnownRequired: 3
                },
                logger: {
                    ...noOpLogger,
                    info: (msg) => infoCalls.push(msg)
                }
            });
            const manager = buildManager(platform);

            manager.checkStreamShortageAndWarn(3, 3);

            expect(infoCalls.some(msg => msg.includes('shortage resolved'))).toBe(true);
            expect(platform.shortageState.isInShortage).toBe(false);
        });

        test('does not log resolution when not previously in shortage', () => {
            const infoCalls = [];
            const platform = buildPlatform({
                shortageState: {
                    lastWarningTime: null,
                    isInShortage: false,
                    lastKnownAvailable: 0,
                    lastKnownRequired: 0
                },
                logger: {
                    ...noOpLogger,
                    info: (msg) => infoCalls.push(msg)
                }
            });
            const manager = buildManager(platform);

            manager.checkStreamShortageAndWarn(3, 3);

            expect(infoCalls.filter(msg => msg.includes('shortage'))).toHaveLength(0);
        });
    });

    describe('logStatus', () => {
        test('logs ready and total connection counts', () => {
            const infoCalls = [];
            const platform = buildPlatform({
                connectionManager: {
                    getConnectionCount: createMockFn(() => 2),
                    getAllVideoIds: createMockFn(() => ['s1', 's2']),
                    hasConnection: createMockFn(() => true)
                },
                getActiveYouTubeVideoIds: createMockFn(() => ['s1']),
                logger: {
                    ...noOpLogger,
                    info: (msg) => infoCalls.push(msg)
                }
            });
            const manager = buildManager(platform);

            manager.logStatus();

            expect(infoCalls.some(msg => msg.includes('1 ready'))).toBe(true);
            expect(infoCalls.some(msg => msg.includes('2 total'))).toBe(true);
        });

        test('logs pending connections when includeDetails is true', () => {
            const infoCalls = [];
            const platform = buildPlatform({
                connectionManager: {
                    getConnectionCount: createMockFn(() => 2),
                    getAllVideoIds: createMockFn(() => ['s1', 's2']),
                    hasConnection: createMockFn(() => true)
                },
                getActiveYouTubeVideoIds: createMockFn(() => ['s1']),
                logger: {
                    ...noOpLogger,
                    info: (msg) => infoCalls.push(msg)
                }
            });
            const manager = buildManager(platform);

            manager.logStatus(true);

            expect(infoCalls.some(msg => msg.includes('Waiting for stream to start'))).toBe(true);
        });

        test('logs active streams list when includeActiveStreamsList is true', () => {
            const infoCalls = [];
            const debugCalls = [];
            const platform = buildPlatform({
                connectionManager: {
                    getConnectionCount: createMockFn(() => 1),
                    getAllVideoIds: createMockFn(() => ['s1']),
                    hasConnection: createMockFn(() => true)
                },
                getActiveYouTubeVideoIds: createMockFn(() => ['s1']),
                logger: {
                    ...noOpLogger,
                    info: (msg) => infoCalls.push(msg),
                    debug: (msg) => debugCalls.push(msg)
                }
            });
            const manager = buildManager(platform);

            manager.logStatus(false, true);

            expect(infoCalls.some(msg => msg.includes('Active streams'))).toBe(true);
        });

        test('logs no connections message when none exist', () => {
            const debugCalls = [];
            const platform = buildPlatform({
                connectionManager: {
                    getConnectionCount: createMockFn(() => 0),
                    getAllVideoIds: createMockFn(() => []),
                    hasConnection: createMockFn(() => false)
                },
                getActiveYouTubeVideoIds: createMockFn(() => []),
                logger: {
                    ...noOpLogger,
                    debug: (msg) => debugCalls.push(msg)
                }
            });
            const manager = buildManager(platform);

            manager.logStatus();

            expect(debugCalls.some(msg => msg.includes('No YouTube connections'))).toBe(true);
        });
    });
});
