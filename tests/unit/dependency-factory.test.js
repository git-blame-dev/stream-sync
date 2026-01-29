
const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { DependencyFactory } = require('../../src/utils/dependency-factory');
const { PlatformConnectionFactory } = require('../../src/utils/platform-connection-factory');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../src/core/secrets');

describe('DependencyFactory', () => {
    afterEach(() => {
        restoreAllMocks();
        _resetForTesting();
        initializeStaticSecrets();
    });

    let factory;
    let configFixture;

    beforeEach(() => {
        factory = new DependencyFactory();

        configFixture = {
            general: { ignoreSelfMessages: false },
            youtube: {
                username: 'test-channel-username',
                enabled: true,
                ignoreSelfMessages: false
            },
            tiktok: {
                username: 'test-user',
                enabled: true,
                ignoreSelfMessages: false
            },
            twitch: {
                channel: 'test-channel',
                clientId: 'client-id',
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
                enabled: true,
                ignoreSelfMessages: false
            }
        };
    });

    describe('createYoutubeDependencies', () => {
        it('should create complete YouTube dependencies with all required services', () => {
            const options = {
                notificationManager: { emit: createMockFn() },
                streamDetectionService: { isLive: createMockFn() },
                config: configFixture
            };

            const result = factory.createYoutubeDependencies(configFixture.youtube, options);

            expect(result).toHaveProperty('logger');
            expect(result).toHaveProperty('notificationManager');
            expect(result).toHaveProperty('streamDetectionService');
            expect(result).toHaveProperty('apiClient');
            expect(result).toHaveProperty('connectionManager');

            expect(typeof result.logger.debug).toBe('function');
            expect(typeof result.logger.info).toBe('function');
            expect(typeof result.logger.warn).toBe('function');
            expect(typeof result.logger.error).toBe('function');
        });

        it('should require config in options', () => {
            expect(() => {
                factory.createYoutubeDependencies(configFixture.youtube, {});
            }).toThrow('createYoutubeDependencies requires config object in options');
        });

        it('should validate YouTube configuration before creating dependencies', () => {
            const invalidConfig = { enabled: true };

            expect(() => {
                factory.createYoutubeDependencies(invalidConfig, { config: configFixture });
            }).toThrow('YouTube username is required');
        });

        it('should create YouTube dependencies with proper validation', () => {
            const result = factory.createYoutubeDependencies(configFixture.youtube, { config: configFixture });

            expect(result.logger).toBeDefined();
            expect(result.apiClient).toBeDefined();
            expect(result.connectionManager).toBeDefined();
        });

        it('should pass options through to created dependencies', () => {
            const customOptions = {
                notificationManager: { emit: createMockFn() },
                retryAttempts: 5,
                timeout: 30000,
                config: configFixture
            };

            const result = factory.createYoutubeDependencies(configFixture.youtube, customOptions);

            expect(result.notificationManager).toBe(customOptions.notificationManager);
            expect(result.retryAttempts).toBe(5);
            expect(result.timeout).toBe(30000);
        });

        it('should require Innertube when youtubei stream detection is configured', () => {
            const youtubeiConfig = {
                ...configFixture.youtube,
                streamDetectionMethod: 'youtubei'
            };

            expect(() => {
                factory.createYoutubeDependencies(youtubeiConfig, { config: configFixture });
            }).toThrow(/Innertube dependency required/i);
        });

        it('should reuse injected stream detection service without recreating it', () => {
            const injectedService = { detectLiveStreams: createMockFn() };

            const result = factory.createYoutubeDependencies(configFixture.youtube, {
                streamDetectionService: injectedService,
                config: configFixture
            });

            expect(result.streamDetectionService).toBe(injectedService);
        });
    });

    describe('createTiktokDependencies', () => {
        it('should create complete TikTok dependencies with all required services', () => {
            const options = {
                notificationManager: { emit: createMockFn() },
                WebcastPushConnection: createMockFn(),
                TikTokWebSocketClient: createMockFn().mockImplementation(() => ({
                    connect: createMockFn().mockResolvedValue(true),
                    disconnect: createMockFn().mockResolvedValue(true),
                    on: createMockFn(),
                    removeAllListeners: createMockFn()
                })),
                config: configFixture
            };

            const result = factory.createTiktokDependencies(configFixture.tiktok, options);

            expect(result).toHaveProperty('logger');
            expect(result).toHaveProperty('notificationManager');
            expect(result).toHaveProperty('WebcastPushConnection');
            expect(result).toHaveProperty('TikTokWebSocketClient');
            expect(result).toHaveProperty('connectionFactory');
            expect(result).toHaveProperty('stateManager');

            expect(typeof result.logger.debug).toBe('function');
            expect(typeof result.logger.info).toBe('function');
            expect(typeof result.logger.warn).toBe('function');
            expect(typeof result.logger.error).toBe('function');
        });

        it('should require config in options', () => {
            expect(() => {
                factory.createTiktokDependencies(configFixture.tiktok, {});
            }).toThrow('createTikTokDependencies requires config object in options');
        });

        it('should validate TikTok configuration before creating dependencies', () => {
            const invalidConfig = { enabled: true };

            expect(() => {
                factory.createTiktokDependencies(invalidConfig, { config: configFixture });
            }).toThrow('TikTok username is required');
        });

        it('should create TikTok dependencies with proper validation', () => {
            const result = factory.createTiktokDependencies(configFixture.tiktok, { config: configFixture });

            expect(result.logger).toBeDefined();
            expect(result.connectionFactory).toBeDefined();
            expect(result.stateManager).toBeDefined();
        });

        it('should provide WebcastPushConnection from options', () => {
            const MockWebcastPushConnection = createMockFn();
            const options = {
                WebcastPushConnection: MockWebcastPushConnection,
                TikTokWebSocketClient: createMockFn().mockImplementation(() => ({
                    connect: createMockFn(),
                    disconnect: createMockFn(),
                    on: createMockFn(),
                    removeAllListeners: createMockFn()
                })),
                config: configFixture
            };

            const result = factory.createTiktokDependencies(configFixture.tiktok, options);

            expect(result.WebcastPushConnection).toBe(MockWebcastPushConnection);
        });

        it('should expose TikTokWebSocketClient so PlatformConnectionFactory can create connections', () => {
            const TikTokWebSocketClient = createMockFn().mockImplementation(() => ({
                connect: createMockFn().mockResolvedValue(true),
                disconnect: createMockFn().mockResolvedValue(true),
                on: createMockFn(),
                removeAllListeners: createMockFn()
            }));

            const result = factory.createTiktokDependencies(configFixture.tiktok, { TikTokWebSocketClient, config: configFixture });

            expect(typeof result.TikTokWebSocketClient).toBe('function');
            const manualConnection = new result.TikTokWebSocketClient(configFixture.tiktok.username, {});
            expect(manualConnection).toEqual(expect.objectContaining({
                connect: expect.any(Function)
            }));

            const platformFactory = new PlatformConnectionFactory(result.logger);

            expect(() => {
                platformFactory.createConnection('tiktok', configFixture.tiktok, result);
            }).not.toThrow();
        });
    });

    describe('createTwitchDependencies', () => {
        it('should create complete Twitch dependencies with all required services', () => {
            const options = {
                notificationManager: { emit: createMockFn() },
                tmiClient: { connect: createMockFn() },
                config: configFixture
            };

            const result = factory.createTwitchDependencies(configFixture.twitch, options);

            expect(result).toHaveProperty('logger');
            expect(result).toHaveProperty('notificationManager');
            expect(result).toHaveProperty('tmiClient');
            expect(result).toHaveProperty('authManager');
            expect(result).toHaveProperty('apiClient');

            expect(typeof result.logger.debug).toBe('function');
            expect(typeof result.logger.info).toBe('function');
            expect(typeof result.logger.warn).toBe('function');
            expect(typeof result.logger.error).toBe('function');
        });

        it('should require config in options', () => {
            expect(() => {
                factory.createTwitchDependencies(configFixture.twitch, {});
            }).toThrow('createTwitchDependencies requires config object in options');
        });

        it('should validate Twitch configuration before creating dependencies', () => {
            const invalidConfig = { enabled: true };

            expect(() => {
                factory.createTwitchDependencies(invalidConfig, { config: configFixture });
            }).toThrow('Twitch channel is required');
        });

        it('should create Twitch dependencies with proper validation', () => {
            const result = factory.createTwitchDependencies(configFixture.twitch, { config: configFixture });

            expect(result.logger).toBeDefined();
            expect(result.authManager).toBeDefined();
            expect(result.apiClient).toBeDefined();
        });

        it('should validate Twitch channel configuration', () => {
            const configWithoutChannel = { ...configFixture.twitch };
            delete configWithoutChannel.channel;

            expect(() => {
                factory.createTwitchDependencies(configWithoutChannel, { config: configFixture });
            }).toThrow('Twitch channel is required');
        });

        it('should retain injected authManager even when authFactory is also provided', () => {
            const injectedAuthManager = { initialize: createMockFn(), getState: createMockFn() };
            const injectedAuthFactory = { createAuthManager: createMockFn() };

            const result = factory.createTwitchDependencies(configFixture.twitch, {
                authManager: injectedAuthManager,
                authFactory: injectedAuthFactory,
                config: configFixture
            });

            expect(result.authManager).toBe(injectedAuthManager);
            expect(result.authFactory).toBe(injectedAuthFactory);
        });

        it('should build authManager from provided authFactory when authManager is missing', () => {
            const builtAuthManager = { initialize: createMockFn(), getState: createMockFn() };
            const providedFactory = {
                createAuthManager: createMockFn().mockReturnValue(builtAuthManager)
            };

            const result = factory.createTwitchDependencies(configFixture.twitch, {
                authFactory: providedFactory,
                config: configFixture
            });

            expect(result.authManager).toBe(builtAuthManager);
            expect(result.authFactory).toBe(providedFactory);
        });

        it('should create Twitch auth resources when none are provided', () => {
            const result = factory.createTwitchDependencies(configFixture.twitch, { config: configFixture });

            expect(result.authManager).toBeDefined();
            expect(typeof result.authManager.initialize).toBe('function');
            expect(result.authFactory).toBeDefined();
            expect(typeof result.authFactory.createAuthManager).toBe('function');
        });
    });

    describe('createValidatedLogger', () => {
        it('should create a logger with all required methods', () => {
            const logger = factory.createValidatedLogger('test');

            expect(typeof logger.debug).toBe('function');
            expect(typeof logger.info).toBe('function');
            expect(typeof logger.warn).toBe('function');
            expect(typeof logger.error).toBe('function');
        });

        it('should return a shared logger instance for different types', () => {
            const logger1 = factory.createValidatedLogger('youtube');
            const logger2 = factory.createValidatedLogger('tiktok');

            expect(logger1).toBe(logger2);
        });

        it('should validate logger interface after creation', () => {
            const logger = factory.createValidatedLogger('test');

            expect(() => {
                factory.validateDependencyInterface(logger, 'logger');
            }).not.toThrow();
        });

        it('should handle logger creation failures gracefully', () => {
            expect(() => {
                factory.createValidatedLogger(null);
            }).toThrow('Logger type is required');
        });
    });

    describe('validateDependencyInterface', () => {
        it('should validate logger interface correctly', () => {
            const validLogger = {
                debug: createMockFn(),
                info: createMockFn(),
                warn: createMockFn(),
                error: createMockFn()
            };

            expect(() => {
                factory.validateDependencyInterface(validLogger, 'logger');
            }).not.toThrow();
        });

        it('should reject invalid logger interface', () => {
            const invalidLogger = {
                debug: createMockFn(),
                info: createMockFn()
            };

            expect(() => {
                factory.validateDependencyInterface(invalidLogger, 'logger');
            }).toThrow('Logger interface validation failed');
        });

        it('should validate notification manager interface', () => {
            const validNotificationManager = {
                emit: createMockFn(),
                on: createMockFn(),
                removeListener: createMockFn()
            };

            expect(() => {
                factory.validateDependencyInterface(validNotificationManager, 'notificationManager');
            }).not.toThrow();
        });

        it('should reject invalid notification manager interface', () => {
            const invalidNotificationManager = {
                emit: createMockFn()
            };

            expect(() => {
                factory.validateDependencyInterface(invalidNotificationManager, 'notificationManager');
            }).toThrow('NotificationManager interface validation failed');
        });

        it('should handle unknown interface types', () => {
            expect(() => {
                factory.validateDependencyInterface({}, 'unknownInterface');
            }).toThrow('Unknown interface type: unknownInterface');
        });

        it('should validate that dependency is an object', () => {
            expect(() => {
                factory.validateDependencyInterface(null, 'logger');
            }).toThrow('Dependency must be an object');

            expect(() => {
                factory.validateDependencyInterface('string', 'logger');
            }).toThrow('Dependency must be an object');
        });
    });

    describe('Integration Tests', () => {
        it('should create all platform dependencies with consistent interfaces', () => {
            const youtubeDeps = factory.createYoutubeDependencies(configFixture.youtube, { config: configFixture });
            const tiktokDeps = factory.createTiktokDependencies(configFixture.tiktok, { config: configFixture });
            const twitchDeps = factory.createTwitchDependencies(configFixture.twitch, { config: configFixture });

            expect(typeof youtubeDeps.logger.debug).toBe('function');
            expect(typeof tiktokDeps.logger.debug).toBe('function');
            expect(typeof twitchDeps.logger.debug).toBe('function');

            expect(() => {
                factory.validateDependencyInterface(youtubeDeps.logger, 'logger');
                factory.validateDependencyInterface(tiktokDeps.logger, 'logger');
                factory.validateDependencyInterface(twitchDeps.logger, 'logger');
            }).not.toThrow();
        });

        it('should handle dependency creation errors gracefully', () => {
            const invalidConfig = {};

            expect(() => {
                factory.createYoutubeDependencies(invalidConfig, { config: configFixture });
            }).toThrow();

            expect(() => {
                factory.createTiktokDependencies(invalidConfig, { config: configFixture });
            }).toThrow();

            expect(() => {
                factory.createTwitchDependencies(invalidConfig, { config: configFixture });
            }).toThrow();
        });

        it('should maintain backward compatibility with existing platform creation', () => {
            const youtubeDeps = factory.createYoutubeDependencies(configFixture.youtube, { config: configFixture });
            const tiktokDeps = factory.createTiktokDependencies(configFixture.tiktok, { config: configFixture });
            const twitchDeps = factory.createTwitchDependencies(configFixture.twitch, { config: configFixture });

            expect(youtubeDeps).toHaveProperty('logger');
            expect(tiktokDeps).toHaveProperty('logger');
            expect(twitchDeps).toHaveProperty('logger');

            expect(youtubeDeps).toHaveProperty('apiClient');
            expect(tiktokDeps).toHaveProperty('WebcastPushConnection');
            expect(twitchDeps).toHaveProperty('authManager');
        });
    });

    describe('Error Handling', () => {
        it('should provide clear error messages for missing configuration', () => {
            expect(() => {
                factory.createYoutubeDependencies(null, { config: configFixture });
            }).toThrow('Configuration is required');

            expect(() => {
                factory.createTiktokDependencies(undefined, { config: configFixture });
            }).toThrow('Configuration is required');

            expect(() => {
                factory.createTwitchDependencies({}, { config: configFixture });
            }).toThrow('Twitch channel is required');
        });

        it('should provide clear error messages for invalid options', () => {
            expect(() => {
                factory.createYoutubeDependencies(configFixture.youtube, null);
            }).toThrow('Options must be an object');

            expect(() => {
                factory.createTiktokDependencies(configFixture.tiktok, 'invalid');
            }).toThrow('Options must be an object');
        });

        it('should fail fast with detailed error context', () => {
            const invalidConfig = { enabled: true };

            try {
                factory.createYoutubeDependencies(invalidConfig, { config: configFixture });
            } catch (error) {
                expect(error.message).toContain('YouTube username is required');
            }

            try {
                factory.createTiktokDependencies(invalidConfig, { config: configFixture });
            } catch (error) {
                expect(error.message).toContain('TikTok username is required');
            }
        });
    });

    describe('Configuration Validation', () => {
        it('should validate all required YouTube configuration fields', () => {
            _resetForTesting();
            secrets.youtube.apiKey = null;
            const configs = [
                { enabled: true },
                { enableAPI: true, username: 'test-channel' },
                { streamDetectionMethod: 'api', username: 'test-channel' },
                { viewerCountMethod: 'api', username: 'test-channel' }
            ];

            configs.forEach(config => {
                expect(() => {
                    factory.createYoutubeDependencies(config, { config: configFixture });
                }).toThrow();
            });
        });

        it('should validate all required TikTok configuration fields', () => {
            const configs = [
                { enabled: true },
                { username: '' },
                { username: null }
            ];

            configs.forEach(config => {
                expect(() => {
                    factory.createTiktokDependencies(config, { config: configFixture });
                }).toThrow();
            });
        });

        it('should validate all required Twitch configuration fields', () => {
            _resetForTesting();
            secrets.twitch.clientSecret = null;
            const configs = [
                { enabled: true },
                { channel: 'test' },
                { channel: 'test', clientId: 'test-client' },
                { channel: '', clientId: 'test-client' }
            ];

            configs.forEach(config => {
                expect(() => {
                    factory.createTwitchDependencies(config, { config: configFixture });
                }).toThrow();
            });
        });
    });
});
