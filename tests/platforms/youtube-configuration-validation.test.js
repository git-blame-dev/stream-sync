
const { initializeTestLogging, createMockPlatformDependencies, createMockConfig } = require('../helpers/test-setup');

// Initialize logging for tests
initializeTestLogging();

const { YouTubePlatform } = require('../../src/platforms/youtube');

describe('YouTube Platform Configuration Validation', () => {
    let mockDependencies;
    
    beforeEach(() => {
        mockDependencies = createMockPlatformDependencies('youtube');
    });
    
    describe('Configuration Key Normalization (After Refactor)', () => {
        test('should handle config with apiKey (camelCase)', async () => {
            const configWithCamelCase = createMockConfig('youtube', {
                enabled: true,
                username: 'testuser',
                apiKey: 'valid-api-key-here' // Config uses camelCase
            });
            
            const platform = new YouTubePlatform(configWithCamelCase, mockDependencies);
            
            // Test that platform was created successfully with valid config
            expect(platform).toBeDefined();
            expect(typeof platform).toBe('object');
        });
    });
    
    describe('Configuration Validation Edge Cases', () => {
        test('should handle missing API key gracefully', async () => {
            const configWithoutApiKey = createMockConfig('youtube', {
                enabled: true,
                username: 'testuser'
                // No apiKey
            });
            
            const platform = new YouTubePlatform(configWithoutApiKey, mockDependencies);
            
            // Should create platform but not throw error with missing API key
            expect(platform).toBeDefined();
            expect(typeof platform).toBe('object');
        });
        
        test('should handle disabled platform', async () => {
            const disabledConfig = createMockConfig('youtube', {
                enabled: false,
                username: 'testuser',
                apiKey: 'valid-api-key'
            });
            
            const platform = new YouTubePlatform(disabledConfig, mockDependencies);
            
            // Should create platform successfully even when disabled
            expect(platform).toBeDefined();
            expect(typeof platform).toBe('object');
        });
        
        test('should handle missing username', async () => {
            const configWithoutUsername = createMockConfig('youtube', {
                enabled: true,
                apiKey: 'valid-api-key'
                // No username
            });
            
            const platform = new YouTubePlatform(configWithoutUsername, mockDependencies);
            
            // Should handle missing username appropriately
            expect(platform).toBeDefined();
            expect(typeof platform).toBe('object');
        });
    });

    describe('Configuration Normalization', () => {
        test('should honor INI-like numeric strings for retryAttempts and streamPollingInterval', () => {
            const platform = new YouTubePlatform(
                createMockConfig('youtube', {
                    retryAttempts: '4',
                    streamPollingInterval: '30'
                }),
                mockDependencies
            );

            expect(platform.config.retryAttempts).toBe(4);
            expect(platform.config.streamPollingInterval).toBe(30);
        });
    });

    describe('Configuration fixes and logging surface', () => {
        test('surfaces configuration fixes through the platform error handler when values are invalid', () => {
            const platform = new YouTubePlatform(
                createMockConfig('youtube', {
                    enabled: true,
                    username: 'channel-owner',
                    retryAttempts: 'invalid',
                    maxStreams: -1,
                    streamPollingInterval: 0,
                    fullCheckInterval: 'bad'
                }),
                mockDependencies
            );

            const errorHandler = {
                handleConfigurationError: jest.fn(),
                handleEventProcessingError: jest.fn(),
                handleConnectionError: jest.fn(),
                handleCleanupError: jest.fn()
            };

            platform.errorHandler = errorHandler;
            platform.config.retryAttempts = 'invalid';
            platform.config.maxStreams = -5;
            platform.config.streamPollingInterval = 'nan';
            platform.config.fullCheckInterval = undefined;

            platform._validateAndFixConfiguration();

            expect(errorHandler.handleConfigurationError).toHaveBeenCalled();
        });

        test('initializes disabled platform without errors', async () => {
            const logger = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn()
            };

            const platform = new YouTubePlatform(
                createMockConfig('youtube', { enabled: false, username: '' }),
                { ...mockDependencies, logger }
            );

            await platform.initialize();

            // Should initialize without errors and not start monitoring
            expect(platform.isInitialized).toBe(true);
            expect(platform.monitoringInterval).toBeFalsy();
        });
    });

    describe('Dependency Validation', () => {
        const baseConfig = createMockConfig('youtube', {
            enabled: true,
            username: 'channel-owner',
            apiKey: 'valid-api-key'
        });

        test('should fail fast when stream detection service is missing', () => {
            const dependenciesWithoutDetection = {
                ...createMockPlatformDependencies('youtube'),
                streamDetectionService: null,
                forceStreamDetectionValidation: true
            };

            const createPlatform = () => new YouTubePlatform(baseConfig, dependenciesWithoutDetection);

            expect(createPlatform).toThrow(/stream detection/i);
        });

        test('should accept dependencies that include a stream detection service', async () => {
            const detectionResult = ['live-stream-123'];
            const dependenciesWithDetection = createMockPlatformDependencies('youtube', {
                streamDetectionService: {
                    detectLiveStreams: jest.fn().mockResolvedValue({
                        success: true,
                        videoIds: detectionResult
                    })
                }
            });

            const platform = new YouTubePlatform(baseConfig, dependenciesWithDetection);
            const videoIds = await platform.getLiveVideoIdsByYoutubei();

            expect(videoIds).toEqual(detectionResult);
        });

        test('should surface data logging path errors via error handler', () => {
            const mkdirMock = jest.spyOn(require('fs'), 'mkdirSync').mockImplementation(() => {
                throw new Error('disk full');
            });

            const dependencies = createMockPlatformDependencies('youtube', {
                streamDetectionService: {
                    detectLiveStreams: jest.fn().mockResolvedValue({ success: true, videoIds: [] })
                }
            });

            const platform = new YouTubePlatform(baseConfig, dependencies);
            const errorSpy = jest.fn();
            platform.errorHandler = {
                handleConfigurationError: errorSpy
            };

            platform._ensureDataLoggingPath();

            expect(errorSpy).toHaveBeenCalled();
            mkdirMock.mockRestore();
        });
    });
});
