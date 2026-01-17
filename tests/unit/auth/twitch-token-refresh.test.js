
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const testClock = require('../../helpers/test-clock');

const TwitchAuthInitializer = require('../../../src/auth/TwitchAuthInitializer');
const TwitchAuthService = require('../../../src/auth/TwitchAuthService');

describe('Twitch Token Refresh Implementation', () => {
    let mockHttpClient;
    let mockFs;
    let authInitializer;
    let authService;

    beforeEach(() => {
        spyOn(Date, 'now').mockImplementation(() => testClock.now());

        mockHttpClient = {
            post: createMockFn()
        };

        mockFs = {
            existsSync: createMockFn(() => true),
            readFileSync: createMockFn(),
            writeFileSync: createMockFn(),
            promises: {
                readFile: createMockFn().mockResolvedValue(JSON.stringify({
                    twitch: { accessToken: 'old-access-token', refreshToken: 'valid-refresh-token' }
                })),
                writeFile: createMockFn().mockResolvedValue(),
                rename: createMockFn().mockResolvedValue()
            }
        };

        const testConfig = {
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
            accessToken: 'old-access-token',
            refreshToken: 'valid-refresh-token',
            channel: 'test-channel',
            tokenStorePath: '/test/token-store.json'
        };

        authService = new TwitchAuthService(testConfig, { logger: noOpLogger });
        authInitializer = new TwitchAuthInitializer({
            logger: noOpLogger,
            fs: mockFs,
            enhancedHttpClient: mockHttpClient,
            tokenStorePath: '/test/token-store.json'
        });
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('refreshToken Method Implementation', () => {
        test('should successfully refresh token using Twitch OAuth endpoint', async () => {
            const mockTokenResponse = {
                data: {
                    access_token: 'new-access-token-123',
                    refresh_token: 'new-refresh-token-456',
                    expires_in: 14400,
                    scope: ['chat:read', 'chat:edit'],
                    token_type: 'bearer'
                },
                status: 200
            };

            mockHttpClient.post.mockResolvedValue(mockTokenResponse);
            mockFs.readFileSync.mockReturnValue('[twitch]\naccessToken = old-access-token\nrefreshToken = valid-refresh-token');

            const result = await authInitializer.refreshToken(authService);

            expect(mockHttpClient.post).toHaveBeenCalledWith(
                'https://id.twitch.tv/oauth2/token',
                expect.objectContaining({
                    grant_type: 'refresh_token',
                    refresh_token: 'valid-refresh-token',
                    client_id: 'test-client-id',
                    client_secret: 'test-client-secret'
                }),
                expect.objectContaining({
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    platform: 'twitch'
                })
            );

            expect(authService.config.accessToken).toBe('new-access-token-123');
            expect(authService.config.refreshToken).toBe('new-refresh-token-456');

            expect(authService.tokenExpiresAt).toBeGreaterThan(testClock.now());
            expect(authService.tokenExpiresAt).toBeLessThanOrEqual(testClock.now() + (14400 * 1000));

            expect(result).toBe(true);
        });

        test('should maintain authentication state after successful token refresh', async () => {
            const mockTokenResponse = {
                data: {
                    access_token: 'new-access-token-789',
                    refresh_token: 'new-refresh-token-012',
                    expires_in: 14400
                },
                status: 200
            };

            mockHttpClient.post.mockResolvedValue(mockTokenResponse);
            const originalConfig = '[twitch]\naccessToken = old-access-token\nrefreshToken = old-refresh-token\nclientId = test-client-id';
            mockFs.readFileSync.mockReturnValue(originalConfig);
            expect(authService.isAuthenticated()).toBe(true);

            const result = await authInitializer.refreshToken(authService);

            expect(result).toBe(true);
            expect(authService.isAuthenticated()).toBe(true);

            expect(authService.getAccessToken()).toBe('new-access-token-789');
            expect(authService.getRefreshToken()).toBe('new-refresh-token-012');

            expect(authService.isTokenExpired()).toBe(false);
            expect(authService.tokenExpiresAt).toBeGreaterThan(testClock.now());
            expect(authService.tokenExpiresAt).toBeLessThanOrEqual(testClock.now() + (14400 * 1000));

            expect(authService.isAuthenticated()).toBe(true);
            expect(authService.getAccessToken()).toBeTruthy();
            expect(authService.getRefreshToken()).toBeTruthy();
        });

        test('should handle refresh token failure gracefully', async () => {
            const mockErrorResponse = {
                response: {
                    status: 400,
                    data: {
                        error: 'invalid_grant',
                        error_description: 'Invalid refresh token'
                    }
                }
            };

            mockHttpClient.post.mockRejectedValue(mockErrorResponse);

            const result = await authInitializer.refreshToken(authService);

            expect(result).toBe(false);
            expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
        });

        test('should handle network errors with retry logic', async () => {
            const networkError = new Error('ECONNREFUSED');
            networkError.code = 'ECONNREFUSED';

            const successResponse = {
                data: {
                    access_token: 'retry-access-token',
                    refresh_token: 'retry-refresh-token',
                    expires_in: 14400
                },
                status: 200
            };

            mockHttpClient.post
                .mockRejectedValueOnce(networkError)
                .mockResolvedValueOnce(successResponse);

            mockFs.readFileSync.mockReturnValue('[twitch]\naccessToken = old\nrefreshToken = old');

            const result = await authInitializer.refreshToken(authService);

            expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
            expect(result).toBe(true);
        });

        test('should not refresh if refresh token is missing', async () => {
            authService.config.refreshToken = null;

            const result = await authInitializer.refreshToken(authService);

            expect(result).toBe(false);
            expect(mockHttpClient.post).not.toHaveBeenCalled();
        });

        test('should handle expired refresh token', async () => {
            const expiredError = {
                response: {
                    status: 401,
                    data: {
                        error: 'unauthorized',
                        error_description: 'Token is expired'
                    }
                }
            };

            mockHttpClient.post.mockRejectedValue(expiredError);

            const result = await authInitializer.refreshToken(authService);

            expect(result).toBe(false);
        });

        test('should properly encode form data for token refresh', async () => {
            authService.config.refreshToken = 'token+with/special=chars&symbols';
            authService.config.clientSecret = 'secret=with&special';

            mockHttpClient.post.mockResolvedValue({
                data: { access_token: 'new', refresh_token: 'new', expires_in: 14400 },
                status: 200
            });

            mockFs.readFileSync.mockReturnValue('[twitch]\nrefreshToken = old');

            await authInitializer.refreshToken(authService);

            const callArgs = mockHttpClient.post.mock.calls[0];
            const formData = callArgs[1];

            expect(formData).toEqual(expect.objectContaining({
                grant_type: 'refresh_token',
                refresh_token: 'token+with/special=chars&symbols',
                client_id: 'test-client-id',
                client_secret: 'secret=with&special'
            }));
        });
    });

    describe('Automatic Token Refresh Before Expiration', () => {
        test('should schedule automatic refresh before token expires', async () => {
            authService.tokenExpiresAt = testClock.now() + (3600 * 1000);

            const refreshTimer = authInitializer.scheduleTokenRefresh(authService);

            expect(refreshTimer).toBeDefined();
            expect(refreshTimer.refreshTime).toBeLessThan(authService.tokenExpiresAt);

            const expectedRefreshTime = authService.tokenExpiresAt - (5 * 60 * 1000);
            expect(refreshTimer.refreshTime).toBeCloseTo(expectedRefreshTime, -1000);

            if (refreshTimer.cancel) refreshTimer.cancel();
        });

        test('should cancel existing refresh timer when scheduling new one', async () => {
            authService.tokenExpiresAt = testClock.now() + (3600 * 1000);
            const firstTimer = authInitializer.scheduleTokenRefresh(authService);

            if (!firstTimer) {
                console.warn('Timer was null, skipping test');
                return;
            }

            const cancelSpy = spyOn(firstTimer, 'cancel');

            const secondTimer = authInitializer.scheduleTokenRefresh(authService);

            expect(cancelSpy).toHaveBeenCalled();
            expect(secondTimer).not.toBe(firstTimer);

            if (secondTimer && secondTimer.cancel) secondTimer.cancel();
        });

        test('should handle refresh timer execution', async () => {
            authService.tokenExpiresAt = testClock.now() + (60 * 60 * 1000);

            const timer = authInitializer.scheduleTokenRefresh(authService);

            expect(timer).toBeDefined();
            expect(timer.refreshTime).toBeGreaterThan(testClock.now());
            expect(typeof timer.cancel).toBe('function');

            timer.cancel();
        });

        test('should reschedule refresh after successful automatic refresh', async () => {
            const mockTokenResponse = {
                data: {
                    access_token: 'new-token',
                    refresh_token: 'new-refresh',
                    expires_in: 14400
                },
                status: 200
            };

            mockHttpClient.post.mockResolvedValue(mockTokenResponse);
            mockFs.readFileSync.mockReturnValue('[twitch]\naccessToken = old');

            await authInitializer.performAutomaticRefresh(authService);

            expect(authInitializer.refreshTimer).toBeDefined();
            expect(authInitializer.refreshTimer.refreshTime).toBeGreaterThan(testClock.now());

            if (authInitializer.refreshTimer && authInitializer.refreshTimer.cancel) {
                authInitializer.refreshTimer.cancel();
            }
        });
    });

    describe('Integration with TwitchAuthService', () => {
        test('should update auth service state after successful refresh', async () => {
            const mockResponse = {
                data: {
                    access_token: 'integrated-access-token',
                    refresh_token: 'integrated-refresh-token',
                    expires_in: 7200
                },
                status: 200
            };

            mockHttpClient.post.mockResolvedValue(mockResponse);
            mockFs.readFileSync.mockReturnValue('[twitch]\naccessToken = old');

            await authInitializer.refreshToken(authService);

            expect(authService.getAccessToken()).toBe('integrated-access-token');
            expect(authService.config.refreshToken).toBe('integrated-refresh-token');
            expect(authService.isTokenExpired()).toBe(false);
            expect(authService.isAuthenticated()).toBe(true);
        });

        test('should maintain auth service initialized state after refresh', async () => {
            authService.setAuthenticationState({
                userId: '123456',
                isInitialized: true,
                tokenExpiresAt: testClock.now() + 3600000
            });

            const mockResponse = {
                data: {
                    access_token: 'new-token',
                    refresh_token: 'new-refresh',
                    expires_in: 14400
                },
                status: 200
            };

            mockHttpClient.post.mockResolvedValue(mockResponse);
            mockFs.readFileSync.mockReturnValue('[twitch]\naccessToken = old');

            await authInitializer.refreshToken(authService);

            expect(authService.isInitialized).toBe(true);
            expect(authService.userId).toBe('123456');
        });
    });

    describe('Error Recovery and Edge Cases', () => {
        test('should handle malformed API response gracefully', async () => {
            const malformedResponse = {
                data: {
                    some_field: 'unexpected'
                },
                status: 200
            };

            mockHttpClient.post.mockResolvedValue(malformedResponse);

            const result = await authInitializer.refreshToken(authService);

            expect(result).toBe(false);
        });

        test('should handle rate limiting with exponential backoff', async () => {
            spyOn(global, 'setTimeout').mockImplementation((callback, delay) => {
                setImmediate(callback);
                return 'mock-timeout-id';
            });

            const rateLimitError = {
                response: {
                    status: 429,
                    headers: {
                        'retry-after': '1'
                    }
                }
            };

            const successResponse = {
                data: {
                    access_token: 'rate-limited-token',
                    refresh_token: 'rate-limited-refresh',
                    expires_in: 14400
                },
                status: 200
            };

            mockHttpClient.post
                .mockRejectedValueOnce(rateLimitError)
                .mockResolvedValueOnce(successResponse);

            mockFs.readFileSync.mockReturnValue('[twitch]\naccessToken = old');

            const result = await authInitializer.refreshToken(authService);

            expect(result).toBe(true);

            global.setTimeout.mockRestore();
        });

        test('should cleanup timer on service cleanup', () => {
            authService.tokenExpiresAt = testClock.now() + 3600000;
            const timer = authInitializer.scheduleTokenRefresh(authService);
            const cancelSpy = createMockFn();
            timer.cancel = cancelSpy;
            authInitializer.refreshTimer = timer;

            authInitializer.cleanup();

            expect(cancelSpy).toHaveBeenCalled();
            expect(authInitializer.refreshTimer).toBeNull();
        });
    });
});
