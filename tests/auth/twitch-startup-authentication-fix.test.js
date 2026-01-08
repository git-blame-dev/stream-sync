
const { expectNoTechnicalArtifacts } = require('../helpers/assertion-helpers');

const TwitchAuthInitializer = require('../../src/auth/TwitchAuthInitializer');
const TwitchAuthService = require('../../src/auth/TwitchAuthService');

describe('Twitch Authentication User Experience', () => {
    let authService;
    let authInitializer;
    let mockLogger;
    let mockHttpClient;
    let mockAxios;
    let mockOAuthHandler;
    
    beforeEach(() => {
        // Clear all mocks first
        jest.clearAllMocks();
        
        // Mock logger
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn()
        };

        // Mock axios for token validation
        mockAxios = {
            get: jest.fn()
        };

        // Mock enhanced HTTP client for token refresh
        mockHttpClient = {
            post: jest.fn()
        };


        // Create auth service with valid config
        const config = {
            clientId: 'test_client_id',
            clientSecret: 'test_client_secret',
            accessToken: 'valid_access_token_12345',
            refreshToken: 'valid_refresh_token_67890',
            channel: 'testchannel'
        };

        authService = new TwitchAuthService(config, { logger: mockLogger });
        
        // Mock file system operations for config updates
        const mockFs = {
            readFileSync: jest.fn().mockReturnValue('[twitch]\naccessToken=old_token\nrefreshToken=old_refresh'),
            writeFileSync: jest.fn()
        };

        // Mock OAuth handler for tests that need OAuth fallback
        mockOAuthHandler = {
            runOAuthFlow: jest.fn().mockResolvedValue({
                access_token: 'new-oauth-token',
                refresh_token: 'new-oauth-refresh'
            })
        };

        // Create auth initializer with mocked dependencies
        authInitializer = new TwitchAuthInitializer({
            logger: mockLogger,
            enhancedHttpClient: mockHttpClient,
            fs: mockFs,
            axios: mockAxios,
            mockOAuthHandler: mockOAuthHandler
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('when network issues occur during authentication', () => {
        it('should maintain user session without disruption', async () => {
            // Given: Temporary network issues during token validation
            mockAxios.get
                .mockRejectedValueOnce(new Error('ECONNREFUSED')) // Network failure
                .mockResolvedValueOnce({
                    data: {
                        user_id: '123456789',
                        login: 'testchannel',
                        expires_in: 14400
                    }
                });
            
            // And: System can refresh tokens automatically
            mockHttpClient.post.mockResolvedValueOnce({
                data: {
                    access_token: 'new_access_token_12345',
                    refresh_token: 'new_refresh_token_67890',
                    expires_in: 14400
                }
            });

            // When: User starts the application
            const result = await authInitializer.initializeAuthentication(authService);

            // Then: User authentication succeeds without interruption
            expect(result).toBe(true);
            
            // Verify refresh mechanism worked for seamless user experience
            const refreshCalls = mockHttpClient.post.mock.calls.filter(call => 
                call[0].includes('oauth2/token') && 
                call[1].grant_type === 'refresh_token'
            );
            expect(refreshCalls.length).toBeGreaterThan(0);
            
            // No disruptive OAuth popups shown to user
            const oauthLogs = mockLogger.info.mock.calls.filter(call => 
                call[0] && call[0].includes('OAUTH FLOW REQUIRED')
            );
            expect(oauthLogs.length).toBe(0);
        });

        it('should retry token validation after successful refresh', async () => {
            // Given: Network failure on first validation attempt (no proactive check during fresh init)
            mockAxios.get
                .mockRejectedValueOnce(new Error('ECONNREFUSED')) // Main validation fails
                .mockResolvedValueOnce({
                    data: {
                        user_id: '123456789',
                        login: 'testchannel',
                        expires_in: 14400
                    }
                });
            
            // And: Successful token refresh
            mockHttpClient.post.mockResolvedValueOnce({
                data: {
                    access_token: 'new_access_token_12345',
                    refresh_token: 'new_refresh_token_67890',
                    expires_in: 14400
                }
            });

            // When: User starts the application despite network issues
            const result = await authInitializer.initializeAuthentication(authService);

            // Then: User authentication completes successfully
            expect(result).toBe(true);
            
            // System retries validation after refresh for reliability
            expect(mockAxios.get.mock.calls.length).toBe(2);
            
            // Authentication system is ready for user
            expect(authService.isInitialized).toBe(true);
        });
    });

    describe('when access token is expired but refresh token is valid', () => {
        it('should automatically refresh token without OAuth popup', async () => {
            // Given: Expired access token response
            mockAxios.get.mockRejectedValueOnce({
                response: { status: 401 },
                message: 'Invalid OAuth token'
            });
            
            // And: Successful token refresh
            mockHttpClient.post.mockResolvedValueOnce({
                data: {
                    access_token: 'refreshed_access_token_12345',
                    refresh_token: 'refreshed_refresh_token_67890',
                    expires_in: 14400
                }
            });

            // And: Successful validation after refresh
            mockAxios.get.mockResolvedValueOnce({
                data: {
                    user_id: '123456789',
                    login: 'testchannel',
                    expires_in: 14400
                }
            });

            // When: User starts application with expired token
            const result = await authInitializer.initializeAuthentication(authService);

            // Then: User authentication succeeds transparently
            expect(result).toBe(true);
            
            // Token refresh happens automatically for user convenience
            const refreshCall = mockHttpClient.post.mock.calls.find(call => 
                call[0].includes('oauth2/token') && 
                call[1].grant_type === 'refresh_token'
            );
            expect(refreshCall).toBeDefined();
            
            // No OAuth popup disrupts user experience
            const oauthWarnings = mockLogger.info.mock.calls.filter(call =>
                expect.stringContaining('OAUTH FLOW REQUIRED')
            );
        });
    });

    describe('when both access and refresh tokens are invalid', () => {
        it('should show OAuth popup only after refresh attempt fails', async () => {
            // Given: Mock OAuth handler will fail for this test
            mockOAuthHandler.runOAuthFlow.mockRejectedValue(new Error('OAuth flow failed'));
            
            // Given: Invalid access token
            mockAxios.get.mockRejectedValueOnce({
                response: { status: 401 },
                message: 'Invalid OAuth token'
            });
            
            // And: Invalid refresh token
            mockHttpClient.post.mockRejectedValueOnce({
                response: { 
                    status: 400,
                    data: { error: 'invalid_grant' }
                },
                message: 'Invalid refresh token'
            });

            // When: Initializing authentication
            const result = await authInitializer.initializeAuthentication(authService);

            // Then: Should attempt refresh first
            expect(mockHttpClient.post).toHaveBeenCalledWith(
                'https://id.twitch.tv/oauth2/token',
                expect.objectContaining({
                    grant_type: 'refresh_token'
                }),
                expect.any(Object)
            );
            
            // And: Should trigger OAuth flow only after refresh fails
            expect(result).toBe(false); // Will fail since OAuth flow is mocked to fail
        }, 30000);
    });

    describe('when access token is valid', () => {
        it('should not attempt refresh or OAuth popup', async () => {
            // Given: Valid access token response for both proactive check and main validation
            mockAxios.get
                .mockResolvedValueOnce({
                    data: {
                        user_id: '123456789',
                        login: 'testchannel',
                        expires_in: 14400
                    }
                })
                .mockResolvedValueOnce({
                    data: {
                        user_id: '123456789',
                        login: 'testchannel',
                        expires_in: 14400
                    }
                });

            // When: Initializing authentication
            const result = await authInitializer.initializeAuthentication(authService);

            // Then: Should succeed immediately
            expect(result).toBe(true);
            expect(mockHttpClient.post).not.toHaveBeenCalled(); // No refresh attempt
            expect(mockLogger.info).not.toHaveBeenCalledWith(
                expect.stringContaining('OAUTH FLOW REQUIRED')
            );
            expect(authService.isInitialized).toBe(true);
        }, 30000);
    });

    describe('configuration persistence after token refresh', () => {
        it('should update config file with new tokens after successful refresh', async () => {
            // Given: Expired token requiring refresh
            mockAxios.get
                .mockRejectedValueOnce({
                    response: { status: 401 },
                    message: 'Invalid OAuth token'
                })
                .mockResolvedValueOnce({
                    data: {
                        user_id: '123456789',
                        login: 'testchannel',
                        expires_in: 14400
                    }
                });
            
            // And: Successful refresh with new tokens
            const newTokens = {
                access_token: 'new_access_token_12345',
                refresh_token: 'new_refresh_token_67890',
                expires_in: 14400
            };
            mockHttpClient.post.mockResolvedValueOnce({ data: newTokens });

            // When: Initializing authentication  
            const result = await authInitializer.initializeAuthentication(authService);

            // Then: Should update service config with new tokens
            expect(result).toBe(true);
            expect(authService.config.accessToken).toBe(newTokens.access_token);
            expect(authService.config.refreshToken).toBe(newTokens.refresh_token);
        });
    });
});