const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { PlatformLifecycleService } = require('../../../src/services/PlatformLifecycleService.ts');
const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');
const { DependencyFactory } = require('../../../src/utils/dependency-factory');
const testClock = require('../../helpers/test-clock');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../src/core/secrets');

const createDeferred = () => {
    let resolve;
    const promise = new Promise((res) => {
        resolve = res;
    });
    return { promise, resolve };
};

describe('PlatformLifecycleService', () => {
    let service;
    let mockEventBus;
    let configFixture;

    beforeEach(() => {
        mockEventBus = {
            emit: createMockFn(),
            subscribe: createMockFn().mockReturnValue(() => {})
        };

        _resetForTesting();
        secrets.twitch.clientSecret = 'test-client-secret';

        configFixture = {
            twitch: { enabled: false },
            youtube: { enabled: false },
            tiktok: { enabled: false }
        };

        service = new PlatformLifecycleService({
            config: configFixture,
            eventBus: mockEventBus,
            logger: noOpLogger
        });
    });

    describe('Service Status Reporting', () => {
        it('reports ready platforms and connection times', async () => {
            configFixture.twitch = {
                enabled: true,
                channel: 'test-channel',
                clientId: 'test-client-id'
            };

            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: createMockFn().mockImplementation(async (handlers) => {
                    if (handlers.onChat) {
                        await handlers.onChat({ message: { text: 'ready' } });
                    }
                }),
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));

            await service.initializeAllPlatforms({ twitch: mockPlatformClass });

            const status = service.getStatus();
            expect(status.initializedPlatforms).toContain('twitch');
            expect(status.connectionTimes.twitch).toEqual(expect.any(Number));
            expect(status.streamStatuses).toBeUndefined();
        });

        it('reports failed platforms with error context', async () => {
            configFixture.youtube = { enabled: true, username: 'channel' };

            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: createMockFn().mockRejectedValue(new Error('connect failed')),
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));

            await service.initializeAllPlatforms({ youtube: mockPlatformClass });

            const status = service.getStatus();
            expect(status.failedPlatforms).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'youtube',
                        lastError: 'connect failed'
                    })
                ])
            );
            expect(service.getPlatform('youtube')).toBeNull();
            expect(status.registeredPlatforms).not.toContain('youtube');
        });

        it('reports registered platforms consistently with accessors', () => {
            service.platforms = {
                twitch: { initialize: createMockFn(), cleanup: createMockFn() },
                youtube: { initialize: createMockFn(), cleanup: createMockFn() }
            };
            service.updatePlatformHealth('twitch', { state: 'ready' });
            service.updatePlatformHealth('youtube', { state: 'failed', lastError: 'test-failure' });

            const accessorPlatforms = Object.keys(service.getAllPlatforms()).sort();
            const status = service.getStatus();

            expect(status.registeredPlatforms.sort()).toEqual(accessorPlatforms);
        });

        it('counts only platform config entries in totalConfigured status', () => {
            service.config = {
                twitch: { enabled: true },
                youtube: { enabled: false },
                general: { debugEnabled: false },
                obs: { enabled: true },
                vfx: { filePath: '/tmp' }
            };

            const status = service.getStatus();

            expect(status.totalConfigured).toBe(2);
        });
    });

    afterEach(() => {
        if (service) {
            service.dispose();
        }
        clearAllMocks();
        _resetForTesting();
        initializeStaticSecrets();
    });

    describe('Platform Initialization', () => {
        it('should initialize enabled platforms', async () => {
            configFixture.twitch = {
                enabled: true,
                channel: 'test-channel',
                clientId: 'test-client-id'
            };

            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: createMockFn().mockResolvedValue(true),
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));

            const platformModules = { twitch: mockPlatformClass };
            const eventHandlers = { default: {} };

            const result = await service.initializeAllPlatforms(platformModules, eventHandlers);

            expect(result.twitch).toBeDefined();
            expect(result.twitch.initialize).toBeDefined();
        });

        it('should skip disabled platforms', async () => {
            const mockPlatformClass = createMockFn();
            const platformModules = {
                twitch: mockPlatformClass,
                youtube: mockPlatformClass
            };

            const result = await service.initializeAllPlatforms(platformModules, {});

            expect(result).toEqual({});
            expect(service.isPlatformAvailable('twitch')).toBe(false);
            expect(service.isPlatformAvailable('youtube')).toBe(false);
        });

        it('should handle missing config safely', async () => {
            const localService = new PlatformLifecycleService({
                eventBus: mockEventBus,
                logger: noOpLogger
            });

            const platformModules = {
                twitch: createMockFn()
            };

            const result = await localService.initializeAllPlatforms(platformModules, {});

            expect(result).toEqual({});
            expect(localService.isPlatformAvailable('twitch')).toBe(false);
        });

        it('should emit platform:initialized event when platform is ready', async () => {
            configFixture.youtube = { enabled: true, username: 'test-channel' };

            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: createMockFn().mockResolvedValue(true),
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));

            const platformModules = { youtube: mockPlatformClass };

            await service.initializeAllPlatforms(platformModules, { default: {} });

            expect(service.isPlatformAvailable('youtube')).toBe(true);
            expect(service.getPlatform('youtube')).toBeDefined();
            expect(service.getPlatformConnectionTime('youtube')).toBeGreaterThan(0);
        });

        it('should emit EventBus platform events when default handlers are used', async () => {
            configFixture.twitch = { enabled: true };
            const timestamp = new Date().toISOString();

            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: createMockFn().mockImplementation((handlers) => {
                    handlers.onChat({ message: { text: 'hello' }, username: 'user', userId: 'u1', timestamp });
                    handlers.onViewerCount({ count: 42, timestamp });

                    handlers.onGift({
                        username: 'donor',
                        userId: 'u2',
                        id: 'gift-1',
                        giftType: 'rose',
                        giftCount: 1,
                        amount: 5,
                        currency: 'coins',
                        timestamp
                    });
                    return Promise.resolve(true);
                }),
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));

            const platformModules = { twitch: mockPlatformClass };

            await service.initializeAllPlatforms(platformModules);

            const platformEvents = mockEventBus.emit.mock.calls
                .filter(([name]) => name === 'platform:event')
                .map(([, payload]) => payload);

            expect(platformEvents).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    platform: 'twitch',
                    type: 'platform:chat-message',
                    data: expect.objectContaining({
                        message: { text: 'hello' },
                        timestamp
                    })
                }),
                expect.objectContaining({
                    platform: 'twitch',
                    type: 'platform:viewer-count',
                    data: expect.objectContaining({
                        count: 42,
                        timestamp: expect.any(String)
                    })
                }),
                expect.objectContaining({
                    platform: 'twitch',
                    type: 'platform:gift',
                    data: expect.objectContaining({
                        username: 'donor',
                        timestamp
                    })
                })
            ]));
        });

        it('validates PlatformClass is a constructor', async () => {
            configFixture.twitch = { enabled: true };
            const platformModules = { twitch: null };

            await service.initializeAllPlatforms(platformModules, {});

            expect(service.isPlatformAvailable('twitch')).toBe(false);
            expect(service.getPlatform('twitch')).toBeNull();
        });

        it('records platform failure safely when non-Error values are thrown during initialization', async () => {
            configFixture.twitch = {
                enabled: true,
                channel: 'test-channel',
                clientId: 'test-client-id'
            };

            service.createPlatformInstance = createMockFn().mockRejectedValue(null);

            await service.initializeAllPlatforms({
                twitch: createMockFn()
            });

            const status = service.getStatus();
            expect(status.failedPlatforms).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    name: 'twitch',
                    lastError: 'null'
                })
            ]));
        });

        it('rethrows original non-Error values from initializePlatformConnection without secondary crashes', async () => {
            const platformInstance = {
                initialize: createMockFn().mockRejectedValue(null)
            };

            await expect(service.initializePlatformConnection('twitch', platformInstance, {}, {
                enabled: true
            })).rejects.toBeNull();
        });
    });

    describe('Platform Instance Creation', () => {
        it('should create platform instance without DI when no factory', async () => {
            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: createMockFn().mockResolvedValue(true),
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));
            const config = { test: 'config' };

            const instance = await service.createPlatformInstance('twitch', mockPlatformClass, config);

            expect(instance).toBeDefined();
            expect(typeof instance).toBe('object');
        });

        it('should use factory method when available', async () => {
            const mockDependencies = { auth: 'mock' };
            const mockFactory = {
                createTwitchDependencies: createMockFn().mockReturnValue(mockDependencies)
            };

            service.dispose();
            service = new PlatformLifecycleService({
                config: configFixture,
                eventBus: mockEventBus,
                logger: noOpLogger,
                dependencyFactory: mockFactory,
                sharedDependencies: { test: 'value' }
            });

            const mockPlatformClass = createMockFn().mockImplementation((platformConfig, dependencies) => ({
                platformConfig,
                dependencies,
                initialize: createMockFn().mockResolvedValue(true),
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));
            const config = { test: 'config' };

            const instance = await service.createPlatformInstance('twitch', mockPlatformClass, config);

            expect(instance.dependencies).toBe(mockDependencies);
            expect(instance).toBeDefined();
            expect(typeof instance).toBe('object');
        });

        it('creates platform dependencies from a DependencyFactory instance without losing method context', async () => {
            configFixture.twitch = {
                enabled: true,
                channel: 'test-channel',
                clientId: 'test-client-id'
            };

            const dependencyFactory = new DependencyFactory();
            const testTwitchAuth = { isReady: () => true };

            service.dispose();
            service = new PlatformLifecycleService({
                config: configFixture,
                eventBus: mockEventBus,
                logger: noOpLogger,
                dependencyFactory,
                sharedDependencies: {
                    config: configFixture,
                    twitchAuth: testTwitchAuth
                }
            });

            const TestPlatform = createMockFn().mockImplementation((platformConfig, dependencies) => ({
                platformConfig,
                dependencies,
                initialize: createMockFn().mockResolvedValue(true),
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));

            const instance = await service.createPlatformInstance('twitch', TestPlatform, configFixture.twitch);

            expect(instance.dependencies.twitchAuth).toBe(testTwitchAuth);
            expect(instance.dependencies.selfMessageDetectionService).toBeDefined();
            expect(typeof instance.dependencies.logger?.info).toBe('function');
        });

        it('should fallback gracefully if factory method missing', async () => {
            service.dependencyFactory = {};

            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: createMockFn().mockResolvedValue(true),
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));
            const config = { test: 'config' };

            const instance = await service.createPlatformInstance('unknown', mockPlatformClass, config);

            expect(instance).toBeDefined();
            expect(typeof instance).toBe('object');
        });
    });

    describe('Connection State Tracking', () => {
        it('should record platform connection time', () => {
            service.recordPlatformConnection('twitch');

            const connectionTime = service.getPlatformConnectionTime('twitch');
            expect(connectionTime).toBeGreaterThan(0);
            expect(typeof connectionTime).toBe('number');
        });

        it('should check if platform is available', () => {
            service.platforms = { twitch: { connected: true } };

            expect(service.isPlatformAvailable('twitch')).toBe(true);
        });

        it('should return false for unavailable platform', () => {
            expect(service.isPlatformAvailable('nonexistent')).toBe(false);
        });

        it('should get platform instance', () => {
            const mockPlatform = { name: 'twitch' };
            service.platforms = { twitch: mockPlatform };

            expect(service.getPlatform('twitch')).toBe(mockPlatform);
        });

        it('should return null for non-existent platform', () => {
            expect(service.getPlatform('nonexistent')).toBeNull();
        });
    });

    describe('Resource Cleanup', () => {
        it('should dispose resources when service stops', () => {
            service.platforms = { twitch: {}, youtube: {} };
            service.platformConnectionTimes = { twitch: testClock.now() };
            service.backgroundPlatformInits = [{ promise: Promise.resolve() }];

            service.dispose();

            expect(Object.keys(service.platforms).length).toBe(0);
            expect(Object.keys(service.platformConnectionTimes).length).toBe(0);
            expect(service.backgroundPlatformInits.length).toBe(0);
        });
    });

    describe('Platform Connection Coordination', () => {
        it('should connect YouTube directly (platform-managed detection)', async () => {
            configFixture.youtube = { enabled: true, username: 'test-channel' };

            const platformInitSpy = createMockFn().mockResolvedValue(true);
            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: platformInitSpy,
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));

            await service.initializeAllPlatforms({ youtube: mockPlatformClass });

            const status = service.getStatus();
            expect(status.initializedPlatforms).toContain('youtube');
            expect(status.platformHealth.youtube.state).toBe('ready');
        });

        it('should connect Twitch directly (chat always available)', async () => {
            configFixture.twitch = {
                enabled: true,
                channel: 'test-channel',
                clientId: 'test-client-id'
            };

            const platformInitSpy = createMockFn().mockResolvedValue(true);
            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: platformInitSpy,
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));

            await service.initializeAllPlatforms({ twitch: mockPlatformClass });

            const status = service.getStatus();
            expect(status.initializedPlatforms).toContain('twitch');
            expect(status.platformHealth.twitch.state).toBe('ready');
        });
    });

    describe('Background Initialization', () => {
        it('should run TikTok initialization in background without blocking', async () => {
            configFixture.tiktok = { enabled: true, username: 'streamer' };

            const deferred = createDeferred();
            const platformInitSpy = createMockFn().mockImplementation(() => deferred.promise);
            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: platformInitSpy,
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));

            await service.initializeAllPlatforms({ tiktok: mockPlatformClass });

            expect(service.backgroundPlatformInits).toHaveLength(1);
            expect(platformInitSpy).toHaveBeenCalled();

            const waitPromise = service.waitForBackgroundInits(100);
            deferred.resolve();
            await waitPromise;
            expect(service.backgroundPlatformInits).toHaveLength(0);
        });

        it('starts enabled non-background platforms in parallel', async () => {
            configFixture.twitch = {
                enabled: true,
                channel: 'test-channel',
                clientId: 'test-client-id'
            };
            configFixture.youtube = { enabled: true, username: 'test-channel' };

            const twitchInitDeferred = createDeferred();
            const youtubeInitDeferred = createDeferred();

            const twitchInit = createMockFn().mockImplementation(() => twitchInitDeferred.promise);
            const youtubeInit = createMockFn().mockImplementation(() => youtubeInitDeferred.promise);

            const platformModules = {
                twitch: createMockFn().mockImplementation(() => ({
                    initialize: twitchInit,
                    cleanup: createMockFn().mockResolvedValue(),
                    on: createMockFn()
                })),
                youtube: createMockFn().mockImplementation(() => ({
                    initialize: youtubeInit,
                    cleanup: createMockFn().mockResolvedValue(),
                    on: createMockFn()
                }))
            };

            const initPromise = service.initializeAllPlatforms(platformModules);

            await Promise.resolve();

            const statusDuringInit = service.getStatus();
            expect(statusDuringInit.initializingPlatforms).toEqual(expect.arrayContaining(['twitch', 'youtube']));

            twitchInitDeferred.resolve(true);
            youtubeInitDeferred.resolve(true);
            await initPromise;
        });

        it('keeps successful platform initialization progressing when another platform fails', async () => {
            configFixture.twitch = {
                enabled: true,
                channel: 'test-channel',
                clientId: 'test-client-id'
            };
            configFixture.youtube = { enabled: true, username: 'test-channel' };

            const twitchInitDeferred = createDeferred();
            const twitchError = new Error('twitch connect failed');
            const twitchInit = createMockFn().mockImplementation(async () => {
                await twitchInitDeferred.promise;
                throw twitchError;
            });
            const youtubeInit = createMockFn().mockResolvedValue(true);

            const platformModules = {
                twitch: createMockFn().mockImplementation(() => ({
                    initialize: twitchInit,
                    cleanup: createMockFn().mockResolvedValue(),
                    on: createMockFn()
                })),
                youtube: createMockFn().mockImplementation(() => ({
                    initialize: youtubeInit,
                    cleanup: createMockFn().mockResolvedValue(),
                    on: createMockFn()
                }))
            };

            const initPromise = service.initializeAllPlatforms(platformModules);

            await Promise.resolve();
            await Promise.resolve();

            const statusWhileTwitchPending = service.getStatus();
            expect(statusWhileTwitchPending.initializedPlatforms).toContain('youtube');

            twitchInitDeferred.resolve();
            await initPromise;

            const status = service.getStatus();
            expect(status.initializedPlatforms).toContain('youtube');
            expect(status.failedPlatforms).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    name: 'twitch',
                    lastError: 'twitch connect failed'
                })
            ]));
        });

        it('preserves TikTok background initialization semantics with parallel startup', async () => {
            configFixture.twitch = {
                enabled: true,
                channel: 'test-channel',
                clientId: 'test-client-id'
            };
            configFixture.tiktok = { enabled: true, username: 'streamer' };

            const twitchInitDeferred = createDeferred();
            const tiktokInitDeferred = createDeferred();
            const twitchInit = createMockFn().mockImplementation(() => twitchInitDeferred.promise);
            const tiktokInit = createMockFn().mockImplementation(() => tiktokInitDeferred.promise);

            const platformModules = {
                twitch: createMockFn().mockImplementation(() => ({
                    initialize: twitchInit,
                    cleanup: createMockFn().mockResolvedValue(),
                    on: createMockFn()
                })),
                tiktok: createMockFn().mockImplementation(() => ({
                    initialize: tiktokInit,
                    cleanup: createMockFn().mockResolvedValue(),
                    on: createMockFn()
                }))
            };

            const initPromise = service.initializeAllPlatforms(platformModules);

            await Promise.resolve();

            const statusDuringInit = service.getStatus();
            expect(statusDuringInit.initializingPlatforms).toContain('tiktok');
            expect(service.backgroundPlatformInits).toHaveLength(1);

            twitchInitDeferred.resolve(true);
            tiktokInitDeferred.resolve(true);
            await initPromise;
        });

        it('marks background init failure safely when callback throws non-Error values', async () => {
            await expect(service.initializePlatformAsync('tiktok', async () => {
                throw null;
            })).resolves.toBeUndefined();

            const status = service.getStatus();
            expect(status.failedPlatforms).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    name: 'tiktok',
                    lastError: 'null'
                })
            ]));
        });
    });

    describe('Platform Shutdown', () => {
        it('should cleanup all platforms gracefully on service shutdown', async () => {
            configFixture.twitch = { enabled: true };

            const cleanupSpy = createMockFn().mockResolvedValue();
            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: createMockFn().mockResolvedValue(true),
                cleanup: cleanupSpy,
                on: createMockFn()
            }));

            await service.initializeAllPlatforms({ twitch: mockPlatformClass });

            await service.disconnectAll();

            expect(cleanupSpy).toHaveBeenCalled();
            expect(service.isPlatformAvailable('twitch')).toBe(false);
            expect(service.getStatus().platformHealth.twitch.state).toBe('disconnected');
        });

        it('removes platform instances even when cleanup fails', async () => {
            configFixture.twitch = { enabled: true, channel: 'test-channel', clientId: 'test-client-id' };

            const cleanupSpy = createMockFn().mockRejectedValue(new Error('cleanup failed'));
            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: createMockFn().mockResolvedValue(true),
                cleanup: cleanupSpy,
                on: createMockFn()
            }));

            await service.initializeAllPlatforms({ twitch: mockPlatformClass });
            await service.disconnectAll();

            expect(cleanupSpy).toHaveBeenCalled();
            expect(service.isPlatformAvailable('twitch')).toBe(false);
            expect(service.getStatus().registeredPlatforms).not.toContain('twitch');
        });

        it('prefers cleanup even when a disconnect method exists', async () => {
            configFixture.twitch = { enabled: true };

            const cleanupSpy = createMockFn().mockResolvedValue();
            const disconnectSpy = createMockFn().mockResolvedValue();
            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: createMockFn().mockResolvedValue(true),
                cleanup: cleanupSpy,
                disconnect: disconnectSpy,
                on: createMockFn()
            }));

            await service.initializeAllPlatforms({ twitch: mockPlatformClass });
            await service.disconnectAll();

            expect(cleanupSpy).toHaveBeenCalled();
            expect(disconnectSpy).not.toHaveBeenCalled();
            expect(service.isPlatformAvailable('twitch')).toBe(false);
        });

        it('prevents background init from transitioning health to ready after shutdown begins', async () => {
            configFixture.tiktok = { enabled: true, username: 'test-streamer' };

            const deferred = createDeferred();
            const cleanupSpy = createMockFn().mockResolvedValue();
            const tiktokClass = createMockFn().mockImplementation(() => ({
                initialize: createMockFn().mockImplementation(() => deferred.promise),
                cleanup: cleanupSpy,
                on: createMockFn()
            }));

            await service.initializeAllPlatforms({ tiktok: tiktokClass });

            const shutdownPromise = service.disconnectAll();
            deferred.resolve(true);
            await shutdownPromise;

            const status = service.getStatus();
            expect(status.platformHealth.tiktok?.state).not.toBe('ready');
            expect(cleanupSpy).toHaveBeenCalled();
        });
    });

    describe('Default Handler Contract Matrix', () => {
        const CANONICAL_HANDLER_MATRIX = {
            onChat: { eventType: PlatformEvents.CHAT_MESSAGE, requiresTimestamp: true, dataKey: 'message' },
            onViewerCount: { eventType: PlatformEvents.VIEWER_COUNT, requiresTimestamp: true, dataKey: 'count' },
            onGift: { eventType: PlatformEvents.GIFT, requiresTimestamp: true, dataKey: 'giftType' },
            onPaypiggy: { eventType: PlatformEvents.PAYPIGGY, requiresTimestamp: true, dataKey: 'tier' },
            onGiftPaypiggy: { eventType: PlatformEvents.GIFTPAYPIGGY, requiresTimestamp: true, dataKey: 'giftCount' },
            onFollow: { eventType: PlatformEvents.FOLLOW, requiresTimestamp: true, dataKey: 'username' },
            onShare: { eventType: PlatformEvents.SHARE, requiresTimestamp: true, dataKey: 'username' },
            onRaid: { eventType: PlatformEvents.RAID, requiresTimestamp: true, dataKey: 'viewerCount' },
            onEnvelope: { eventType: PlatformEvents.ENVELOPE, requiresTimestamp: true, dataKey: 'giftType' },
            onStreamStatus: { eventType: PlatformEvents.STREAM_STATUS, requiresTimestamp: true, dataKey: 'isLive' },
            onStreamDetected: { eventType: PlatformEvents.STREAM_DETECTED, requiresTimestamp: false, dataKey: 'eventType' }
        };

        const CANONICAL_HANDLER_NAMES = [...Object.keys(CANONICAL_HANDLER_MATRIX), 'onConnection'];

        const createPayloadForHandler = (handlerName, timestamp) => {
            const base = { username: 'test-user', userId: 'test-user-id', timestamp };
            switch (handlerName) {
                case 'onChat':
                    return { ...base, message: { text: 'test-message' } };
                case 'onViewerCount':
                    return { count: 42, timestamp };
                case 'onGift':
                    return { ...base, id: 'test-gift-id', giftType: 'test-rose', giftCount: 1, amount: 5, currency: 'coins' };
                case 'onPaypiggy':
                    return { ...base, tier: 'test-tier-1', months: 1 };
                case 'onGiftPaypiggy':
                    return { ...base, giftCount: 5, tier: 'test-tier-1' };
                case 'onFollow':
                    return { ...base };
                case 'onShare':
                    return { ...base };
                case 'onRaid':
                    return { ...base, viewerCount: 100 };
                case 'onEnvelope':
                    return { ...base, id: 'test-envelope-id', giftType: 'test-envelope', giftCount: 1, amount: 10, currency: 'coins' };
                case 'onStreamStatus':
                    return { isLive: true, timestamp };
                case 'onStreamDetected':
                    return { eventType: 'stream-detected', newStreamIds: ['test-stream-1'], allStreamIds: ['test-stream-1'], detectionTime: 1000, connectionCount: 1 };
                default:
                    return base;
            }
        };

        for (const [handlerName, { eventType, dataKey }] of Object.entries(CANONICAL_HANDLER_MATRIX)) {
            it(`${handlerName} emits ${eventType} with payload data on the event bus`, () => {
                const handlers = service.createDefaultEventHandlers('twitch');
                const timestamp = '2024-06-15T12:00:00.000Z';
                const payload = createPayloadForHandler(handlerName, timestamp);

                handlers[handlerName](payload);

                const emitted = mockEventBus.emit.mock.calls.find(
                    ([, p]) => p?.type === eventType
                );
                expect(emitted).toBeTruthy();
                expect(emitted[1].platform).toBe('twitch');
                expect(emitted[1].data[dataKey]).toBeDefined();
            });
        }

        it('exposes exactly the canonical handler names and no legacy aliases', () => {
            const handlers = service.createDefaultEventHandlers('twitch');
            const handlerKeys = Object.keys(handlers).sort();

            expect(handlerKeys).toEqual([...CANONICAL_HANDLER_NAMES].sort());
            expect(handlers.onMembership).toBeUndefined();
        });

        it('onFollow emits using payload platform when provided', () => {
            const handlers = service.createDefaultEventHandlers('streamelements');
            const timestamp = '2024-06-15T12:00:00.000Z';

            handlers.onFollow({
                platform: 'youtube',
                username: 'test-user',
                userId: 'test-user-id',
                timestamp
            });

            const emitted = mockEventBus.emit.mock.calls.find(
                ([, p]) => p?.type === PlatformEvents.FOLLOW
            );
            expect(emitted).toBeTruthy();
            expect(emitted[1].platform).toBe('youtube');
            expect(emitted[1].data.platform).toBeUndefined();
        });

        for (const [handlerName, { requiresTimestamp, eventType }] of Object.entries(CANONICAL_HANDLER_MATRIX)) {
            if (!requiresTimestamp) continue;

            it(`${handlerName} suppresses emit when payload lacks timestamp`, () => {
                const handlers = service.createDefaultEventHandlers('twitch');
                const payload = createPayloadForHandler(handlerName, '2024-06-15T12:00:00.000Z');
                delete payload.timestamp;

                mockEventBus.emit.mockClear();
                handlers[handlerName](payload);

                const emitted = mockEventBus.emit.mock.calls.find(
                    ([, p]) => p?.type === eventType
                );
                expect(emitted).toBeUndefined();
            });
        }

        it('onStreamDetected emits without timestamp in payload', () => {
            const handlers = service.createDefaultEventHandlers('twitch');
            handlers.onStreamDetected({
                eventType: 'stream-detected',
                newStreamIds: ['test-stream-1'],
                allStreamIds: ['test-stream-1'],
                detectionTime: 1000,
                connectionCount: 1
            });

            const emitted = mockEventBus.emit.mock.calls.find(
                ([, p]) => p?.type === PlatformEvents.STREAM_DETECTED
            );
            expect(emitted).toBeTruthy();
            expect(emitted[1].platform).toBe('twitch');
        });

        it('onViewerCount suppresses emit when data is a raw number', () => {
            const handlers = service.createDefaultEventHandlers('twitch');

            mockEventBus.emit.mockClear();
            handlers.onViewerCount(42);

            const emitted = mockEventBus.emit.mock.calls.find(
                ([, p]) => p?.type === PlatformEvents.VIEWER_COUNT
            );
            expect(emitted).toBeUndefined();
        });

        it('onConnection updates lifecycle state without emitting through the event bus', () => {
            const handlers = service.createDefaultEventHandlers('twitch');

            testClock.set(1000);
            mockEventBus.emit.mockClear();

            handlers.onConnection({
                platform: 'twitch',
                status: 'connected',
                timestamp: new Date(testClock.now()).toISOString(),
                willReconnect: false
            });

            expect(service.getStatus().platformHealth.twitch.state).toBe('ready');
            expect(service.getPlatformConnectionTime('twitch')).toBe(testClock.now());
            expect(mockEventBus.emit).not.toHaveBeenCalled();
        });

        it('onConnection keeps platform instance registered while reconnect is expected', () => {
            const handlers = service.createDefaultEventHandlers('twitch');
            const livePlatform = { initialize: createMockFn(), cleanup: createMockFn(), on: createMockFn() };

            service.platforms.twitch = livePlatform;
            service.updatePlatformHealth('twitch', { state: 'ready' });
            testClock.set(1000);
            service.recordPlatformConnection('twitch');

            mockEventBus.emit.mockClear();
            handlers.onConnection({
                platform: 'twitch',
                status: 'disconnected',
                timestamp: new Date(testClock.now() + 1000).toISOString(),
                willReconnect: true,
                error: { message: 'socket dropped' }
            });

            expect(service.getStatus().platformHealth.twitch.state).toBe('disconnected');
            expect(service.getPlatform('twitch')).toBe(livePlatform);
            expect(service.getPlatformConnectionTime('twitch')).toBe(1000);
            expect(mockEventBus.emit).not.toHaveBeenCalled();
        });

        it('onConnection ignores late connection events after shutdown begins', () => {
            const handlers = service.createDefaultEventHandlers('twitch');

            service.shutdownRequested = true;
            service.updatePlatformHealth('twitch', { state: 'disconnected' });
            testClock.set(1000);
            mockEventBus.emit.mockClear();

            handlers.onConnection({
                platform: 'twitch',
                status: 'connected',
                timestamp: new Date(testClock.now()).toISOString(),
                willReconnect: false
            });

            expect(service.getStatus().platformHealth.twitch.state).toBe('disconnected');
            expect(service.getPlatformConnectionTime('twitch')).toBeNull();
            expect(mockEventBus.emit).not.toHaveBeenCalled();
        });
    });
});
