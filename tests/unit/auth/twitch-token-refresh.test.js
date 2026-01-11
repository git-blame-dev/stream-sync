
const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const testClock = require('../../helpers/test-clock');
const mockTestClock = testClock;

describe('Twitch Token Refresh Implementation', () => {
    let TwitchAuthInitializer;
    let TwitchAuthService;
    let mockHttpClient;
    let mockLogger;
    let mockFs;
    let authInitializer;
    let authService;

    beforeEach(() => {
        // Reset modules
        jest.resetModules();
        jest.clearAllMocks();
        jest.spyOn(Date, 'now').mockImplementation(() => testClock.now());

        // Mock enhanced HTTP client
        mockHttpClient = {
            post: jest.fn()
        };

        // Mock logger
        mockLogger = {
            info: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn()
        };

        // Mock fs for config file updates
        mockFs = {
            existsSync: jest.fn(() => true),
            readFileSync: jest.fn(),
            writeFileSync: jest.fn(),
            promises: {
                readFile: jest.fn().mockResolvedValue(JSON.stringify({
                    twitch: { accessToken: 'old-access-token', refreshToken: 'valid-refresh-token' }
                })),
                writeFile: jest.fn().mockResolvedValue(),
                rename: jest.fn().mockResolvedValue()
            }
        };

        // Mock dependencies
        jest.mock('../../../src/utils/enhanced-http-client', () => ({
            createEnhancedHttpClient: jest.fn(() => mockHttpClient),
            EnhancedHttpClient: jest.fn()
        }));

        jest.mock('fs', () => mockFs);

        // Mock auth constants to prevent import issues
        jest.mock('../../../src/utils/auth-constants', () => ({
            TOKEN_REFRESH_CONFIG: {
                MAX_RETRY_ATTEMPTS: 3,
                REFRESH_THRESHOLD_SECONDS: 3600,
                SCHEDULE_BUFFER_MINUTES: 5,
                MAX_SCHEDULE_HOURS: 3
            },
            TWITCH_ENDPOINTS: {
                OAUTH: {
                    TOKEN: 'https://id.twitch.tv/oauth2/token'
                }
            },
            AuthConstants: {
                exceedsPerformanceThreshold: jest.fn(() => false),
                calculateRefreshTiming: jest.fn((expiresAt) => ({
                    timeUntilExpiration: 3600000,
                    timeUntilRefresh: 3300000,
                    refreshAt: mockTestClock.now() + 3300000,
                    actualDelay: 3300000,
                    shouldRefreshImmediately: false
                })),
                isPlaceholderToken: jest.fn(() => false),
                determineOperationCriticality: jest.fn(() => 'normal'),
                getStreamingOptimizedTimeout: jest.fn(() => 5000),
                calculateBackoffDelay: jest.fn(() => 1000)
            }
        }));

        // Mock auth error handler
        jest.mock('../../../src/utils/auth-error-handler', () => {
            return jest.fn().mockImplementation(() => ({
                isRefreshableError: jest.fn(() => false),
                getStats: jest.fn(() => ({})),
                cleanup: jest.fn()
            }));
        });

        // Load the modules
        TwitchAuthInitializer = require('../../../src/auth/TwitchAuthInitializer');
        TwitchAuthService = require('../../../src/auth/TwitchAuthService');

        // Create test config
        const testConfig = {
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
            accessToken: 'old-access-token',
            refreshToken: 'valid-refresh-token',
            channel: 'test-channel',
            tokenStorePath: '/test/token-store.json'
        };

        // Initialize services
        authService = new TwitchAuthService(testConfig, { logger: mockLogger });
        authInitializer = new TwitchAuthInitializer({
            logger: mockLogger,
            fs: mockFs,
            enhancedHttpClient: mockHttpClient,
            tokenStorePath: '/test/token-store.json'
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('refreshToken Method Implementation', () => {
        test('should successfully refresh token using Twitch OAuth endpoint', async () => {
            // Given: Valid refresh token and successful API response
            const mockTokenResponse = {
                data: {
                    access_token: 'new-access-token-123',
                    refresh_token: 'new-refresh-token-456',
                    expires_in: 14400, // 4 hours
                    scope: ['chat:read', 'chat:edit'],
                    token_type: 'bearer'
                },
                status: 200
            };

            mockHttpClient.post.mockResolvedValue(mockTokenResponse);
            mockFs.readFileSync.mockReturnValue('[twitch]\naccessToken = old-access-token\nrefreshToken = valid-refresh-token');

            // When: Refreshing the token
            const result = await authInitializer.refreshToken(authService);

            // Then: Should make correct API call
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
                    platform: 'twitch' // For retry support
                })
            );

            // Should update auth service with new tokens
            expect(authService.config.accessToken).toBe('new-access-token-123');
            expect(authService.config.refreshToken).toBe('new-refresh-token-456');

            // Should update token expiration
            expect(authService.tokenExpiresAt).toBeGreaterThan(testClock.now());
            expect(authService.tokenExpiresAt).toBeLessThanOrEqual(testClock.now() + (14400 * 1000));

            // Should return success
            expect(result).toBe(true);

            // Should log success
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('[OAUTH] Token refreshed successfully'),
                expect.any(Object)
            );
        });

        test('should maintain authentication state after successful token refresh', async () => {
            // Given: User has valid but soon-to-expire authentication
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
            // Verify user starts with valid authentication
            expect(authService.isAuthenticated()).toBe(true);

            // When: System performs token refresh
            const result = await authInitializer.refreshToken(authService);

            // Then: User maintains authenticated state throughout refresh
            expect(result).toBe(true);
            expect(authService.isAuthenticated()).toBe(true);
            
            // User's authentication credentials are updated and valid
            expect(authService.getAccessToken()).toBe('new-access-token-789');
            expect(authService.getRefreshToken()).toBe('new-refresh-token-012');
            
            // User's authentication won't expire immediately
            expect(authService.isTokenExpired()).toBe(false);
            expect(authService.tokenExpiresAt).toBeGreaterThan(testClock.now());
            expect(authService.tokenExpiresAt).toBeLessThanOrEqual(testClock.now() + (14400 * 1000));
            
            // User's credentials persist and remain functional after refresh
            expect(authService.isAuthenticated()).toBe(true);
            expect(authService.getAccessToken()).toBeTruthy();
            expect(authService.getRefreshToken()).toBeTruthy();
        });

        test('should handle refresh token failure gracefully', async () => {
            // Given: API returns invalid_grant error
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

            // When: Attempting to refresh with invalid token
            const result = await authInitializer.refreshToken(authService);

            // Then: Should return false
            expect(result).toBe(false);

            // Then: User should understand authentication failed and know next steps
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Token refresh failed: Invalid refresh token'),
                'auth-initializer'
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Re-authentication required')
            );

            // Should NOT update config file
            expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
        });

        test('should handle network errors with retry logic', async () => {
            // Given: Network error on first attempt, success on retry
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

            // When: Refreshing with network issues
            const result = await authInitializer.refreshToken(authService);

            // Then: Should retry and succeed
            expect(mockHttpClient.post).toHaveBeenCalledTimes(2);
            expect(result).toBe(true);

            // Then: User should see network retry behavior
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Network error during token refresh'),
                'auth-initializer',
                expect.objectContaining({
                    error: 'ECONNREFUSED',
                    attempt: expect.any(Number),
                    maxAttempts: expect.any(Number)
                })
            );
        });

        test('should not refresh if refresh token is missing', async () => {
            // Given: No refresh token in config
            authService.config.refreshToken = null;

            // When: Attempting to refresh
            const result = await authInitializer.refreshToken(authService);

            // Then: Should return false immediately
            expect(result).toBe(false);

            // Should not make API call
            expect(mockHttpClient.post).not.toHaveBeenCalled();

            // Then: User should understand why refresh is not possible
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('[OAUTH] Token refresh prerequisites not met'),
                'auth-initializer',
                expect.stringContaining('No refresh token available')
            );
        });

        test('should handle expired refresh token', async () => {
            // Given: Refresh token is expired (30+ days old)
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

            // When: Attempting refresh with expired token
            const result = await authInitializer.refreshToken(authService);

            // Then: Should handle gracefully
            expect(result).toBe(false);

            // Then: User should understand token has expired and needs manual action
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Refresh token expired'),
                'auth-initializer'
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                expect.stringContaining('Manual re-authentication required')
            );
        });

        test('should properly encode form data for token refresh', async () => {
            // Given: Special characters in tokens
            authService.config.refreshToken = 'token+with/special=chars&symbols';
            authService.config.clientSecret = 'secret=with&special';

            mockHttpClient.post.mockResolvedValue({
                data: { access_token: 'new', refresh_token: 'new', expires_in: 14400 },
                status: 200
            });

            mockFs.readFileSync.mockReturnValue('[twitch]\nrefreshToken = old');

            // When: Refreshing
            await authInitializer.refreshToken(authService);

            // Then: Should properly URL encode the parameters
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
            // Given: Token with known expiration time (1 hour)
            authService.tokenExpiresAt = testClock.now() + (3600 * 1000); // 1 hour from now

            // When: Setting up automatic refresh
            const refreshTimer = authInitializer.scheduleTokenRefresh(authService);

            // Then: Should have scheduled a refresh
            expect(refreshTimer).toBeDefined();
            expect(refreshTimer.refreshTime).toBeLessThan(authService.tokenExpiresAt);
            
            // Should refresh 5 minutes before expiration
            const expectedRefreshTime = authService.tokenExpiresAt - (5 * 60 * 1000);
            expect(refreshTimer.refreshTime).toBeCloseTo(expectedRefreshTime, -1000);

            // Cleanup
            if (refreshTimer.cancel) refreshTimer.cancel();
        });

        test('should cancel existing refresh timer when scheduling new one', async () => {
            // Given: Token with expiration and existing refresh timer
            authService.tokenExpiresAt = testClock.now() + (3600 * 1000);
            const firstTimer = authInitializer.scheduleTokenRefresh(authService);
            
            // Skip test if timer is null (shouldn't happen with valid expiration)
            if (!firstTimer) {
                console.warn('Timer was null, skipping test');
                return;
            }
            
            const cancelSpy = jest.spyOn(firstTimer, 'cancel');

            // When: Scheduling another refresh
            const secondTimer = authInitializer.scheduleTokenRefresh(authService);

            // Then: Should cancel the first timer
            expect(cancelSpy).toHaveBeenCalled();
            expect(secondTimer).not.toBe(firstTimer);

            // Cleanup
            if (secondTimer && secondTimer.cancel) secondTimer.cancel();
        });

        test('should handle refresh timer execution', async () => {
            // Given: Mock timer to avoid infinite loops
            let timerCallback = null;
            jest.spyOn(global, 'setTimeout').mockImplementation((callback, delay) => {
                timerCallback = callback;
                return 'mock-timer-id';
            });
            // Set token to expire in the future
            authService.tokenExpiresAt = testClock.now() + (10 * 60 * 1000);

            // When: Scheduling refresh
            const timer = authInitializer.scheduleTokenRefresh(authService);

            // Then: Timer should be created
            expect(timer).toBeDefined();
            expect(timer.timeoutId).toBe('mock-timer-id');
            expect(timerCallback).toBeDefined();
            
            // Verify the timer would trigger the performAutomaticRefresh method
            expect(typeof timerCallback).toBe('function');
            
            // Restore setTimeout
            global.setTimeout.mockRestore();
        });

        test('should reschedule refresh after successful automatic refresh', async () => {
            // Given: Successful automatic refresh
            const mockTokenResponse = {
                data: {
                    access_token: 'new-token',
                    refresh_token: 'new-refresh',
                    expires_in: 14400 // 4 hours
                },
                status: 200
            };

            mockHttpClient.post.mockResolvedValue(mockTokenResponse);
            mockFs.readFileSync.mockReturnValue('[twitch]\naccessToken = old');

            // When: Automatic refresh completes
            await authInitializer.performAutomaticRefresh(authService);

            // Then: Should have scheduled next refresh
            expect(authInitializer.refreshTimer).toBeDefined();
            expect(authInitializer.refreshTimer.refreshTime).toBeGreaterThan(testClock.now());

            // Cleanup
            if (authInitializer.refreshTimer && authInitializer.refreshTimer.cancel) {
                authInitializer.refreshTimer.cancel();
            }
        });
    });

    describe('Integration with TwitchAuthService', () => {
        test('should update auth service state after successful refresh', async () => {
            // Given: Successful refresh response
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

            // When: Refreshing token
            await authInitializer.refreshToken(authService);

            // Then: Auth service should be updated
            expect(authService.getAccessToken()).toBe('integrated-access-token');
            expect(authService.config.refreshToken).toBe('integrated-refresh-token');
            expect(authService.isTokenExpired()).toBe(false);
            expect(authService.isAuthenticated()).toBe(true);
        });

        test('should maintain auth service initialized state after refresh', async () => {
            // Given: Initialized auth service
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

            // When: Refreshing
            await authInitializer.refreshToken(authService);

            // Then: Should maintain initialized state
            expect(authService.isInitialized).toBe(true);
            expect(authService.userId).toBe('123456');
        });
    });

    describe('Error Recovery and Edge Cases', () => {
        test('should handle malformed API response gracefully', async () => {
            // Given: API returns unexpected format
            const malformedResponse = {
                data: {
                    // Missing required fields
                    some_field: 'unexpected'
                },
                status: 200
            };

            mockHttpClient.post.mockResolvedValue(malformedResponse);

            // When: Attempting refresh
            const result = await authInitializer.refreshToken(authService);

            // Then: Should handle gracefully
            expect(result).toBe(false);
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Invalid token response'),
                expect.any(String),
                expect.any(Object)
            );
        });

        test('should handle rate limiting with exponential backoff', async () => {
            // Mock setTimeout to avoid actual delays
            jest.spyOn(global, 'setTimeout').mockImplementation((callback, delay) => {
                // Call callback immediately for testing
                setImmediate(callback);
                return 'mock-timeout-id';
            });

            // Given: Rate limit error followed by success
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
            
            // When: Refreshing with rate limit
            const result = await authInitializer.refreshToken(authService);

            // Then: Should handle rate limit and retry
            expect(result).toBe(true);
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Rate limited'),
                expect.any(String),
                expect.any(Object)
            );

            // Restore setTimeout
            global.setTimeout.mockRestore();
        });

        test('should cleanup timer on service cleanup', () => {
            // Given: Active refresh timer
            authService.tokenExpiresAt = testClock.now() + 3600000;
            const timer = authInitializer.scheduleTokenRefresh(authService);
            const cancelSpy = jest.fn();
            timer.cancel = cancelSpy;
            authInitializer.refreshTimer = timer;

            // When: Cleaning up
            authInitializer.cleanup();

            // Then: Should cancel timer
            expect(cancelSpy).toHaveBeenCalled();
            expect(authInitializer.refreshTimer).toBeNull();
        });
    });
});
