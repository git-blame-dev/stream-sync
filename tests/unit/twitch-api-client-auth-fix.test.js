
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { initializeTestLogging } = require('../helpers/test-setup');
const { createMockLogger } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

// Mock the enhanced HTTP client before any imports
const mockEnhancedHttpClient = {
    get: createMockFn()
};

const { TwitchApiClient } = require('../../src/utils/api-clients/twitch-api-client');

describe('TwitchApiClient Authentication Integration', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let mockAuthManager;
    let mockConfig;
    let mockLogger;
    let apiClient;

    beforeEach(() => {
        mockLogger = createMockLogger('debug');
        
        // Create mock auth manager with correct method
        mockAuthManager = {
            getAccessToken: createMockFn().mockResolvedValue('test-access-token'),
            getState: createMockFn().mockReturnValue('READY')
        };

        mockConfig = {
            clientId: 'test-client-id',
            channel: 'test-channel'
        };

        apiClient = new TwitchApiClient(mockAuthManager, mockConfig, mockLogger, {
            enhancedHttpClient: mockEnhancedHttpClient
        });
    });

    describe('when making API requests', () => {
        it('should use getAccessToken method from auth manager', async () => {
            // Arrange
            const mockResponse = {
                status: 200,
                data: { data: [] }
            };
            mockEnhancedHttpClient.get.mockResolvedValue(mockResponse);

            // Act
            await apiClient.makeRequest('/test-endpoint');

            // Assert
            expect(mockAuthManager.getAccessToken).toHaveBeenCalled();
            expect(mockEnhancedHttpClient.get).toHaveBeenCalledWith(
                'https://api.twitch.tv/helix/test-endpoint',
                expect.objectContaining({
                    authToken: 'test-access-token',
                    authType: 'app',
                    clientId: 'test-client-id'
                })
            );
        });
    });

    describe('when getting stream info', () => {
        it('should successfully get stream info with proper auth', async () => {
            // Arrange
            const mockStreamData = {
                data: [{
                    viewer_count: 42,
                    game_name: 'Test Game'
                }]
            };
            const mockResponse = {
                status: 200,
                data: mockStreamData
            };
            mockEnhancedHttpClient.get.mockResolvedValue(mockResponse);

            // Act
            const result = await apiClient.getStreamInfo('test-channel');

            // Assert
            expect(result).toEqual({
                isLive: true,
                stream: mockStreamData.data[0],
                viewerCount: 42
            });
            expect(mockAuthManager.getAccessToken).toHaveBeenCalled();
        });
    });

    describe('when auth manager getAccessToken fails', () => {
        it('should handle auth errors gracefully', async () => {
            // Arrange
            mockAuthManager.getAccessToken.mockRejectedValue(new Error('Auth failed'));

            // Act & Assert
            await expect(apiClient.getStreamInfo('test-channel')).resolves.toEqual({
                isLive: false,
                stream: null,
                viewerCount: 0
            });
        });
    });
});
