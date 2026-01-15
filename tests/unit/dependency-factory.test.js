
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { DependencyFactory } = require('../../src/utils/dependency-factory');
const { PlatformConnectionFactory } = require('../../src/utils/platform-connection-factory');

describe('DependencyFactory', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let factory;
    let mockConfig;
    let mockLogger;

    beforeEach(() => {
        factory = new DependencyFactory();
        
        mockConfig = {
            youtube: {
                apiKey: 'test-youtube-key',
                username: 'test-channel-username',
                enabled: true
            },
            tiktok: {
                username: 'test-user',
                enabled: true
            },
            twitch: {
                apiKey: 'test-twitch-key',
                channel: 'test-channel',
                clientId: 'client-id',
                clientSecret: 'client-secret',
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
                enabled: true
            }
        };

        mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
    });

    describe('createYoutubeDependencies', () => {
        it('should create complete YouTube dependencies with all required services', () => {
            const options = {
                notificationManager: { emit: createMockFn() },
                streamDetectionService: { isLive: createMockFn() }
            };

            const result = factory.createYoutubeDependencies(mockConfig.youtube, options);

            // Verify all required YouTube dependencies are present
            expect(result).toHaveProperty('logger');
            expect(result).toHaveProperty('notificationManager');
            expect(result).toHaveProperty('streamDetectionService');
            expect(result).toHaveProperty('apiClient');
            expect(result).toHaveProperty('connectionManager');
            
            // Verify logger has correct interface
            expect(typeof result.logger.debug).toBe('function');
            expect(typeof result.logger.info).toBe('function');
            expect(typeof result.logger.warn).toBe('function');
            expect(typeof result.logger.error).toBe('function');
        });

        it('should validate YouTube configuration before creating dependencies', () => {
            const invalidConfig = { enabled: true }; // Missing apiKey and username

            expect(() => {
                factory.createYoutubeDependencies(invalidConfig, {});
            }).toThrow('YouTube username is required');
        });

        it('should create YouTube dependencies with proper validation', () => {
            const result = factory.createYoutubeDependencies(mockConfig.youtube, {});

            expect(result.logger).toBeDefined();
            expect(result.apiClient).toBeDefined();
            expect(result.connectionManager).toBeDefined();
        });

        it('should pass options through to created dependencies', () => {
            const customOptions = {
                notificationManager: { emit: createMockFn() },
                retryAttempts: 5,
                timeout: 30000
            };

            const result = factory.createYoutubeDependencies(mockConfig.youtube, customOptions);

            expect(result.notificationManager).toBe(customOptions.notificationManager);
            expect(result.retryAttempts).toBe(5);
            expect(result.timeout).toBe(30000);
        });

        it('should require Innertube when youtubei stream detection is configured', () => {
            const youtubeiConfig = {
                ...mockConfig.youtube,
                streamDetectionMethod: 'youtubei'
            };

            expect(() => {
                factory.createYoutubeDependencies(youtubeiConfig, {});
            }).toThrow(/Innertube dependency required/i);
        });

        it('should reuse injected stream detection service without recreating it', () => {
            const injectedService = { detectLiveStreams: createMockFn() };
            const spy = spyOn(DependencyFactory.prototype, '_createYouTubeStreamDetectionService');

            const result = factory.createYoutubeDependencies(mockConfig.youtube, {
                streamDetectionService: injectedService
            });

            expect(result.streamDetectionService).toBe(injectedService);
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
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
                }))
            };

            const result = factory.createTiktokDependencies(mockConfig.tiktok, options);

            // Verify all required TikTok dependencies are present
            expect(result).toHaveProperty('logger');
            expect(result).toHaveProperty('notificationManager');
            expect(result).toHaveProperty('WebcastPushConnection');
            expect(result).toHaveProperty('TikTokWebSocketClient');
            expect(result).toHaveProperty('connectionFactory');
            expect(result).toHaveProperty('stateManager');
            
            // Verify logger has correct interface
            expect(typeof result.logger.debug).toBe('function');
            expect(typeof result.logger.info).toBe('function');
            expect(typeof result.logger.warn).toBe('function');
            expect(typeof result.logger.error).toBe('function');
        });

        it('should validate TikTok configuration before creating dependencies', () => {
            const invalidConfig = { enabled: true }; // Missing username

            expect(() => {
                factory.createTiktokDependencies(invalidConfig, {});
            }).toThrow('TikTok username is required');
        });

        it('should create TikTok dependencies with proper validation', () => {
            const result = factory.createTiktokDependencies(mockConfig.tiktok, {});

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
                }))
            };

            const result = factory.createTiktokDependencies(mockConfig.tiktok, options);

            expect(result.WebcastPushConnection).toBe(MockWebcastPushConnection);
        });

        it('should expose TikTokWebSocketClient so PlatformConnectionFactory can create connections', () => {
            const TikTokWebSocketClient = createMockFn().mockImplementation(() => ({
                connect: createMockFn().mockResolvedValue(true),
                disconnect: createMockFn().mockResolvedValue(true),
                on: createMockFn(),
                removeAllListeners: createMockFn()
            }));

            const result = factory.createTiktokDependencies(mockConfig.tiktok, { TikTokWebSocketClient });

            expect(typeof result.TikTokWebSocketClient).toBe('function');
            const manualConnection = new result.TikTokWebSocketClient(mockConfig.tiktok.username, {});
            expect(manualConnection).toEqual(expect.objectContaining({
                connect: expect.any(Function)
            }));

            const platformFactory = new PlatformConnectionFactory(result.logger);

            expect(() => {
                platformFactory.createConnection('tiktok', mockConfig.tiktok, result);
            }).not.toThrow();
        });
    });

    describe('createTwitchDependencies', () => {
        it('should create complete Twitch dependencies with all required services', () => {
            const options = {
                notificationManager: { emit: createMockFn() },
                tmiClient: { connect: createMockFn() }
            };

            const result = factory.createTwitchDependencies(mockConfig.twitch, options);

            // Verify all required Twitch dependencies are present
            expect(result).toHaveProperty('logger');
            expect(result).toHaveProperty('notificationManager');
            expect(result).toHaveProperty('tmiClient');
            expect(result).toHaveProperty('authManager');
            expect(result).toHaveProperty('apiClient');
            
            // Verify logger has correct interface
            expect(typeof result.logger.debug).toBe('function');
            expect(typeof result.logger.info).toBe('function');
            expect(typeof result.logger.warn).toBe('function');
            expect(typeof result.logger.error).toBe('function');
        });

        it('should validate Twitch configuration before creating dependencies', () => {
            const invalidConfig = { enabled: true }; // Missing apiKey and channel

            expect(() => {
                factory.createTwitchDependencies(invalidConfig, {});
            }).toThrow('Twitch API key is required');
        });

        it('should create Twitch dependencies with proper validation', () => {
            const result = factory.createTwitchDependencies(mockConfig.twitch, {});

            expect(result.logger).toBeDefined();
            expect(result.authManager).toBeDefined();
            expect(result.apiClient).toBeDefined();
        });

        it('should validate Twitch channel configuration', () => {
            const configWithoutChannel = { ...mockConfig.twitch };
            delete configWithoutChannel.channel;

            expect(() => {
                factory.createTwitchDependencies(configWithoutChannel, {});
            }).toThrow('Twitch channel is required');
        });

        it('should retain injected authManager even when authFactory is also provided', () => {
            const injectedAuthManager = { initialize: createMockFn(), getState: createMockFn() };
            const injectedAuthFactory = { createAuthManager: createMockFn() };

            const result = factory.createTwitchDependencies(mockConfig.twitch, {
                authManager: injectedAuthManager,
                authFactory: injectedAuthFactory
            });

            expect(result.authManager).toBe(injectedAuthManager);
            expect(result.authFactory).toBe(injectedAuthFactory);
            expect(injectedAuthFactory.createAuthManager).not.toHaveBeenCalled();
        });

        it('should build authManager from provided authFactory when authManager is missing', () => {
            const builtAuthManager = { initialize: createMockFn(), getState: createMockFn() };
            const providedFactory = {
                createAuthManager: createMockFn().mockReturnValue(builtAuthManager)
            };

            const result = factory.createTwitchDependencies(mockConfig.twitch, {
                authFactory: providedFactory
            });

            expect(result.authManager).toBe(builtAuthManager);
            expect(result.authFactory).toBe(providedFactory);
            expect(providedFactory.createAuthManager).toHaveBeenCalledTimes(1);
        });

        it('should create Twitch auth resources when none are provided', () => {
            const result = factory.createTwitchDependencies(mockConfig.twitch, {});

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

            // Should not throw - logger should be valid
            expect(() => {
                factory.validateDependencyInterface(logger, 'logger');
            }).not.toThrow();
        });

        it('should handle logger creation failures gracefully', () => {
            // Test with invalid type that might cause logger creation to fail
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
                // Missing warn and error methods
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
                // Missing on and removeListener methods
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
            const youtubeDeps = factory.createYoutubeDependencies(mockConfig.youtube, {});
            const tiktokDeps = factory.createTiktokDependencies(mockConfig.tiktok, {});
            const twitchDeps = factory.createTwitchDependencies(mockConfig.twitch, {});

            // All should have loggers with same interface
            expect(typeof youtubeDeps.logger.debug).toBe('function');
            expect(typeof tiktokDeps.logger.debug).toBe('function');
            expect(typeof twitchDeps.logger.debug).toBe('function');

            // All should pass interface validation
            expect(() => {
                factory.validateDependencyInterface(youtubeDeps.logger, 'logger');
                factory.validateDependencyInterface(tiktokDeps.logger, 'logger');
                factory.validateDependencyInterface(twitchDeps.logger, 'logger');
            }).not.toThrow();
        });

        it('should handle dependency creation errors gracefully', () => {
            const invalidConfig = {}; // No required fields

            expect(() => {
                factory.createYoutubeDependencies(invalidConfig, {});
            }).toThrow();

            expect(() => {
                factory.createTiktokDependencies(invalidConfig, {});
            }).toThrow();

            expect(() => {
                factory.createTwitchDependencies(invalidConfig, {});
            }).toThrow();
        });

        it('should maintain backward compatibility with existing platform creation', () => {
            // Test that created dependencies can be used with existing platform constructors
            const youtubeDeps = factory.createYoutubeDependencies(mockConfig.youtube, {});
            const tiktokDeps = factory.createTiktokDependencies(mockConfig.tiktok, {});
            const twitchDeps = factory.createTwitchDependencies(mockConfig.twitch, {});

            // Dependencies should have properties expected by platform constructors
            expect(youtubeDeps).toHaveProperty('logger');
            expect(tiktokDeps).toHaveProperty('logger');
            expect(twitchDeps).toHaveProperty('logger');

            // Each platform should have its specific dependencies
            expect(youtubeDeps).toHaveProperty('apiClient');
            expect(tiktokDeps).toHaveProperty('WebcastPushConnection');
            expect(twitchDeps).toHaveProperty('authManager');
        });
    });

    describe('Error Handling', () => {
        it('should provide clear error messages for missing configuration', () => {
            expect(() => {
                factory.createYoutubeDependencies(null, {});
            }).toThrow('Configuration is required');

            expect(() => {
                factory.createTiktokDependencies(undefined, {});
            }).toThrow('Configuration is required');

            expect(() => {
                factory.createTwitchDependencies({}, {});
            }).toThrow('Twitch API key is required');
        });

        it('should provide clear error messages for invalid options', () => {
            expect(() => {
                factory.createYoutubeDependencies(mockConfig.youtube, null);
            }).toThrow('Options must be an object');

            expect(() => {
                factory.createTiktokDependencies(mockConfig.tiktok, 'invalid');
            }).toThrow('Options must be an object');
        });

        it('should fail fast with detailed error context', () => {
            const invalidConfig = { enabled: true }; // Missing required fields

            try {
                factory.createYoutubeDependencies(invalidConfig, {});
            } catch (error) {
                expect(error.message).toContain('YouTube username is required');
            }

            try {
                factory.createTiktokDependencies(invalidConfig, {});
            } catch (error) {
                expect(error.message).toContain('TikTok username is required');
            }
        });
    });

    describe('Configuration Validation', () => {
        it('should validate all required YouTube configuration fields', () => {
            const configs = [
                { enabled: true }, // Missing username
                { apiKey: 'test' }, // Missing username
                { enableAPI: true, username: 'test-channel' } // Missing apiKey when enableAPI=true
            ];

            configs.forEach(config => {
                expect(() => {
                    factory.createYoutubeDependencies(config, {});
                }).toThrow();
            });
        });

        it('should validate all required TikTok configuration fields', () => {
            const configs = [
                { enabled: true }, // Missing username
                { username: '' }, // Empty username
                { username: null }, // Null username
            ];

            configs.forEach(config => {
                expect(() => {
                    factory.createTiktokDependencies(config, {});
                }).toThrow();
            });
        });

        it('should validate all required Twitch configuration fields', () => {
            const configs = [
                { enabled: true }, // Missing apiKey and channel
                { apiKey: 'test' }, // Missing channel
                { channel: 'test' }, // Missing apiKey
                { apiKey: '', channel: 'test' }, // Empty apiKey
                { apiKey: 'test', channel: '' }, // Empty channel
            ];

            configs.forEach(config => {
                expect(() => {
                    factory.createTwitchDependencies(config, {});
                }).toThrow();
            });
        });
    });
});
