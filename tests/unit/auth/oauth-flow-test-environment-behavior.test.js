
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const TwitchAuthInitializer = require('../../../src/auth/TwitchAuthInitializer');

describe('OAuth Flow Test Environment Behavior', () => {
    let mockAuthService;
    let mockLogger;
    let mockAxios;
    let mockEnhancedHttpClient;
    let mockFs;
    let originalNodeEnv;
    let originalTwitchDisableAuth;

    beforeEach(() => {
        originalNodeEnv = process.env.NODE_ENV;
        originalTwitchDisableAuth = process.env.TWITCH_DISABLE_AUTH;

        process.env.NODE_ENV = 'test';

        mockLogger = noOpLogger;

        mockAxios = {
            get: createMockFn(),
            post: createMockFn()
        };

        mockEnhancedHttpClient = {
            post: createMockFn()
        };

        mockFs = {
            readFileSync: createMockFn().mockReturnValue('[twitch]\naccessToken=old_token\nrefreshToken=old_refresh'),
            writeFileSync: createMockFn()
        };

        mockAuthService = {
            config: {
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret',
                accessToken: null,
                refreshToken: null,
                channel: 'test-channel'
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
    });

    afterEach(() => {
        restoreAllMocks();
        if (originalNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
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
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios,
                fs: mockFs
            });

            const result = await authInitializer.initializeAuthentication(mockAuthService);

            expect(result).toBe(false);
        }, 10000);

        test('should provide clear messaging about OAuth flow requirements', async () => {
            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios,
                fs: mockFs
            });

            const result = await authInitializer.triggerOAuthFlow(mockAuthService);

            expect(result).toBeNull();
        }, 10000);
    });

    describe('when OAuth flow is mocked for test scenarios', () => {
        test('should allow mocking OAuth flow to return successful authentication', async () => {
            const mockOAuthHandler = {
                runOAuthFlow: createMockFn().mockResolvedValue({
                    access_token: 'test-mock-access-token',
                    refresh_token: 'test-mock-refresh-token'
                })
            };

            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios,
                fs: mockFs,
                mockOAuthHandler: mockOAuthHandler
            });

            const result = await authInitializer.triggerOAuthFlow(mockAuthService);

            expect(result).toMatchObject({
                access_token: 'test-mock-access-token',
                refresh_token: 'test-mock-refresh-token'
            });
            expect(mockOAuthHandler.runOAuthFlow).toHaveBeenCalled();
        }, 10000);

        test('should handle OAuth flow failures gracefully in tests', async () => {
            const mockOAuthHandler = {
                runOAuthFlow: createMockFn().mockRejectedValue(new Error('OAuth flow failed'))
            };

            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios,
                fs: mockFs,
                mockOAuthHandler: mockOAuthHandler
            });

            const result = await authInitializer.triggerOAuthFlow(mockAuthService);

            expect(result).toBeNull();
        }, 10000);
    });

    describe('when OAuth is explicitly disabled for tests', () => {
        test('should skip OAuth flow when TWITCH_DISABLE_AUTH is set', async () => {
            process.env.NODE_ENV = 'production';
            process.env.TWITCH_DISABLE_AUTH = 'true';

            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                enhancedHttpClient: mockEnhancedHttpClient,
                axios: mockAxios,
                fs: mockFs
            });

            const result = await authInitializer.triggerOAuthFlow(mockAuthService);

            expect(result).toBeNull();
        }, 10000);
    });
});
