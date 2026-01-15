
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const { initializeTestLogging } = require('../../helpers/test-setup');
const { createMockLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

// Mock axios before importing classes
mockModule('axios');
const axios = require('axios');

// Mock the OAuth handler to prevent server startup
mockModule('../../../src/auth/oauth-handler', () => ({
    TwitchOAuthHandler: createMockFn().mockImplementation(() => ({
        runOAuthFlow: createMockFn().mockRejectedValue(new Error('OAuth not available in test environment'))
    }))
}));

const TwitchAuthInitializer = require('../../../src/auth/TwitchAuthInitializer');
const TwitchAuthService = require('../../../src/auth/TwitchAuthService');

describe('Twitch User ID Resolution', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let authInitializer;
    let authService;
    let mockLogger;

    beforeEach(() => {
        mockLogger = createMockLogger('debug');
        
        // Mock dependencies to prevent unwanted side effects
        const mockHttpClient = {
            post: createMockFn()
        };
        
        const mockFs = {
            readFileSync: createMockFn().mockReturnValue('[twitch]\naccessToken=old_token\nrefreshToken=old_refresh'),
            writeFileSync: createMockFn()
        };
        
        // Create auth initializer with mocked axios for dependency injection
        authInitializer = new TwitchAuthInitializer({ 
            logger: mockLogger,
            axios: axios, // Inject the mocked axios
            enhancedHttpClient: mockHttpClient,
            fs: mockFs
        });
        
        const config = {
            clientId: 'test_client_id',
            clientSecret: 'test_client_secret',
            accessToken: 'test_access_token_12345',
            refreshToken: 'test_refresh_token_67890',
            channel: 'hero_stream',
            username: 'hero_stream'
        };
        
        authService = new TwitchAuthService(config, { logger: mockLogger });
    });

    describe('when initializing authentication', () => {
        it('should get real user ID from Twitch API instead of hardcoded value', async () => {
            // Arrange: Mock Twitch API response with real user data
            const mockResponse = {
                data: {
                    client_id: 'test_client_id',
                    login: 'hero_stream',
                    scopes: ['user:read:chat', 'chat:edit'],
                    user_id: '987654321', // Real user ID from Twitch API
                    expires_in: 7200 // 2 hours to prevent proactive refresh
                }
            };
            
            // Mock both proactive check and validation calls
            axios.get.mockResolvedValueOnce(mockResponse); // For proactive check
            axios.get.mockResolvedValueOnce(mockResponse); // For validation
            
            // Mock the enhancedHttpClient to prevent real OAuth calls
            const mockEnhancedHttpClient = {
                post: createMockFn()
            };
            
            // Create auth initializer with mocked dependencies
            const testAuthInitializer = new TwitchAuthInitializer({ 
                logger: mockLogger,
                axios: axios,
                enhancedHttpClient: mockEnhancedHttpClient,
                fs: {
                    readFileSync: createMockFn().mockReturnValue('[twitch]\naccessToken=old_token\nrefreshToken=old_refresh'),
                    writeFileSync: createMockFn()
                }
            });
            
            // Act: Initialize authentication (should call API for user ID)
            const success = await testAuthInitializer.initializeAuthentication(authService);
            
            // Assert: Should use real user ID from API, not hardcoded dummy value
            expect(success).toBe(true);
            expect(authService.userId).toBe('987654321'); // Real user ID
            expect(authService.userId).not.toBe('123456789'); // Not hardcoded dummy
            
            // Verify API was called for user validation
            expect(axios.get).toHaveBeenCalledWith('https://id.twitch.tv/oauth2/validate', expect.any(Object));
        }, 10000); // Add timeout protection
        
        it('should handle API validation failure gracefully', async () => {
            // Arrange: Mock API failure for validation
            axios.get.mockRejectedValue(new Error('Invalid token'));
            
            // Mock the enhancedHttpClient to prevent real OAuth calls
            const mockEnhancedHttpClient = {
                post: createMockFn().mockRejectedValue(new Error('Refresh failed'))
            };
            
            // Create auth initializer with mocked dependencies
            const testAuthInitializer = new TwitchAuthInitializer({ 
                logger: mockLogger,
                axios: axios,
                enhancedHttpClient: mockEnhancedHttpClient,
                fs: {
                    readFileSync: createMockFn().mockReturnValue('[twitch]\naccessToken=old_token\nrefreshToken=old_refresh'),
                    writeFileSync: createMockFn()
                }
            });
            
            // Act: Initialize authentication with invalid token
            const success = await testAuthInitializer.initializeAuthentication(authService);
            
            // Assert: Should fail gracefully without hardcoded fallback
            expect(success).toBe(false);
            expect(authService.userId).toBeNull(); // No dummy value on failure
        }, 10000); // Add timeout protection
        
        it('should extract correct user ID from API response format', async () => {
            // Test different possible API response structures
            const testCases = [
                {
                    name: 'standard format',
                    apiResponse: { user_id: '555444333', login: 'hero_stream' },
                    expectedUserId: '555444333'
                },
                {
                    name: 'string user_id',
                    apiResponse: { user_id: '555444333', login: 'hero_stream' },
                    expectedUserId: '555444333'
                }
            ];
            
            for (const [index, testCase] of testCases.entries()) {
                // Clear axios mocks for each iteration
                axios.get.mockClear();
                
                // Create fresh auth service for each test case
                const config = {
                    clientId: 'test_client_id',
                    clientSecret: 'test_client_secret',
                    accessToken: `test_access_token_${index}`,
                    refreshToken: `test_refresh_token_${index}`,
                    channel: 'hero_stream',
                    username: 'hero_stream'
                };
                const testAuthService = new TwitchAuthService(config, { logger: mockLogger });
                
                // Arrange: Mock API response for this specific test case
                // Need to mock both proactive check and validation calls
                const mockResponse = {
                    data: {
                        ...testCase.apiResponse,
                        client_id: 'test_client_id',
                        scopes: ['user:read:chat'],
                        expires_in: 7200 // 2 hours - enough to not trigger proactive refresh
                    }
                };
                
                axios.get.mockResolvedValueOnce(mockResponse); // For proactive check
                axios.get.mockResolvedValueOnce(mockResponse); // For validation
                
                // Create auth initializer for this specific test case
                const loopAuthInitializer = new TwitchAuthInitializer({ 
                    logger: mockLogger,
                    axios: axios,
                    enhancedHttpClient: {
                        post: createMockFn()
                    },
                    fs: {
                        readFileSync: createMockFn().mockReturnValue('[twitch]\naccessToken=old_token\nrefreshToken=old_refresh'),
                        writeFileSync: createMockFn()
                    }
                });
                
                // Act: Initialize authentication
                const success = await loopAuthInitializer.initializeAuthentication(testAuthService);
                
                // Assert: Should extract correct user ID
                expect(success).toBe(true);
                expect(testAuthService.userId).toBe(testCase.expectedUserId);
            }
        }, 15000); // Add longer timeout for loop test
        
        it('should validate user ID matches expected channel', async () => {
            // Arrange: API returns user ID for different user than expected
            const mockResponse = {
                data: {
                    user_id: '999888777',
                    login: 'different_user', // Different from expected 'hero_stream'
                    client_id: 'test_client_id',
                    scopes: ['user:read:chat'],
                    expires_in: 7200 // 2 hours to prevent proactive refresh
                }
            };
            
            // Mock both proactive check and validation calls
            axios.get.mockResolvedValueOnce(mockResponse); // For proactive check
            axios.get.mockResolvedValueOnce(mockResponse); // For validation
            
            // Mock the enhancedHttpClient to prevent real OAuth calls
            const mockEnhancedHttpClient = {
                post: createMockFn()
            };
            
            // Create auth initializer with mocked dependencies
            const testAuthInitializer = new TwitchAuthInitializer({ 
                logger: mockLogger,
                axios: axios,
                enhancedHttpClient: mockEnhancedHttpClient,
                fs: {
                    readFileSync: createMockFn().mockReturnValue('[twitch]\naccessToken=old_token\nrefreshToken=old_refresh'),
                    writeFileSync: createMockFn()
                }
            });
            
            // Act: Initialize authentication
            const success = await testAuthInitializer.initializeAuthentication(authService);
            
            // Assert: Should detect username mismatch
            expect(success).toBe(false);
            
            // Should log warning about user mismatch
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Token belongs to different user'),
                'auth-initializer',
                expect.any(Object)
            );
        }, 10000); // Add timeout protection
    });
});
