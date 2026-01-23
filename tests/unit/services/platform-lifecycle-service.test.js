const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const PlatformLifecycleService = require('../../../src/services/PlatformLifecycleService');
const testClock = require('../../helpers/test-clock');

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
    let mockConfig;
    let mockStreamDetector;

    beforeEach(() => {
        mockEventBus = {
            emit: createMockFn(),
            subscribe: createMockFn().mockReturnValue(() => {})
        };

        mockConfig = {
            twitch: { enabled: false },
            youtube: { enabled: false },
            tiktok: { enabled: false }
        };

        mockStreamDetector = {
            startStreamDetection: createMockFn().mockImplementation(async (_platform, _config, connect) => {
                await connect();
            })
        };

        service = new PlatformLifecycleService({
            config: mockConfig,
            eventBus: mockEventBus,
            logger: noOpLogger,
            streamDetector: mockStreamDetector
        });
    });

    describe('Service Status Reporting', () => {
        it('reports ready platforms and stream statuses', async () => {
            mockConfig.twitch = {
                enabled: true,
                channel: 'test-channel',
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret'
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

            const streamDetector = {
                startStreamDetection: createMockFn().mockImplementation(async (_platform, _config, connect, statusCb) => {
                    statusCb('online', 'Stream detected');
                    await connect();
                })
            };

            service.dispose();
            service = new PlatformLifecycleService({
                config: mockConfig,
                eventBus: mockEventBus,
                logger: noOpLogger,
                streamDetector
            });

            await service.initializeAllPlatforms({ twitch: mockPlatformClass });

            const status = service.getStatus();
            expect(status.initializedPlatforms).toContain('twitch');
            expect(status.streamStatuses.twitch).toMatchObject({
                status: 'online',
                message: 'Stream detected'
            });
            expect(status.connectionTimes.twitch).toEqual(expect.any(Number));
        });

        it('reports failed platforms with error context', async () => {
            mockConfig.youtube = { enabled: true, username: 'channel' };

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
        });
    });

    afterEach(() => {
        if (service) {
            service.dispose();
        }
        clearAllMocks();
    });

    describe('Platform Initialization', () => {
        it('should initialize enabled platforms', async () => {
            mockConfig.twitch = {
                enabled: true,
                channel: 'test-channel',
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret'
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
                logger: noOpLogger,
                streamDetector: mockStreamDetector
            });

            const platformModules = {
                twitch: createMockFn()
            };

            const result = await localService.initializeAllPlatforms(platformModules, {});

            expect(result).toEqual({});
            expect(localService.isPlatformAvailable('twitch')).toBe(false);
        });

        it('should emit platform:initialized event when platform is ready', async () => {
            mockConfig.youtube = { enabled: true, username: 'test-channel' };

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
            mockConfig.twitch = { enabled: true };
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

        it('emits canonical platform events with timestamps', () => {
            const handlers = service.createDefaultEventHandlers('twitch');
            const timestamp = '2024-02-02T10:00:00.000Z';

            handlers.onChat({
                username: 'User',
                userId: 'user-1',
                message: { text: 'hello' },
                timestamp
            });
            handlers.onViewerCount({ count: 42, timestamp });

            const chatEvent = mockEventBus.emit.mock.calls.find(([, payload]) => payload?.type === 'platform:chat-message');
            expect(chatEvent).toBeTruthy();
            expect(chatEvent[1].data.timestamp).toBe(timestamp);

            const viewerEvent = mockEventBus.emit.mock.calls.find(([, payload]) => payload?.type === 'platform:viewer-count');
            expect(viewerEvent).toBeTruthy();
            expect(viewerEvent[1].data.count).toBe(42);
            expect(viewerEvent[1].data.timestamp).toBe(timestamp);

            expect(handlers.onMembership).toBeUndefined();
            expect(typeof handlers.onPaypiggy).toBe('function');
        });

        it('should validate PlatformClass is a constructor', async () => {
            mockConfig.twitch = { enabled: true };
            const platformModules = { twitch: null };

            await service.initializeAllPlatforms(platformModules, {});

            expect(service.isPlatformAvailable('twitch')).toBe(false);
            expect(service.getPlatform('twitch')).toBeNull();
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
                config: mockConfig,
                eventBus: mockEventBus,
                logger: noOpLogger,
                dependencyFactory: mockFactory,
                sharedDependencies: { test: 'value' }
            });

            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: createMockFn().mockResolvedValue(true),
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));
            const config = { test: 'config' };

            const instance = await service.createPlatformInstance('twitch', mockPlatformClass, config);

            expect(mockFactory.createTwitchDependencies).toHaveBeenCalledWith(config, { test: 'value' });
            expect(instance).toBeDefined();
            expect(typeof instance).toBe('object');
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

    describe('Stream Detection Coordination', () => {
        it('should connect YouTube directly without invoking StreamDetector (platform-managed detection)', async () => {
            mockConfig.youtube = { enabled: true, username: 'test-channel' };

            const platformInitSpy = createMockFn().mockResolvedValue(true);
            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: platformInitSpy,
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));

            const streamDetector = {
                startStreamDetection: createMockFn()
            };

            service.dispose();
            service = new PlatformLifecycleService({
                config: mockConfig,
                eventBus: mockEventBus,
                logger: noOpLogger,
                streamDetector
            });

            await service.initializeAllPlatforms({ youtube: mockPlatformClass });

            expect(streamDetector.startStreamDetection).not.toHaveBeenCalled();
            expect(platformInitSpy).toHaveBeenCalled();
            expect(service.isPlatformAvailable('youtube')).toBe(true);
        });
    });

    describe('Background Initialization', () => {
        it('should run TikTok initialization in background without blocking', async () => {
            mockConfig.tiktok = { enabled: true, username: 'streamer' };

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
        });
    });

    describe('Error Handling and Recovery', () => {
        it('marks platform failed when stream detection throws', async () => {
            mockConfig.custom = { enabled: true };

            const platformInitSpy = createMockFn().mockResolvedValue(true);
            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: platformInitSpy,
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));

            const streamDetector = {
                startStreamDetection: createMockFn().mockRejectedValue(new Error('detector failed'))
            };

            service.dispose();
            service = new PlatformLifecycleService({
                config: mockConfig,
                eventBus: mockEventBus,
                logger: noOpLogger,
                streamDetector
            });

            await service.initializeAllPlatforms({ custom: mockPlatformClass });

            expect(service.getStatus().failedPlatforms).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'custom',
                        lastError: expect.stringContaining('detector failed')
                    })
                ])
            );
        });

        it('marks platform failed when stream detection is unavailable', async () => {
            mockConfig.custom = { enabled: true };

            const platformInitSpy = createMockFn().mockResolvedValue(true);
            const mockPlatformClass = createMockFn().mockImplementation(() => ({
                initialize: platformInitSpy,
                cleanup: createMockFn().mockResolvedValue(),
                on: createMockFn()
            }));

            service.dispose();
            service = new PlatformLifecycleService({
                config: mockConfig,
                eventBus: mockEventBus,
                logger: noOpLogger,
                streamDetector: null
            });

            await service.initializeAllPlatforms({ custom: mockPlatformClass });

            expect(platformInitSpy).not.toHaveBeenCalled();
            expect(service.getStatus().failedPlatforms).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: 'custom',
                        lastError: expect.stringContaining('Stream detection unavailable')
                    })
                ])
            );
        });
    });

    describe('Platform Shutdown', () => {
        it('should cleanup all platforms gracefully on service shutdown', async () => {
            mockConfig.twitch = { enabled: true };

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
        });

        it('prefers cleanup even when a disconnect method exists', async () => {
            mockConfig.twitch = { enabled: true };

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
    });
});
