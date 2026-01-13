
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
    let mockLogger;
    let mockConfig;
    let mockStreamDetector;

    beforeEach(() => {
        // Create mock EventBus
        mockEventBus = {
            emit: jest.fn(),
            subscribe: jest.fn().mockReturnValue(() => {})
        };

        // Create mock Logger
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };

        // Create mock config
        mockConfig = {
            twitch: { enabled: false },
            youtube: { enabled: false },
            tiktok: { enabled: false }
        };

        mockStreamDetector = {
            startStreamDetection: jest.fn().mockImplementation(async (_platform, _config, connect) => {
                await connect();
            })
        };

        // Create service instance
        service = new PlatformLifecycleService({
            config: mockConfig,
            eventBus: mockEventBus,
            logger: mockLogger,
            streamDetector: mockStreamDetector
        });
    });

    describe('Service Status Reporting', () => {
        it('reports ready platforms and stream statuses', async () => {
            mockConfig.twitch = { enabled: true, apiKey: 'key' };

            const mockPlatformClass = jest.fn().mockImplementation(() => ({
                initialize: jest.fn().mockImplementation(async (handlers) => {
                    if (handlers.onChat) {
                        await handlers.onChat({ message: { text: 'ready' } });
                    }
                }),
                cleanup: jest.fn().mockResolvedValue(),
                on: jest.fn()
            }));

            const streamDetector = {
                startStreamDetection: jest.fn().mockImplementation(async (_platform, _config, connect, statusCb) => {
                    statusCb('online', 'Stream detected');
                    await connect();
                })
            };

            service.dispose();
            service = new PlatformLifecycleService({
                config: mockConfig,
                eventBus: mockEventBus,
                logger: mockLogger,
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

            const mockPlatformClass = jest.fn().mockImplementation(() => ({
                initialize: jest.fn().mockRejectedValue(new Error('connect failed')),
                cleanup: jest.fn().mockResolvedValue(),
                on: jest.fn()
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
    });

    describe('Platform Initialization', () => {
        it('should initialize enabled platforms', async () => {
            // Given: Twitch is enabled
            mockConfig.twitch = { enabled: true, apiKey: 'test-key' };

            const mockPlatformClass = jest.fn().mockImplementation(() => ({
                initialize: jest.fn().mockResolvedValue(true),
                cleanup: jest.fn().mockResolvedValue(),
                on: jest.fn()
            }));

            const platformModules = {
                twitch: mockPlatformClass
            };

            const eventHandlers = {
                default: {}
            };

            // When: Platforms are initialized
            const result = await service.initializeAllPlatforms(platformModules, eventHandlers);

            // Then: Twitch platform should be created and available
            expect(result.twitch).toBeDefined();
            expect(result.twitch.initialize).toBeDefined();
        });

        it('should skip disabled platforms', async () => {
            // Given: All platforms disabled
            const mockPlatformClass = jest.fn();

            const platformModules = {
                twitch: mockPlatformClass,
                youtube: mockPlatformClass
            };

            // When: Platforms are initialized
            const result = await service.initializeAllPlatforms(platformModules, {});

            // Then: No platforms should be initialized
            expect(result).toEqual({});
            expect(service.isPlatformAvailable('twitch')).toBe(false);
            expect(service.isPlatformAvailable('youtube')).toBe(false);
        });

        it('should handle missing config safely', async () => {
            const localService = new PlatformLifecycleService({
                eventBus: mockEventBus,
                logger: mockLogger,
                streamDetector: mockStreamDetector
            });

            const platformModules = {
                twitch: jest.fn()
            };

            const result = await localService.initializeAllPlatforms(platformModules, {});

            expect(result).toEqual({});
            expect(localService.isPlatformAvailable('twitch')).toBe(false);
        });

        it('should emit platform:initialized event when platform is ready', async () => {
            // Given: YouTube is enabled
            mockConfig.youtube = { enabled: true, username: 'test-channel' };

            const mockPlatformClass = jest.fn().mockImplementation(() => ({
                initialize: jest.fn().mockResolvedValue(true),
                cleanup: jest.fn().mockResolvedValue(),
                on: jest.fn()
            }));

            const platformModules = {
                youtube: mockPlatformClass
            };

            // When: Platform initializes
            await service.initializeAllPlatforms(platformModules, { default: {} });

            // Then: YouTube platform should be initialized and available
            expect(service.isPlatformAvailable('youtube')).toBe(true);
            expect(service.getPlatform('youtube')).toBeDefined();
            expect(service.getPlatformConnectionTime('youtube')).toBeGreaterThan(0);
        });

        it('should emit EventBus platform events when default handlers are used', async () => {
            mockConfig.twitch = { enabled: true };
            const timestamp = new Date().toISOString();

            const mockPlatformClass = jest.fn().mockImplementation(() => ({
                initialize: jest.fn().mockImplementation((handlers) => {
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
                cleanup: jest.fn().mockResolvedValue(),
                on: jest.fn()
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
            // Given: Invalid platform class
            mockConfig.twitch = { enabled: true };

            const platformModules = {
                twitch: null // Invalid
            };

            // When: Initialization is attempted
            await service.initializeAllPlatforms(platformModules, {});

            // Then: Platform should NOT be initialized due to validation failure
            expect(service.isPlatformAvailable('twitch')).toBe(false);
            expect(service.getPlatform('twitch')).toBeNull();
        });
    });

    describe('Platform Instance Creation', () => {
        it('should create platform instance without DI when no factory', async () => {
            // Given: Service has no dependency factory
            const mockPlatformClass = jest.fn().mockImplementation(() => ({
                initialize: jest.fn().mockResolvedValue(true),
                cleanup: jest.fn().mockResolvedValue(),
                on: jest.fn()
            }));
            const config = { test: 'config' };

            // When: Platform instance is created
            const instance = await service.createPlatformInstance('twitch', mockPlatformClass, config);

            // Then: Platform instance should be created successfully
            expect(instance).toBeDefined();
            expect(typeof instance).toBe('object');
        });

        it('should use factory method when available', async () => {
            // Given: Service has dependency factory with createTwitchDependencies
            const mockDependencies = { auth: 'mock' };
            const mockFactory = {
                createTwitchDependencies: jest.fn().mockReturnValue(mockDependencies)
            };

            service.dispose();
            service = new PlatformLifecycleService({
                config: mockConfig,
                eventBus: mockEventBus,
                logger: mockLogger,
                dependencyFactory: mockFactory,
                sharedDependencies: { test: 'value' }
            });

            const mockPlatformClass = jest.fn().mockImplementation(() => ({
                initialize: jest.fn().mockResolvedValue(true),
                cleanup: jest.fn().mockResolvedValue(),
                on: jest.fn()
            }));
            const config = { test: 'config' };

            // When: Platform instance is created
            const instance = await service.createPlatformInstance('twitch', mockPlatformClass, config);

            // Then: Platform instance should be created with DI
            expect(mockFactory.createTwitchDependencies).toHaveBeenCalledWith(config, { test: 'value' });
            expect(instance).toBeDefined();
            expect(typeof instance).toBe('object');
        });

        it('should fallback gracefully if factory method missing', async () => {
            // Given: Factory exists but no method for platform
            service.dependencyFactory = {};

            const mockPlatformClass = jest.fn().mockImplementation(() => ({
                initialize: jest.fn().mockResolvedValue(true),
                cleanup: jest.fn().mockResolvedValue(),
                on: jest.fn()
            }));
            const config = { test: 'config' };

            // When: Platform instance is created for platform without factory method
            const instance = await service.createPlatformInstance('unknown', mockPlatformClass, config);

            // Then: Platform should still be created (graceful fallback)
            expect(instance).toBeDefined();
            expect(typeof instance).toBe('object');
        });
    });

    describe('Connection State Tracking', () => {
        it('should record platform connection time', () => {
            // Given: Platform connects
            const platformName = 'twitch';

            // When: Connection is recorded
            service.recordPlatformConnection(platformName);

            // Then: Connection time should be stored
            const connectionTime = service.getPlatformConnectionTime(platformName);
            expect(connectionTime).toBeGreaterThan(0);
            expect(typeof connectionTime).toBe('number');
        });

        it('should check if platform is available', () => {
            // Given: Platform is initialized
            service.platforms = { twitch: { connected: true } };

            // When: Availability is checked
            const isAvailable = service.isPlatformAvailable('twitch');

            // Then: Should return true
            expect(isAvailable).toBe(true);
        });

        it('should return false for unavailable platform', () => {
            // When: Checking non-existent platform
            const isAvailable = service.isPlatformAvailable('nonexistent');

            // Then: Should return false
            expect(isAvailable).toBe(false);
        });

        it('should get platform instance', () => {
            // Given: Platform exists
            const mockPlatform = { name: 'twitch' };
            service.platforms = { twitch: mockPlatform };

            // When: Getting platform
            const platform = service.getPlatform('twitch');

            // Then: Should return platform
            expect(platform).toBe(mockPlatform);
        });

        it('should return null for non-existent platform', () => {
            // When: Getting non-existent platform
            const platform = service.getPlatform('nonexistent');

            // Then: Should return null
            expect(platform).toBeNull();
        });
    });

    describe('Resource Cleanup', () => {
        it('should dispose resources when service stops', () => {
            // Given: Service with platforms
            service.platforms = { twitch: {}, youtube: {} };
            service.platformConnectionTimes = { twitch: testClock.now() };
            service.backgroundPlatformInits = [{ promise: Promise.resolve() }];

            // When: dispose() is called
            service.dispose();

            // Then: All resources should be cleared
            expect(Object.keys(service.platforms).length).toBe(0);
            expect(Object.keys(service.platformConnectionTimes).length).toBe(0);
            expect(service.backgroundPlatformInits.length).toBe(0);
        });
    });

    describe('Stream Detection Coordination', () => {
        it('should connect YouTube directly without invoking StreamDetector (platform-managed detection)', async () => {
            mockConfig.youtube = { enabled: true, username: 'test-channel' };

            const platformInitSpy = jest.fn().mockResolvedValue(true);
            const mockPlatformClass = jest.fn().mockImplementation(() => ({
                initialize: platformInitSpy,
                cleanup: jest.fn().mockResolvedValue(),
                on: jest.fn()
            }));

            const streamDetector = {
                startStreamDetection: jest.fn()
            };

            service.dispose();
            service = new PlatformLifecycleService({
                config: mockConfig,
                eventBus: mockEventBus,
                logger: mockLogger,
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
            const platformInitSpy = jest.fn().mockImplementation(() => deferred.promise);
            const mockPlatformClass = jest.fn().mockImplementation(() => ({
                initialize: platformInitSpy,
                cleanup: jest.fn().mockResolvedValue(),
                on: jest.fn()
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
        it('should handle platform initialization failures gracefully for stream-detector-managed platforms', async () => {
            mockConfig.custom = { enabled: true };

            const platformInitSpy = jest.fn().mockResolvedValue(true);
            const mockPlatformClass = jest.fn().mockImplementation(() => ({
                initialize: platformInitSpy,
                cleanup: jest.fn().mockResolvedValue(),
                on: jest.fn()
            }));

            const streamDetector = {
                startStreamDetection: jest.fn().mockRejectedValue(new Error('detector failed'))
            };

            service.dispose();
            service = new PlatformLifecycleService({
                config: mockConfig,
                eventBus: mockEventBus,
                logger: mockLogger,
                streamDetector
            });

            await service.initializeAllPlatforms({ custom: mockPlatformClass });

            expect(streamDetector.startStreamDetection).toHaveBeenCalled();
            expect(platformInitSpy).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Failed to start stream detection for custom'),
                'PlatformLifecycleService',
                expect.objectContaining({
                    error: expect.stringContaining('detector failed'),
                    eventType: 'stream-detection'
                })
            );
        });

        it('marks platform failed when stream detection is unavailable', async () => {
            mockConfig.custom = { enabled: true };

            const platformInitSpy = jest.fn().mockResolvedValue(true);
            const mockPlatformClass = jest.fn().mockImplementation(() => ({
                initialize: platformInitSpy,
                cleanup: jest.fn().mockResolvedValue(),
                on: jest.fn()
            }));

            service.dispose();
            service = new PlatformLifecycleService({
                config: mockConfig,
                eventBus: mockEventBus,
                logger: mockLogger,
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

            const cleanupSpy = jest.fn().mockResolvedValue();
            const mockPlatformClass = jest.fn().mockImplementation(() => ({
                initialize: jest.fn().mockResolvedValue(true),
                cleanup: cleanupSpy,
                on: jest.fn()
            }));

            await service.initializeAllPlatforms({ twitch: mockPlatformClass });

            await service.disconnectAll();

            expect(cleanupSpy).toHaveBeenCalled();
            expect(service.isPlatformAvailable('twitch')).toBe(false);
        });

        it('prefers cleanup even when a disconnect method exists', async () => {
            mockConfig.twitch = { enabled: true };

            const cleanupSpy = jest.fn().mockResolvedValue();
            const disconnectSpy = jest.fn().mockResolvedValue();
            const mockPlatformClass = jest.fn().mockImplementation(() => ({
                initialize: jest.fn().mockResolvedValue(true),
                cleanup: cleanupSpy,
                disconnect: disconnectSpy,
                on: jest.fn()
            }));

            await service.initializeAllPlatforms({ twitch: mockPlatformClass });
            await service.disconnectAll();

            expect(cleanupSpy).toHaveBeenCalled();
            expect(disconnectSpy).not.toHaveBeenCalled();
            expect(service.isPlatformAvailable('twitch')).toBe(false);
        });
    });
});
