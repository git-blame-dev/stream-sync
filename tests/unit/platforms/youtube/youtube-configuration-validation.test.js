
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../helpers/mock-factories');
const { initializeTestLogging, createMockPlatformDependencies, createConfigFixture } = require('../../../helpers/test-setup');

initializeTestLogging();

const { YouTubePlatform } = require('../../../../src/platforms/youtube');

describe('YouTube Platform Configuration Validation', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let mockDependencies;
    
    beforeEach(() => {
        mockDependencies = createMockPlatformDependencies('youtube');
    });
    
    describe('Configuration Key Normalization (After Refactor)', () => {
        test('should handle config with required username', async () => {
            const configWithCamelCase = createConfigFixture('youtube', {
                enabled: true,
                username: 'testuser'
            });

            const platform = new YouTubePlatform(configWithCamelCase, mockDependencies);

            expect(platform).toBeDefined();
            expect(typeof platform).toBe('object');
        });
    });
    
    describe('Configuration Validation Edge Cases', () => {
        test('should handle missing API key gracefully', async () => {
            const configWithoutApiKey = createConfigFixture('youtube', {
                enabled: true,
                username: 'testuser'
            });

            const platform = new YouTubePlatform(configWithoutApiKey, mockDependencies);

            expect(platform).toBeDefined();
            expect(typeof platform).toBe('object');
        });
        
        test('should handle disabled platform', async () => {
            const disabledConfig = createConfigFixture('youtube', {
                enabled: false,
                username: 'testuser'
            });

            const platform = new YouTubePlatform(disabledConfig, mockDependencies);

            expect(platform).toBeDefined();
            expect(typeof platform).toBe('object');
        });

        test('should handle missing username', async () => {
            const configWithoutUsername = createConfigFixture('youtube', {
                enabled: true
            });

            const platform = new YouTubePlatform(configWithoutUsername, mockDependencies);

            expect(platform).toBeDefined();
            expect(typeof platform).toBe('object');
        });
    });

    describe('Configuration Normalization', () => {
        test('should honor INI-like numeric strings for retryAttempts and streamPollingInterval', () => {
            const platform = new YouTubePlatform(
                createConfigFixture('youtube', {
                    retryAttempts: '4',
                    streamPollingInterval: '30'
                }),
                mockDependencies
            );

            expect(platform.config.retryAttempts).toBe(4);
            expect(platform.config.streamPollingInterval).toBe(30);
        });
    });

    describe('Platform initialization', () => {
        test('initializes disabled platform without errors', async () => {
            const platform = new YouTubePlatform(
                createConfigFixture('youtube', { enabled: false, username: '' }),
                { ...mockDependencies, logger: noOpLogger }
            );

            await platform.initialize();

            expect(platform.isInitialized).toBe(true);
            expect(platform.monitoringInterval).toBeFalsy();
        });
    });

    describe('Dependency Validation', () => {
        const baseConfig = createConfigFixture('youtube', {
            enabled: true,
            username: 'channel-owner'
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
                    detectLiveStreams: createMockFn().mockResolvedValue({
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
            const mkdirMock = spyOn(require('fs'), 'mkdirSync').mockImplementation(() => {
                throw new Error('disk full');
            });

            const dependencies = createMockPlatformDependencies('youtube', {
                streamDetectionService: {
                    detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
                }
            });

            const platform = new YouTubePlatform(baseConfig, dependencies);
            const errorCalls = [];
            platform.errorHandler = {
                handleConfigurationError: (...args) => errorCalls.push(args)
            };

            platform._ensureDataLoggingPath();

            expect(errorCalls.length).toBeGreaterThan(0);
            mkdirMock.mockRestore();
        });
    });
});
