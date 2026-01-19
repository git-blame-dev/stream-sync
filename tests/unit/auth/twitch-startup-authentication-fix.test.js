const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const TwitchAuthInitializer = require('../../../src/auth/TwitchAuthInitializer');
const TwitchAuthService = require('../../../src/auth/TwitchAuthService');

describe('Twitch Authentication User Experience', () => {
    let authService;
    let authInitializer;
    let mockHttpClient;
    let mockAxios;
    let mockOAuthHandler;

    beforeEach(() => {
        clearAllMocks();

        mockAxios = {
            get: createMockFn()
        };

        mockHttpClient = {
            post: createMockFn()
        };

        const config = {
            clientId: 'test_client_id',
            clientSecret: 'test_client_secret',
            accessToken: 'valid_access_token_12345',
            refreshToken: 'valid_refresh_token_67890',
            channel: 'testchannel'
        };

        authService = new TwitchAuthService(config, { logger: noOpLogger });

        const mockFs = {
            readFileSync: createMockFn().mockReturnValue('[twitch]\naccessToken=old_token\nrefreshToken=old_refresh'),
            writeFileSync: createMockFn()
        };

        mockOAuthHandler = {
            runOAuthFlow: createMockFn().mockResolvedValue({
                access_token: 'new-oauth-token',
                refresh_token: 'new-oauth-refresh'
            })
        };

        authInitializer = new TwitchAuthInitializer({
            logger: noOpLogger,
            enhancedHttpClient: mockHttpClient,
            fs: mockFs,
            axios: mockAxios,
            mockOAuthHandler: mockOAuthHandler
        });
    });

    afterEach(() => {
        clearAllMocks();
    });

    describe('when network issues occur during authentication', () => {
        it('should maintain user session without disruption', async () => {
            mockAxios.get
                .mockRejectedValueOnce(new Error('ECONNREFUSED'))
                .mockResolvedValueOnce({
                    data: {
                        user_id: '123456789',
                        login: 'testchannel',
                        expires_in: 14400
                    }
                });

            mockHttpClient.post.mockResolvedValueOnce({
                data: {
                    access_token: 'new_access_token_12345',
                    refresh_token: 'new_refresh_token_67890',
                    expires_in: 14400
                }
            });

            const result = await authInitializer.initializeAuthentication(authService);

            expect(result).toBe(true);

            const refreshCalls = mockHttpClient.post.mock.calls.filter(call =>
                call[0].includes('oauth2/token') &&
                call[1].grant_type === 'refresh_token'
            );
            expect(refreshCalls.length).toBeGreaterThan(0);
        });

        it('should retry token validation after successful refresh', async () => {
            mockAxios.get
                .mockRejectedValueOnce(new Error('ECONNREFUSED'))
                .mockResolvedValueOnce({
                    data: {
                        user_id: '123456789',
                        login: 'testchannel',
                        expires_in: 14400
                    }
                });

            mockHttpClient.post.mockResolvedValueOnce({
                data: {
                    access_token: 'new_access_token_12345',
                    refresh_token: 'new_refresh_token_67890',
                    expires_in: 14400
                }
            });

            const result = await authInitializer.initializeAuthentication(authService);

            expect(result).toBe(true);
            expect(mockAxios.get.mock.calls.length).toBe(2);
            expect(authService.isInitialized).toBe(true);
        });
    });

    describe('when access token is expired but refresh token is valid', () => {
        it('should automatically refresh token without OAuth popup', async () => {
            mockAxios.get.mockRejectedValueOnce({
                response: { status: 401 },
                message: 'Invalid OAuth token'
            });

            mockHttpClient.post.mockResolvedValueOnce({
                data: {
                    access_token: 'refreshed_access_token_12345',
                    refresh_token: 'refreshed_refresh_token_67890',
                    expires_in: 14400
                }
            });

            mockAxios.get.mockResolvedValueOnce({
                data: {
                    user_id: '123456789',
                    login: 'testchannel',
                    expires_in: 14400
                }
            });

            const result = await authInitializer.initializeAuthentication(authService);

            expect(result).toBe(true);

            const refreshCall = mockHttpClient.post.mock.calls.find(call =>
                call[0].includes('oauth2/token') &&
                call[1].grant_type === 'refresh_token'
            );
            expect(refreshCall).toBeDefined();
        });
    });

    describe('when both access and refresh tokens are invalid', () => {
        it('should show OAuth popup only after refresh attempt fails', async () => {
            mockOAuthHandler.runOAuthFlow.mockRejectedValue(new Error('OAuth flow failed'));

            mockAxios.get.mockRejectedValueOnce({
                response: { status: 401 },
                message: 'Invalid OAuth token'
            });

            mockHttpClient.post.mockRejectedValueOnce({
                response: {
                    status: 400,
                    data: { error: 'invalid_grant' }
                },
                message: 'Invalid refresh token'
            });

            const result = await authInitializer.initializeAuthentication(authService);

            expect(mockHttpClient.post).toHaveBeenCalledWith(
                'https://id.twitch.tv/oauth2/token',
                expect.objectContaining({
                    grant_type: 'refresh_token'
                }),
                expect.any(Object)
            );

            expect(result).toBe(false);
        }, { timeout: 30000 });
    });

    describe('when access token is valid', () => {
        it('should not attempt refresh or OAuth popup', async () => {
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

            const result = await authInitializer.initializeAuthentication(authService);

            expect(result).toBe(true);
            expect(mockHttpClient.post).not.toHaveBeenCalled();
            expect(authService.isInitialized).toBe(true);
        }, { timeout: 30000 });
    });

    describe('configuration persistence after token refresh', () => {
        it('should update config file with new tokens after successful refresh', async () => {
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

            const newTokens = {
                access_token: 'new_access_token_12345',
                refresh_token: 'new_refresh_token_67890',
                expires_in: 14400
            };
            mockHttpClient.post.mockResolvedValueOnce({ data: newTokens });

            const result = await authInitializer.initializeAuthentication(authService);

            expect(result).toBe(true);
            expect(authService.config.accessToken).toBe(newTokens.access_token);
            expect(authService.config.refreshToken).toBe(newTokens.refresh_token);
        });
    });
});
