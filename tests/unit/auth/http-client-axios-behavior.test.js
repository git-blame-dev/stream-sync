
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');

describe('HTTP Client Axios Response Behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let TwitchAuthInitializer;
    let mockAuthService;
    let mockLogger;
    let mockEnhancedHttpClient;
    let mockAxios;
    
    beforeEach(() => {
        mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            error: createMockFn(),
            warn: createMockFn()
        };
        
        // Mock enhanced HTTP client with axios-compatible responses
        mockEnhancedHttpClient = {
            post: createMockFn()
        };
        
        // Mock axios for token validation
        mockAxios = {
            get: createMockFn()
        };
        
        mockAuthService = {
            config: {
                clientId: 'test_client_id',
                clientSecret: 'test_client_secret',
                accessToken: 'test_access_token',
                refreshToken: 'test_refresh_token',
                channel: 'testchannel'
            },
            isInitialized: false,
            validateCredentials: createMockFn().mockReturnValue({
                hasToken: true,
                isValid: true,
                isExpired: false,
                issues: []
            }),
            setAuthenticationState: createMockFn(),
            updateAccessToken: createMockFn(),
            tokenExpiresAt: null
        };
        
        TwitchAuthInitializer = require('../../../src/auth/TwitchAuthInitializer');
    });
    
    describe('when making token refresh requests', () => {
        test('should handle axios response structure correctly', async () => {
            // Given: Enhanced HTTP client returns axios-compatible response
            const axiosResponse = {
                data: {
                    access_token: 'new_access_token_12345',
                    refresh_token: 'new_refresh_token_67890',
                    expires_in: 14400
                },
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {}
            };
            
            mockEnhancedHttpClient.post.mockResolvedValue(axiosResponse);
            
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios
            });
            
            // When: Refreshing token
            const result = await authInitializer.refreshToken(mockAuthService);
            
            // Then: Should handle axios response structure and succeed
            expect(result).toBe(true);
            expect(mockEnhancedHttpClient.post).toHaveBeenCalledWith(
                'https://id.twitch.tv/oauth2/token',
                expect.objectContaining({
                    grant_type: 'refresh_token',
                    refresh_token: 'test_refresh_token'
                }),
                expect.objectContaining({
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                })
            );
            expect(mockAuthService.updateAccessToken).toHaveBeenCalledWith('new_access_token_12345');
        });
        
        test('should extract token data from nested axios response', async () => {
            // Given: Response with nested data structure
            const nestedResponse = {
                data: {
                    access_token: 'extracted_token_123',
                    refresh_token: 'extracted_refresh_456',
                    expires_in: 3600,
                    token_type: 'bearer',
                    scope: ['chat:read', 'chat:edit']
                }
            };
            
            mockEnhancedHttpClient.post.mockResolvedValue(nestedResponse);
            
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios
            });
            
            // When: Token refresh completes
            const result = await authInitializer.refreshToken(mockAuthService);
            
            // Then: Should extract tokens from response.data correctly
            expect(result).toBe(true);
            expect(mockAuthService.config.accessToken).toBe('extracted_token_123');
            expect(mockAuthService.config.refreshToken).toBe('extracted_refresh_456');
        });
        
        test('should handle HTTP client errors with proper axios error structure', async () => {
            // Given: Enhanced HTTP client returns axios error structure
            const axiosError = {
                response: {
                    status: 400,
                    data: {
                        error: 'invalid_grant',
                        error_description: 'Invalid refresh token'
                    }
                },
                message: 'Request failed with status code 400',
                isAxiosError: true
            };
            
            mockEnhancedHttpClient.post.mockRejectedValue(axiosError);
            
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios
            });
            
            // When: Token refresh encounters error
            const result = await authInitializer.refreshToken(mockAuthService);
            
            // Then: Should handle axios error structure properly
            expect(result).toBe(false);
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Token refresh failed'),
                expect.any(String)
            );
        });
    });
    
    describe('when validating tokens with axios', () => {
        test('should work with axios get requests and response structure', async () => {
            // Given: Axios returns proper response structure
            const validationResponse = {
                data: {
                    user_id: '123456789',
                    login: 'testchannel',
                    expires_in: 14400,
                    scopes: ['chat:read', 'chat:edit']
                },
                status: 200
            };
            
            mockAxios.get.mockResolvedValue(validationResponse);
            
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios
            });
            
            // When: Initializing authentication with valid token
            const result = await authInitializer.initializeAuthentication(mockAuthService);
            
            // Then: Should validate token using axios and succeed
            expect(result).toBe(true);
            expect(mockAxios.get).toHaveBeenCalledWith(
                'https://id.twitch.tv/oauth2/validate',
                expect.objectContaining({
                    headers: {
                        'Authorization': 'Bearer test_access_token'
                    }
                })
            );
            expect(mockAuthService.setAuthenticationState).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: '123456789',
                    isInitialized: true
                })
            );
        });
        
        test('should handle axios validation errors correctly', async () => {
            // Given: Axios validation returns 401 error
            const validationError = {
                response: {
                    status: 401,
                    data: {
                        message: 'Invalid OAuth token'
                    }
                },
                message: 'Request failed with status code 401',
                isAxiosError: true
            };
            
            // Setup sequence: First call fails with 401, retry succeeds
            mockAxios.get.mockRejectedValueOnce(validationError).mockResolvedValueOnce({
                data: {
                    user_id: '123456789',
                    login: 'testchannel',
                    expires_in: 14400
                }
            });
            
            // And: Refresh should succeed
            const refreshResponse = {
                data: {
                    access_token: 'refreshed_token_123',
                    refresh_token: 'refreshed_refresh_456',
                    expires_in: 14400
                }
            };
            mockEnhancedHttpClient.post.mockResolvedValue(refreshResponse);
            
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios
            });
            
            // When: Authentication with expired token
            const result = await authInitializer.initializeAuthentication(mockAuthService);
            
            // Then: Should handle 401, refresh token, and succeed
            expect(result).toBe(true);
            expect(mockEnhancedHttpClient.post).toHaveBeenCalled(); // Token refresh
            expect(mockAxios.get).toHaveBeenCalledTimes(2); // Initial + retry
        });
    });
    
    describe('when HTTP client dependencies are properly injected', () => {
        test('should use injected enhanced HTTP client for requests', async () => {
            // Given: Custom enhanced HTTP client with tracking
            const customHttpClient = {
                post: createMockFn().mockResolvedValue({
                    data: {
                        access_token: 'custom_token',
                        refresh_token: 'custom_refresh',
                        expires_in: 7200
                    }
                })
            };
            
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: customHttpClient,
                axios: mockAxios
            });
            
            // When: Performing token refresh
            const result = await authInitializer.refreshToken(mockAuthService);
            
            // Then: Should use the injected HTTP client
            expect(result).toBe(true);
            expect(customHttpClient.post).toHaveBeenCalledWith(
                expect.stringContaining('oauth2/token'),
                expect.objectContaining({
                    grant_type: 'refresh_token'
                }),
                expect.any(Object)
            );
        });
        
        test('should use injected axios for token validation', async () => {
            // Given: Custom axios instance with tracking
            const customAxios = {
                get: createMockFn().mockResolvedValue({
                    data: {
                        user_id: '987654321',
                        login: 'testchannel', // Must match authService.config.channel
                        expires_in: 3600
                    }
                })
            };
            
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: customAxios
            });
            
            // When: Initializing authentication
            const result = await authInitializer.initializeAuthentication(mockAuthService);
            
            // Then: Should use the injected axios instance
            expect(result).toBe(true);
            expect(customAxios.get).toHaveBeenCalledWith(
                'https://id.twitch.tv/oauth2/validate',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': expect.stringContaining('Bearer')
                    })
                })
            );
        });
    });
});