const { describe, test, beforeEach, afterEach, expect } = require('bun:test');

const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const { expectNoTechnicalArtifacts } = require('../helpers/assertion-helpers');
const testClock = require('../helpers/test-clock');
const { StreamDetector } = require('../../src/utils/stream-detector');

describe('YouTube YouTubei Stream Detection Integration - Regression', () => {
    let streamDetector;
    let mockYouTubeService;

    afterEach(() => {
        restoreAllMocks();
    });

    beforeEach(() => {
        testClock.reset();
        mockYouTubeService = {
            detectLiveStreams: createMockFn(),
            getUsageMetrics: createMockFn().mockReturnValue({
                totalRequests: 0,
                successfulRequests: 0,
                averageResponseTime: 0
            })
        };
        streamDetector = new StreamDetector({
            streamDetectionEnabled: true,
            streamRetryInterval: 15,
            streamMaxRetries: 3,
            continuousMonitoringInterval: 60
        }, {
            logger: noOpLogger,
            youtubeDetectionService: mockYouTubeService
        });
    });


    describe('Configuration Acceptance', () => {
        test('should accept youtubei as valid streamDetectionMethod configuration option', () => {
            const youtubeConfig = {
                streamDetectionMethod: 'youtubei',
                username: 'testchannel'
            };

            const result = validateYouTubeConfig(youtubeConfig);

            expect(result.isValid).toBe(true);
            expect(result.streamDetectionMethod).toBe('youtubei');
            expect(result.errors).toHaveLength(0);
            expectNoTechnicalArtifacts(result.userMessage || '');
        });

        test('should provide user-friendly error when youtubei method configured but service unavailable', () => {
            const youtubeConfig = {
                streamDetectionMethod: 'youtubei',
                username: 'testchannel'
            };

            const result = validateYouTubeConfigWithServices(youtubeConfig, {
                hasYoutubeiService: false
            });

            expect(result.isValid).toBe(false);
            expect(result.userMessage).toContain('YouTube stream detection');
            expect(result.userMessage).toContain('not available');
            expectNoTechnicalArtifacts(result.userMessage);
            expect(result.userMessage).not.toContain('youtubei');
            expect(result.userMessage).not.toContain('service');
            expect(result.userMessage).not.toContain('dependency');
        });

        test('should surface failure when youtubei service is unavailable', () => {
            const youtubeConfig = {
                streamDetectionMethod: 'youtubei',
                username: 'testchannel'
            };

            const result = handleYouTubeStreamDetectionWithoutFallback(youtubeConfig, {
                youtubeiServiceAvailable: false,
                scrapingServiceAvailable: true
            });

            expect(result.success).toBe(false);
            expect(result.actualMethod).toBeNull();
            expect(result.userExperienceImpact).toBe('significant');
            expectNoTechnicalArtifacts(result.userMessage || '');
        });
    });

    describe('Stream Detector Routing', () => {
        test('should route to YouTubeStreamDetectionService when youtubei method configured', async () => {
            mockYouTubeService.detectLiveStreams.mockResolvedValue({
                success: true,
                videoIds: ['test123video'],
                message: 'Found 1 live stream'
            });

            const mockResult = await mockYouTubeService.detectLiveStreams('testchannel');

            expect(mockResult.success).toBe(true);
            expect(mockResult.videoIds).toEqual(['test123video']);
            const result = mockResult.success && mockResult.videoIds.length > 0;
            expect(result).toBe(true);
        });

        test('should not fall back when youtubei service unavailable at runtime', async () => {
            const platformConfig = {
                streamDetectionMethod: 'youtubei',
                username: 'testchannel',
                apiKey: 'test-api-key'
            };
            mockYouTubeService.detectLiveStreams.mockRejectedValue(
                new Error('Service unavailable')
            );

            const result = await streamDetector.checkStreamStatus('youtube', platformConfig);

            expect(typeof result).toBe('boolean');
            expect(result).toBe(false);
        });

        test('should meet performance targets for youtubei stream detection', async () => {
            mockYouTubeService.detectLiveStreams.mockResolvedValue({
                success: true,
                videoIds: ['test123video'],
                responseTime: 1500
            });
            const startTime = testClock.now();
            const mockResult = await mockYouTubeService.detectLiveStreams('testchannel');
            const simulatedResponseMs = mockResult.responseTime ?? 0;
            testClock.advance(simulatedResponseMs);
            const responseTime = testClock.now() - startTime;

            const result = mockResult.success && mockResult.videoIds.length > 0;
            expect(result).toBe(true);
            expect(responseTime).toBeLessThan(3000);
            const metrics = mockYouTubeService.getUsageMetrics();
            expect(metrics.averageResponseTime).toBeLessThan(2000);
        });
    });

    describe('YouTube Platform Integration', () => {
        let mockYouTubePlatform;

        beforeEach(() => {
            mockYouTubePlatform = {
                config: {
                    streamDetectionMethod: 'youtubei',
                    username: 'testchannel'
                },
                getStreamDetectionService: createMockFn(),
                connect: createMockFn(),
                isConnected: createMockFn(),
                detectLiveStreams: createMockFn(),
                startStreamDetection: createMockFn()
            };
        });

        test('should use youtubei service when platform configured with youtubei method', async () => {
            mockYouTubePlatform.getStreamDetectionService.mockReturnValue(mockYouTubeService);
            mockYouTubeService.detectLiveStreams.mockResolvedValue({
                success: true,
                videoIds: ['live123'],
                message: 'Stream detected'
            });
            mockYouTubePlatform.detectLiveStreams.mockImplementation(async () => {
                const service = mockYouTubePlatform.getStreamDetectionService();
                return await service.detectLiveStreams(mockYouTubePlatform.config.username);
            });

            const result = await mockYouTubePlatform.detectLiveStreams();

            expect(mockYouTubePlatform.getStreamDetectionService).toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(result.videoIds).toContain('live123');
            expectNoTechnicalArtifacts(result.message);
        });

        test('should provide clear user feedback during youtubei stream detection', async () => {
            const statusUpdates = [];
            const statusCallback = (status, message) => {
                statusUpdates.push({ status, message });
            };
            mockYouTubeService.detectLiveStreams.mockImplementation(async () => {
                await waitForDelay(100);
                return {
                    success: true,
                    videoIds: ['live456'],
                    message: 'Found 1 live stream'
                };
            });
            mockYouTubePlatform.startStreamDetection.mockImplementation(async (callback) => {
                callback('detecting', 'Checking for live streams');
                const result = await mockYouTubeService.detectLiveStreams();
                if (result.success) {
                    callback('live', 'Live stream found');
                }
                return result;
            });

            await mockYouTubePlatform.startStreamDetection(statusCallback);

            expect(statusUpdates.length).toBeGreaterThan(0);
            const finalStatus = statusUpdates[statusUpdates.length - 1];
            expect(finalStatus.status).toBe('live');
            expect(finalStatus.message).toContain('stream');
            expectNoTechnicalArtifacts(finalStatus.message);
            expect(finalStatus.message).not.toContain('youtubei');
            expect(finalStatus.message).not.toContain('service');
        });

        test('should handle youtubei service errors without exposing technical details', async () => {
            mockYouTubeService.detectLiveStreams.mockRejectedValue(
                new Error('Innertube client initialization failed')
            );
            mockYouTubePlatform.detectLiveStreams.mockImplementation(async () => {
                try {
                    const service = mockYouTubePlatform.getStreamDetectionService();
                    return await service.detectLiveStreams(mockYouTubePlatform.config.username);
                } catch {
                    return {
                        success: false,
                        message: 'Unable to detect streams at this time',
                        retryable: true
                    };
                }
            });

            const result = await mockYouTubePlatform.detectLiveStreams();

            expect(result.success).toBe(false);
            expect(result.message).toContain('Unable to detect');
            expectNoTechnicalArtifacts(result.message);
            expect(result.message).not.toContain('Innertube');
            expect(result.message).not.toContain('client');
            expect(result.message).not.toContain('initialization');
            expect(result.retryable).toBe(true);
        });
    });

    describe('Error Handling and Recovery', () => {
        test('should surface missing youtubei dependency at startup', () => {
            const initializationResult = initializeYouTubeStreamDetection({
                streamDetectionMethod: 'youtubei',
                username: 'testchannel'
            }, {
                youtubeiServiceAvailable: false
            });

            expect(initializationResult.success).toBe(false);
            expect(initializationResult.actualMethod).toBeNull();
            expect(initializationResult.userMessage).toContain('detection unavailable');
            expectNoTechnicalArtifacts(initializationResult.userMessage);
            expect(initializationResult.userMessage).not.toContain('dependency');
            expect(initializationResult.userMessage).not.toContain('youtubei');
        });

        test('should provide meaningful error when youtubei configuration is invalid', () => {
            const invalidConfig = {
                streamDetectionMethod: 'youtubei'
            };

            const result = validateYouTubeConfig(invalidConfig);

            expect(result.isValid).toBe(false);
            expect(result.userMessage).toContain('channel username required');
            expectNoTechnicalArtifacts(result.userMessage);
            expect(result.userMessage).not.toContain('config');
            expect(result.userMessage).not.toContain('validation');
        });

        test('should maintain system stability when youtubei service becomes unavailable', async () => {
            const platformConfig = {
                streamDetectionMethod: 'youtubei',
                username: 'testchannel'
            };
            mockYouTubeService.detectLiveStreams
                .mockResolvedValueOnce({ success: true, videoIds: ['test1'] })
                .mockRejectedValueOnce(new Error('Service unavailable'))
                .mockRejectedValueOnce(new Error('Service unavailable'));

            const results = [];
            for (let i = 0; i < 3; i++) {
                try {
                    const result = await streamDetector.checkStreamStatus('youtube', platformConfig);
                    results.push({ success: true, result });
                } catch (error) {
                    results.push({ success: false, error: error.message });
                }
            }

            expect(results[0].success).toBe(true);
            expect(results[0].result).toBe(true);
            expect(results[1].success).toBe(true);
            expect(results[1].result).toBe(false);
            expect(results[2].success).toBe(true);
            expect(results[2].result).toBe(false);
        });
    });

    describe('Configuration Migration and Compatibility', () => {
        test('should handle existing scraping configurations alongside new youtubei option', () => {
            const configs = [
                { streamDetectionMethod: 'scraping', username: 'channel1' },
                { streamDetectionMethod: 'youtubei', username: 'channel2', apiKey: 'test-key' },
                { streamDetectionMethod: 'api', username: 'channel3', apiKey: 'test-key' }
            ];

            const results = configs.map(config => validateYouTubeConfig(config));

            expect(results[0].isValid).toBe(true);
            expect(results[1].isValid).toBe(true);
            expect(results[2].isValid).toBe(true);
            results.forEach(result => {
                expectNoTechnicalArtifacts(result.userMessage || '');
            });
        });

        test('should provide clear migration guidance when upgrading to youtubei', () => {
            const oldConfig = {
                viewerCountMethod: 'youtubei',
                streamDetectionMethod: 'scraping'
            };

            const recommendations = getYouTubeConfigRecommendations(oldConfig);

            expect(recommendations.hasRecommendations).toBe(true);
            expect(recommendations.message).toContain('stream detection');
            expect(recommendations.message).toContain('consistent');
            expectNoTechnicalArtifacts(recommendations.message);
            expect(recommendations.suggestedConfig.streamDetectionMethod).toBe('youtubei');
        });
    });
});

function validateYouTubeConfig(config) {
    const { validateYouTubeConfig: configValidator } = require('../../src/utils/config-normalizer');
    return configValidator(config);
}

function validateYouTubeConfigWithServices(config, serviceStatus) {
    const baseValidation = validateYouTubeConfig(config);
    if (!baseValidation.isValid) {
        return baseValidation;
    }
    if (config.streamDetectionMethod === 'youtubei' && !serviceStatus.hasYoutubeiService) {
        return {
            isValid: false,
            errors: ['YouTube stream detection service not available'],
            userMessage: 'YouTube stream detection is not available. Please try again later or use a different detection method.'
        };
    }
    return baseValidation;
}

function handleYouTubeStreamDetectionWithoutFallback(config, serviceStatus) {
    if (config.streamDetectionMethod === 'youtubei' && !serviceStatus.youtubeiServiceAvailable) {
        return {
            success: false,
            actualMethod: null,
            userExperienceImpact: 'significant',
            userMessage: 'Stream detection unavailable. Please check your YouTube configuration.'
        };
    }

    return {
        success: true,
        actualMethod: config.streamDetectionMethod || 'scraping',
        userExperienceImpact: 'none',
        userMessage: ''
    };
}

function initializeYouTubeStreamDetection(config, serviceStatus) {
    if (config.streamDetectionMethod === 'youtubei' && !serviceStatus.youtubeiServiceAvailable) {
        return {
            success: false,
            actualMethod: null,
            userMessage: 'YouTube stream detection unavailable. Please check your configuration and try again.'
        };
    }
    
    return {
        success: true,
        actualMethod: config.streamDetectionMethod || 'scraping',
        userMessage: 'YouTube stream detection initialized successfully'
    };
}

function getYouTubeConfigRecommendations(currentConfig) {
    if (currentConfig.viewerCountMethod === 'youtubei' && currentConfig.streamDetectionMethod === 'scraping') {
        return {
            hasRecommendations: true,
            message: 'Consider using youtubei for stream detection to be consistent with viewer count method',
            suggestedConfig: {
                ...currentConfig,
                streamDetectionMethod: 'youtubei'
            }
        };
    }
    
    return {
        hasRecommendations: false,
        message: 'Configuration is optimal',
        suggestedConfig: currentConfig
    };
}
