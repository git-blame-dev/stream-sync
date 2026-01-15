
// Mock axios globally for all tests
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('axios');
const axios = require('axios');

// Mock the OAuth handler to prevent server startup
mockModule('../../../src/auth/oauth-handler', () => ({
    TwitchOAuthHandler: createMockFn().mockImplementation(() => ({
        runOAuthFlow: createMockFn().mockRejectedValue(new Error('OAuth not available in test environment'))
    }))
}));
const { TwitchOAuthHandler } = require('../../../src/auth/oauth-handler');

describe('OAuth Flow Test Environment Behavior', () => {
    let TwitchAuthInitializer;
    let mockAuthService;
    let mockLogger;
    let mockEnhancedHttpClient;
    let mockFs;
    let originalNodeEnv;
    let originalTwitchDisableAuth;
    
    beforeEach(() => {
        // Clear all mocks
        TwitchOAuthHandler.mockClear();
        
        // Preserve original env state so we can restore for other tests
        originalNodeEnv = process.env.NODE_ENV;
        originalTwitchDisableAuth = process.env.TWITCH_DISABLE_AUTH;

        // Set test environment defaults
        process.env.NODE_ENV = 'test';
        
        // Mock logger
        mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            error: createMockFn(),
            warn: createMockFn()
        };
        
        // Mock enhanced HTTP client
        mockEnhancedHttpClient = {
            post: createMockFn()
        };
        
        // Mock file system
        mockFs = {
            readFileSync: createMockFn().mockReturnValue('[twitch]\naccessToken=old_token\nrefreshToken=old_refresh'),
            writeFileSync: createMockFn()
        };
        
        // Mock auth service with missing tokens (requires OAuth)
        mockAuthService = {
            config: {
                clientId: 'test_client_id',
                clientSecret: 'test_client_secret',
                accessToken: null, // Missing - should trigger OAuth
                refreshToken: null,
                channel: 'testchannel'
            },
            isInitialized: false,
            validateCredentials: createMockFn().mockReturnValue({
                hasToken: false,
                isValid: true,
                isExpired: false,
                issues: []
            }),
            setAuthenticationState: createMockFn()
        };
        
        TwitchAuthInitializer = require('../../../src/auth/TwitchAuthInitializer');
    });
    
    afterEach(() => {
        restoreAllMocks();
        if (originalNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        
        restoreAllModuleMocks();} else {
            process.env.NODE_ENV = originalNodeEnv;
        }

        if (originalTwitchDisableAuth === undefined) {
            delete process.env.TWITCH_DISABLE_AUTH;
        } else {
            process.env.TWITCH_DISABLE_AUTH = originalTwitchDisableAuth;
        }
    });
    
    describe('when OAuth flow is required in test environment', () => {
        test('should detect test environment and not open real browser', async () => {
            // Given: Test environment with missing access token and mocked dependencies
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: axios,
                fs: mockFs
            });
            
            // When: Initializing authentication (which should trigger OAuth)
            const result = await authInitializer.initializeAuthentication(mockAuthService);
            
            // Then: Should detect test environment and return false (not open browser)
            expect(result).toBe(false);
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Test environment detected')
            );
        }, 10000); // Add timeout protection
        
        test('should provide clear messaging about OAuth flow requirements', async () => {
            // Given: Auth initializer with test environment and mocked dependencies
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: axios,
                fs: mockFs
            });
            
            // When: OAuth flow is triggered
            const result = await authInitializer.triggerOAuthFlow(mockAuthService);
            
            // Then: Should log appropriate messages about OAuth requirements
            expect(result).toBeNull();
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('OAUTH FLOW REQUIRED')
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Test environment detected')
            );
        }, 10000); // Add timeout protection
    });
    
    describe('when OAuth flow is mocked for test scenarios', () => {
        test('should allow mocking OAuth flow to return successful authentication', async () => {
            // Given: Auth initializer with injected mock OAuth handler
            const mockOAuthHandler = {
                runOAuthFlow: createMockFn().mockResolvedValue({
                    access_token: 'mock_access_token',
                    refresh_token: 'mock_refresh_token'
                })
            };
            
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: axios,
                fs: mockFs,
                mockOAuthHandler: mockOAuthHandler // Inject mock directly
            });
            
            // Override the test environment check for this specific test
            const originalNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test'; // Keep test env to use injected mock
            
            try {
                // When: OAuth flow is triggered with mocked handler
                const result = await authInitializer.triggerOAuthFlow(mockAuthService);
                
                // Then: Should successfully complete OAuth flow using mock
                expect(result).toMatchObject({
                    access_token: 'mock_access_token',
                    refresh_token: 'mock_refresh_token'
                });
                expect(mockOAuthHandler.runOAuthFlow).toHaveBeenCalled();
                expect(mockLogger.info).toHaveBeenCalledWith(
                    expect.stringContaining('Mock OAuth flow completed successfully!')
                );
            } finally {
                process.env.NODE_ENV = originalNodeEnv;
            }
        }, 10000); // Add timeout protection
        
        test('should handle OAuth flow failures gracefully in tests', async () => {
            // Given: Mock OAuth handler that simulates failure
            const mockOAuthHandler = {
                runOAuthFlow: createMockFn().mockRejectedValue(new Error('OAuth flow failed'))
            };
            
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: axios,
                fs: mockFs,
                mockOAuthHandler: mockOAuthHandler // Inject mock directly
            });
            
            const originalNodeEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';
            
            try {
                // When: OAuth flow fails
                const result = await authInitializer.triggerOAuthFlow(mockAuthService);

                // Then: Should handle failure gracefully
                expect(result).toBeNull();
                expect(mockLogger.error).toHaveBeenCalledWith(
                    expect.stringContaining('Mock OAuth flow failed'),
                    expect.any(String),
                    expect.any(Object)
                );
            } finally {
                process.env.NODE_ENV = originalNodeEnv;
            }
        }, 10000); // Add timeout protection
    });

    describe('when OAuth is explicitly disabled for tests', () => {
        test('should skip OAuth flow even when NODE_ENV is not test', async () => {
            // Given: Production-like env but explicit disable flag to prevent OAuth flow
            process.env.NODE_ENV = 'production';
            process.env.TWITCH_DISABLE_AUTH = 'true';

            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: axios,
                fs: mockFs
            });

            // When: OAuth flow would normally be triggered
            const result = await authInitializer.triggerOAuthFlow(mockAuthService);

            // Then: Should skip browser flow entirely
            expect(result).toBeNull();
            expect(TwitchOAuthHandler).not.toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('TWITCH_DISABLE_AUTH')
            );
        }, 10000); // Add timeout protection
    });
});
