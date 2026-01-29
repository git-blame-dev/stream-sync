
const { initializeTestLogging } = require('../../helpers/test-setup');
const { noOpLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../src/core/secrets');

initializeTestLogging();

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

const TwitchAuthService = require('../../../src/auth/TwitchAuthService');

describe('TwitchAuthService Placeholder Token Detection', () => {
    let authService;
    let mockLogger;

    beforeEach(() => {
        mockLogger = noOpLogger;
        _resetForTesting();
        secrets.twitch.clientSecret = 'valid_client_secret';
    });

    afterEach(() => {
        _resetForTesting();
        initializeStaticSecrets();
    });

    describe('when placeholder tokens are provided', () => {
        const placeholderTokens = [
            'new_access_123456789',
            'test_token_123',
            'placeholder_token',
            'your_access_token_here',
            'example_token',
            'demo_access_token',
            'temp_token_xyz'
        ];

        placeholderTokens.forEach(token => {
            it(`should detect "${token}" as placeholder token`, () => {
                const config = {
                    clientId: 'valid_client_id',
                    accessToken: token
                };

                authService = new TwitchAuthService(config, { logger: mockLogger });

                expect(authService.isAuthenticated()).toBe(false);
            });

            it(`should require OAuth flow for "${token}"`, () => {
                const config = {
                    clientId: 'valid_client_id',
                    accessToken: token
                };

                authService = new TwitchAuthService(config, { logger: mockLogger });
                const validation = authService.validateCredentials();

                expect(validation.hasToken).toBe(false);
                expect(validation.issues).toContain('accessToken is missing or invalid');
            });
        });
    });

    describe('when real tokens are provided', () => {
        it('should accept valid-looking real tokens', () => {
            const realTokens = [
                'abcdef1234567890abcdef1234567890',
                'oauth:abcdef1234567890abcdef1234567890',
                'Bearer abcdef1234567890abcdef1234567890'
            ];

            realTokens.forEach(token => {
                const config = {
                    clientId: 'valid_client_id',
                    accessToken: token
                };

                authService = new TwitchAuthService(config, { logger: mockLogger });

                expect(authService.isAuthenticated()).toBe(true);
            });
        });
    });

    describe('when obviously invalid tokens are provided', () => {
        const invalidTokens = [
            { token: '', description: 'empty string' },
            { token: null, description: 'null' },
            { token: undefined, description: 'undefined' },
            { token: 'undefined', description: '"undefined" string' },
            { token: 'null', description: '"null" string' }
        ];

        invalidTokens.forEach(({ token, description }) => {
            it(`should reject ${description} token`, () => {
                const config = {
                    clientId: 'valid_client_id',
                    accessToken: token
                };

                authService = new TwitchAuthService(config, { logger: mockLogger });

                const result = authService.isAuthenticated();
                expect(typeof result).toBe('boolean');
                expect(result).toBe(false);
            });
        });
    });
});
