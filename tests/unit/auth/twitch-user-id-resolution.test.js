
const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const TwitchAuthInitializer = require('../../../src/auth/TwitchAuthInitializer');
const TwitchAuthService = require('../../../src/auth/TwitchAuthService');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../src/core/secrets');

describe('Twitch User ID Resolution', () => {
    let authService;
    let mockLogger;
    let mockAxios;
    let mockEnhancedHttpClient;
    let mockFs;

    beforeEach(() => {
        mockLogger = noOpLogger;

        mockAxios = {
            get: createMockFn()
        };

        mockEnhancedHttpClient = {
            post: createMockFn()
        };

        mockFs = {
            readFileSync: createMockFn().mockReturnValue('[twitch]\naccessToken=old_token\nrefreshToken=old_refresh'),
            writeFileSync: createMockFn()
        };

        const config = {
            clientId: 'test_client_id',
            accessToken: 'test_access_token_12345',
            refreshToken: 'test_refresh_token_67890',
            channel: 'hero_stream',
            username: 'hero_stream'
        };

        authService = new TwitchAuthService(config, { logger: mockLogger });

        _resetForTesting();
        secrets.twitch.clientSecret = 'test_client_secret';
    });

    afterEach(() => {
        restoreAllMocks();
        _resetForTesting();
        initializeStaticSecrets();
    });

    describe('when initializing authentication', () => {
        it('should get real user ID from Twitch API instead of hardcoded value', async () => {
            const mockResponse = {
                data: {
                    client_id: 'test_client_id',
                    login: 'hero_stream',
                    scopes: ['user:read:chat', 'chat:edit'],
                    user_id: '987654321',
                    expires_in: 7200
                }
            };

            mockAxios.get.mockResolvedValue(mockResponse);

            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                axios: mockAxios,
                enhancedHttpClient: mockEnhancedHttpClient,
                fs: mockFs
            });

            const success = await authInitializer.initializeAuthentication(authService);

            expect(success).toBe(true);
            expect(authService.userId).toBe('987654321');
            expect(authService.userId).not.toBe('123456789');
        });

        it('should handle API validation failure gracefully', async () => {
            mockAxios.get.mockRejectedValue(new Error('Invalid token'));
            mockEnhancedHttpClient.post.mockRejectedValue(new Error('Refresh failed'));

            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                axios: mockAxios,
                enhancedHttpClient: mockEnhancedHttpClient,
                fs: mockFs
            });

            const success = await authInitializer.initializeAuthentication(authService);

            expect(success).toBe(false);
            expect(authService.userId).toBeNull();
        });

        it('should extract correct user ID from API response format', async () => {
            const testCases = [
                {
                    name: 'standard format',
                    apiResponse: { user_id: '555444333', login: 'hero_stream' },
                    expectedUserId: '555444333'
                },
                {
                    name: 'string user_id',
                    apiResponse: { user_id: '666555444', login: 'hero_stream' },
                    expectedUserId: '666555444'
                }
            ];

            for (const [index, testCase] of testCases.entries()) {
                mockAxios.get.mockClear();

                const config = {
                    clientId: 'test_client_id',
                    accessToken: `test_access_token_${index}`,
                    refreshToken: `test_refresh_token_${index}`,
                    channel: 'hero_stream',
                    username: 'hero_stream'
                };
                const testAuthService = new TwitchAuthService(config, { logger: mockLogger });

                const mockResponse = {
                    data: {
                        ...testCase.apiResponse,
                        client_id: 'test_client_id',
                        scopes: ['user:read:chat'],
                        expires_in: 7200
                    }
                };

                mockAxios.get.mockResolvedValue(mockResponse);

                const loopAuthInitializer = new TwitchAuthInitializer({
                    logger: mockLogger,
                    axios: mockAxios,
                    enhancedHttpClient: { post: createMockFn() },
                    fs: mockFs
                });

                const success = await loopAuthInitializer.initializeAuthentication(testAuthService);

                expect(success).toBe(true);
                expect(testAuthService.userId).toBe(testCase.expectedUserId);
            }
        });

        it('should validate user ID matches expected channel', async () => {
            const mockResponse = {
                data: {
                    user_id: '999888777',
                    login: 'different_user',
                    client_id: 'test_client_id',
                    scopes: ['user:read:chat'],
                    expires_in: 7200
                }
            };

            mockAxios.get.mockResolvedValue(mockResponse);

            const authInitializer = new TwitchAuthInitializer({
                logger: mockLogger,
                axios: mockAxios,
                enhancedHttpClient: mockEnhancedHttpClient,
                fs: mockFs
            });

            const success = await authInitializer.initializeAuthentication(authService);

            expect(success).toBe(false);
        });
    });
});
