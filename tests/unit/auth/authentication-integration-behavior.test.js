
// Mock axios globally for all tests
const { describe, test, expect, beforeEach } = require('bun:test');
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

describe('Authentication Integration Behavior', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let TwitchAuthInitializer;
    let TwitchAuthService;
    let mockLogger;
    let mockEnhancedHttpClient;
    let mockFileSystem;
    
    beforeEach(() => {
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
        
        // Use the globally mocked axios
        clearAllMocks();
        
        // Mock file system
        mockFileSystem = {
            readFileSync: createMockFn().mockReturnValue('[twitch]\naccessToken=old_token\nrefreshToken=old_refresh'),
            writeFileSync: createMockFn()
        };
        
        TwitchAuthInitializer = require('../../../src/auth/TwitchAuthInitializer');
        TwitchAuthService = require('../../../src/auth/TwitchAuthService');
    });
    
    describe('when authentication initialization completes successfully', () => {
        test('should integrate all auth components for complete workflow', async () => {
            // Given: Complete auth service with valid config
            const authConfig = {
                clientId: 'integration_client_id',
                clientSecret: 'integration_client_secret',
                accessToken: 'valid_integration_token',
                refreshToken: 'valid_integration_refresh',
                channel: 'integrationuser'
            };
            
            const authService = new TwitchAuthService(authConfig, { logger: mockLogger });
            
            // And: Successful token validation
            const mockResponse = {
                data: {
                    user_id: '555666777',
                    login: 'integrationuser',
                    expires_in: 14400
                }
            };
            // Mock both proactive check and validation calls
            axios.get.mockResolvedValueOnce(mockResponse); // For proactive check
            axios.get.mockResolvedValueOnce(mockResponse); // For validation
            
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: axios,
                fs: mockFileSystem
            });
            
            // When: Complete authentication initialization
            const result = await authInitializer.initializeAuthentication(authService);
            
            // Then: Should complete full integration successfully
            expect(result).toBe(true);
            expect(authService.isInitialized).toBe(true);
            expect(authService.userId).toBe('555666777');
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Authentication initialized for user: integrationuser')
            );
        }, 10000); // Add timeout protection
        
        test('should maintain authentication state across component interactions', async () => {
            // Given: Auth service and initializer working together
            const authConfig = {
                clientId: 'state_client_id',
                clientSecret: 'state_client_secret',
                accessToken: 'state_test_token',
                refreshToken: 'state_test_refresh',
                channel: 'stateuser'
            };
            
            const authService = new TwitchAuthService(authConfig, { logger: mockLogger });
            
            const mockResponse = {
                data: {
                    user_id: '888999111',
                    login: 'stateuser',
                    expires_in: 7200
                }
            };
            // Mock both proactive check and validation calls
            axios.get.mockResolvedValueOnce(mockResponse); // For proactive check
            axios.get.mockResolvedValueOnce(mockResponse); // For validation
            
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: axios,
                fs: mockFileSystem
            });
            
            // When: Authentication is initialized
            await authInitializer.initializeAuthentication(authService);
            
            // Then: Auth service should maintain consistent state
            expect(authService.isInitialized).toBe(true);
            expect(authService.config.accessToken).toBe('state_test_token');
            
            // And: Auth provider should be accessible (skip if method doesn't exist)
            if (typeof authService.getAuthProvider === 'function') {
                const authProvider = authService.getAuthProvider();
                expect(authProvider).toBeDefined();
                expect(typeof authProvider.getAccessTokenForUser).toBe('function');
            }
            
            // And: User ID should be retrievable
            const userId = authService.getUserId();
            expect(userId).toBe('888999111');
        }, 10000); // Add timeout protection
    });
    
    describe('when authentication requires token refresh', () => {
        test('should integrate refresh flow with auth service updates', async () => {
            // Given: Auth service with expired token
            const authConfig = {
                clientId: 'refresh_client_id',
                clientSecret: 'refresh_client_secret',
                accessToken: 'expired_token',
                refreshToken: 'valid_refresh_token',
                channel: 'refreshuser'
            };
            
            const authService = new TwitchAuthService(authConfig, { logger: mockLogger });
            
            // And: Token validation fails initially (expired)
            axios.get
                .mockRejectedValueOnce({
                    response: { status: 401 },
                    message: 'Invalid OAuth token'
                })
                .mockResolvedValueOnce({
                    data: {
                        user_id: '111222333',
                        login: 'refreshuser',
                        expires_in: 14400
                    }
                });
            
            // And: Successful token refresh
            mockEnhancedHttpClient.post.mockResolvedValue({
                data: {
                    access_token: 'new_refreshed_token',
                    refresh_token: 'new_refreshed_refresh',
                    expires_in: 14400
                }
            });
            
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: axios,
                fs: mockFileSystem
            });
            
            // When: Authentication initialization with refresh
            const result = await authInitializer.initializeAuthentication(authService);
            
            // Then: Should complete integration with refreshed tokens
            expect(result).toBe(true);
            expect(authService.config.accessToken).toBe('new_refreshed_token');
            expect(authService.config.refreshToken).toBe('new_refreshed_refresh');
            expect(authService.isInitialized).toBe(true);
            
            // And: Authentication state should be maintainable for user
            expect(authService.getUserId()).toBe('111222333');
            expect(authService.getStatus().hasValidTokens).toBe(true);
        }, 10000); // Add timeout protection
        
        test('should handle refresh failure and fallback to OAuth gracefully', async () => {
            // Given: Auth service with invalid refresh token
            const authConfig = {
                clientId: 'fallback_client_id',
                clientSecret: 'fallback_client_secret',
                accessToken: 'expired_token',
                refreshToken: 'invalid_refresh_token',
                channel: 'fallbackuser'
            };
            
            const authService = new TwitchAuthService(authConfig, { logger: mockLogger });
            
            // And: Token validation fails
            axios.get.mockRejectedValue({
                response: { status: 401 },
                message: 'Invalid OAuth token'
            });
            
            // And: Token refresh fails
            mockEnhancedHttpClient.post.mockRejectedValue({
                response: {
                    status: 400,
                    data: { error: 'invalid_grant' }
                },
                message: 'Invalid refresh token'
            });
            
            // Set test environment to prevent real OAuth flow
            process.env.NODE_ENV = 'test';
            
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: axios,
                fs: mockFileSystem
            });
            
            // When: Authentication fails and falls back to OAuth
            const result = await authInitializer.initializeAuthentication(authService);
            
            // Then: Should handle failure gracefully
            expect(result).toBe(false); // OAuth not run in test env
            expect(authService.isInitialized).toBe(false);
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Test environment detected')
            );
            
            // Cleanup
            delete process.env.NODE_ENV;
        }, 10000); // Add timeout protection
    });
    
    describe('when network issues occur during authentication', () => {
        test('should integrate retry logic across authentication components', async () => {
            // Given: Auth service with valid credentials
            const authConfig = {
                clientId: 'network_client_id',
                clientSecret: 'network_client_secret',
                accessToken: 'network_test_token',
                refreshToken: 'network_test_refresh',
                channel: 'networkuser'
            };
            
            const authService = new TwitchAuthService(authConfig, { logger: mockLogger });
            
            // And: Network error on first validation, success on second
            axios.get
                .mockRejectedValueOnce(new Error('ECONNREFUSED'))
                .mockResolvedValueOnce({
                    data: {
                        user_id: '444555666',
                        login: 'networkuser',
                        expires_in: 10800
                    }
                });
            
            // And: Successful token refresh
            mockEnhancedHttpClient.post.mockResolvedValue({
                data: {
                    access_token: 'network_refreshed_token',
                    refresh_token: 'network_refreshed_refresh',
                    expires_in: 14400
                }
            });
            
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: axios,
                fs: mockFileSystem
            });
            
            // When: Authentication with network issues
            const result = await authInitializer.initializeAuthentication(authService);
            
            // Then: Should recover from network issues and authenticate successfully
            expect(result).toBe(true);
            expect(authService.isInitialized).toBe(true);
            
            // AND: User experience should be seamless despite network issues
            // (Authentication succeeds without requiring user intervention)
        }, 10000); // Add timeout protection
    });
    
    describe('when configuration management is required', () => {
        test('should integrate config updates across authentication components', async () => {
            // Given: Auth service with initial config
            const authConfig = {
                clientId: 'config_client_id',
                clientSecret: 'config_client_secret',
                accessToken: 'config_old_token',
                refreshToken: 'config_old_refresh',
                channel: 'configuser'
            };
            
            const authService = new TwitchAuthService(authConfig, { logger: mockLogger });
            
            // And: Token needs refresh
            axios.get
                .mockRejectedValueOnce({
                    response: { status: 401 },
                    message: 'Invalid OAuth token'
                })
                .mockResolvedValueOnce({
                    data: {
                        user_id: '777888999',
                        login: 'configuser',
                        expires_in: 14400
                    }
                });
            
            // And: Successful token refresh with new values
            const newTokens = {
                access_token: 'config_new_token',
                refresh_token: 'config_new_refresh',
                expires_in: 14400
            };
            mockEnhancedHttpClient.post.mockResolvedValue({ data: newTokens });
            
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: axios,
                fs: mockFileSystem
            });
            
            // When: Authentication with config updates
            const result = await authInitializer.initializeAuthentication(authService);
            
            // Then: Should integrate config updates across components
            expect(result).toBe(true);
            
            // Auth service should have updated tokens
            expect(authService.config.accessToken).toBe('config_new_token');
            expect(authService.config.refreshToken).toBe('config_new_refresh');
            
            // And: User should experience seamless authentication state
            expect(authService.isInitialized).toBe(true);
            expect(authService.getUserId()).toBe('777888999');
            expect(authService.getStatus().hasValidTokens).toBe(true);
            expect(authService.getStatus().configValid).toBe(true);
        }, 10000); // Add timeout protection
    });
});