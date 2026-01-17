
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const TwitchAuthInitializer = require('../../../src/auth/TwitchAuthInitializer');
const TwitchAuthService = require('../../../src/auth/TwitchAuthService');

describe('Authentication Integration Behavior', () => {
    let mockAxios;
    let mockEnhancedHttpClient;
    let mockFileSystem;

    beforeEach(() => {
        mockAxios = {
            get: createMockFn(),
            post: createMockFn()
        };

        mockEnhancedHttpClient = {
            post: createMockFn()
        };

        mockFileSystem = {
            readFileSync: createMockFn().mockReturnValue('[twitch]\naccessToken=old_token\nrefreshToken=old_refresh'),
            writeFileSync: createMockFn()
        };
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('when authentication initialization completes successfully', () => {
        test('should integrate all auth components for complete workflow', async () => {
            const authConfig = {
                clientId: 'test-integration-client-id',
                clientSecret: 'test-integration-client-secret',
                accessToken: 'test-valid-integration-token',
                refreshToken: 'test-valid-integration-refresh',
                channel: 'test-integration-user'
            };

            const authService = new TwitchAuthService(authConfig, { logger: noOpLogger });

            const mockResponse = {
                data: {
                    user_id: '555666777',
                    login: 'test-integration-user',
                    expires_in: 14400
                }
            };
            mockAxios.get.mockResolvedValue(mockResponse);

            const authInitializer = new TwitchAuthInitializer({
                logger: noOpLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios,
                fs: mockFileSystem
            });

            const result = await authInitializer.initializeAuthentication(authService);

            expect(result).toBe(true);
            expect(authService.isInitialized).toBe(true);
            expect(authService.userId).toBe('555666777');
        }, 10000);

        test('should maintain authentication state across component interactions', async () => {
            const authConfig = {
                clientId: 'test-state-client-id',
                clientSecret: 'test-state-client-secret',
                accessToken: 'test-state-test-token',
                refreshToken: 'test-state-test-refresh',
                channel: 'test-state-user'
            };

            const authService = new TwitchAuthService(authConfig, { logger: noOpLogger });

            const mockResponse = {
                data: {
                    user_id: '888999111',
                    login: 'test-state-user',
                    expires_in: 7200
                }
            };
            mockAxios.get.mockResolvedValue(mockResponse);

            const authInitializer = new TwitchAuthInitializer({
                logger: noOpLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios,
                fs: mockFileSystem
            });

            await authInitializer.initializeAuthentication(authService);

            expect(authService.isInitialized).toBe(true);
            expect(authService.config.accessToken).toBe('test-state-test-token');

            const userId = authService.getUserId();
            expect(userId).toBe('888999111');
        }, 10000);
    });

    describe('when authentication requires token refresh', () => {
        test('should integrate refresh flow with auth service updates', async () => {
            const authConfig = {
                clientId: 'test-refresh-client-id',
                clientSecret: 'test-refresh-client-secret',
                accessToken: 'test-expired-token',
                refreshToken: 'test-valid-refresh-token',
                channel: 'test-refresh-user'
            };

            const authService = new TwitchAuthService(authConfig, { logger: noOpLogger });

            mockAxios.get
                .mockRejectedValueOnce({
                    response: { status: 401 },
                    message: 'Invalid OAuth token'
                })
                .mockResolvedValueOnce({
                    data: {
                        user_id: '111222333',
                        login: 'test-refresh-user',
                        expires_in: 14400
                    }
                });

            mockEnhancedHttpClient.post.mockResolvedValue({
                data: {
                    access_token: 'test-new-refreshed-token',
                    refresh_token: 'test-new-refreshed-refresh',
                    expires_in: 14400
                }
            });

            const authInitializer = new TwitchAuthInitializer({
                logger: noOpLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios,
                fs: mockFileSystem
            });

            const result = await authInitializer.initializeAuthentication(authService);

            expect(result).toBe(true);
            expect(authService.config.accessToken).toBe('test-new-refreshed-token');
            expect(authService.config.refreshToken).toBe('test-new-refreshed-refresh');
            expect(authService.isInitialized).toBe(true);
            expect(authService.getUserId()).toBe('111222333');
            expect(authService.getStatus().hasValidTokens).toBe(true);
        }, 10000);

        test('should handle refresh failure and fallback to OAuth gracefully', async () => {
            const authConfig = {
                clientId: 'test-fallback-client-id',
                clientSecret: 'test-fallback-client-secret',
                accessToken: 'test-expired-token',
                refreshToken: 'test-invalid-refresh-token',
                channel: 'test-fallback-user'
            };

            const authService = new TwitchAuthService(authConfig, { logger: noOpLogger });

            mockAxios.get.mockRejectedValue({
                response: { status: 401 },
                message: 'Invalid OAuth token'
            });

            mockEnhancedHttpClient.post.mockRejectedValue({
                response: {
                    status: 400,
                    data: { error: 'invalid_grant' }
                },
                message: 'Invalid refresh token'
            });

            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'test';

            try {
                const authInitializer = new TwitchAuthInitializer({
                    logger: noOpLogger,
                    enhancedHttpClient: mockEnhancedHttpClient,
                    axios: mockAxios,
                    fs: mockFileSystem
                });

                const result = await authInitializer.initializeAuthentication(authService);

                expect(result).toBe(false);
                expect(authService.isInitialized).toBe(false);
            } finally {
                process.env.NODE_ENV = originalEnv;
            }
        }, 10000);
    });

    describe('when network issues occur during authentication', () => {
        test('should integrate retry logic across authentication components', async () => {
            const authConfig = {
                clientId: 'test-network-client-id',
                clientSecret: 'test-network-client-secret',
                accessToken: 'test-network-test-token',
                refreshToken: 'test-network-test-refresh',
                channel: 'test-network-user'
            };

            const authService = new TwitchAuthService(authConfig, { logger: noOpLogger });

            mockAxios.get
                .mockRejectedValueOnce(new Error('ECONNREFUSED'))
                .mockResolvedValueOnce({
                    data: {
                        user_id: '444555666',
                        login: 'test-network-user',
                        expires_in: 10800
                    }
                });

            mockEnhancedHttpClient.post.mockResolvedValue({
                data: {
                    access_token: 'test-network-refreshed-token',
                    refresh_token: 'test-network-refreshed-refresh',
                    expires_in: 14400
                }
            });

            const authInitializer = new TwitchAuthInitializer({
                logger: noOpLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios,
                fs: mockFileSystem
            });

            const result = await authInitializer.initializeAuthentication(authService);

            expect(result).toBe(true);
            expect(authService.isInitialized).toBe(true);
        }, 10000);
    });

    describe('when configuration management is required', () => {
        test('should integrate config updates across authentication components', async () => {
            const authConfig = {
                clientId: 'test-config-client-id',
                clientSecret: 'test-config-client-secret',
                accessToken: 'test-config-old-token',
                refreshToken: 'test-config-old-refresh',
                channel: 'test-config-user'
            };

            const authService = new TwitchAuthService(authConfig, { logger: noOpLogger });

            mockAxios.get
                .mockRejectedValueOnce({
                    response: { status: 401 },
                    message: 'Invalid OAuth token'
                })
                .mockResolvedValueOnce({
                    data: {
                        user_id: '777888999',
                        login: 'test-config-user',
                        expires_in: 14400
                    }
                });

            const newTokens = {
                access_token: 'test-config-new-token',
                refresh_token: 'test-config-new-refresh',
                expires_in: 14400
            };
            mockEnhancedHttpClient.post.mockResolvedValue({ data: newTokens });

            const authInitializer = new TwitchAuthInitializer({
                logger: noOpLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios,
                fs: mockFileSystem
            });

            const result = await authInitializer.initializeAuthentication(authService);

            expect(result).toBe(true);
            expect(authService.config.accessToken).toBe('test-config-new-token');
            expect(authService.config.refreshToken).toBe('test-config-new-refresh');
            expect(authService.isInitialized).toBe(true);
            expect(authService.getUserId()).toBe('777888999');
            expect(authService.getStatus().hasValidTokens).toBe(true);
            expect(authService.getStatus().configValid).toBe(true);
        }, 10000);
    });
});
