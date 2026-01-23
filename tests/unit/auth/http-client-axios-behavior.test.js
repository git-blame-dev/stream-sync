
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

describe('HTTP Client Axios Response Behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let TwitchAuthInitializer;
    let mockAuthService;
    let mockEnhancedHttpClient;
    let mockAxios;

    beforeEach(() => {
        mockEnhancedHttpClient = {
            post: createMockFn()
        };

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
                logger: noOpLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios
            });

            const result = await authInitializer.refreshToken(mockAuthService);

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
                logger: noOpLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios
            });

            const result = await authInitializer.refreshToken(mockAuthService);

            expect(result).toBe(true);
            expect(mockAuthService.config.accessToken).toBe('extracted_token_123');
            expect(mockAuthService.config.refreshToken).toBe('extracted_refresh_456');
        });
        
        test('should handle HTTP client errors with proper axios error structure', async () => {
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
                logger: noOpLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios
            });

            const result = await authInitializer.refreshToken(mockAuthService);

            expect(result).toBe(false);
        });
    });

    describe('when validating tokens with axios', () => {
        test('should work with axios get requests and response structure', async () => {
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
                logger: noOpLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios
            });

            const result = await authInitializer.initializeAuthentication(mockAuthService);

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

            mockAxios.get.mockRejectedValueOnce(validationError).mockResolvedValueOnce({
                data: {
                    user_id: '123456789',
                    login: 'testchannel',
                    expires_in: 14400
                }
            });

            const refreshResponse = {
                data: {
                    access_token: 'refreshed_token_123',
                    refresh_token: 'refreshed_refresh_456',
                    expires_in: 14400
                }
            };
            mockEnhancedHttpClient.post.mockResolvedValue(refreshResponse);
            
            const authInitializer = new TwitchAuthInitializer({
                logger: noOpLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios
            });

            const result = await authInitializer.initializeAuthentication(mockAuthService);

            expect(result).toBe(true);
            expect(mockEnhancedHttpClient.post).toHaveBeenCalled();
            expect(mockAxios.get).toHaveBeenCalledTimes(2);
        });
    });

    describe('when HTTP client dependencies are properly injected', () => {
        test('should use injected enhanced HTTP client for requests', async () => {
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
                logger: noOpLogger,
                enhancedHttpClient: customHttpClient,
                axios: mockAxios
            });

            const result = await authInitializer.refreshToken(mockAuthService);

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
            const customAxios = {
                get: createMockFn().mockResolvedValue({
                    data: {
                        user_id: '987654321',
                        login: 'testchannel',
                        expires_in: 3600
                    }
                })
            };

            const authInitializer = new TwitchAuthInitializer({
                logger: noOpLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: customAxios
            });

            const result = await authInitializer.initializeAuthentication(mockAuthService);

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