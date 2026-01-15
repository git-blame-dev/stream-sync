const { describe, test, expect, beforeEach, it } = require('bun:test');
const { createMockFn, spyOn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/auth/TwitchAuthFactory');
mockModule('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: createMockFn(() => ({
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn()
    })),
    ensurePlatformErrorHandler: createMockFn((existing, logger, name) => existing || ({
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn()
    }))
}));
mockModule('../../../src/utils/user-friendly-errors', () => ({
    handleUserFacingError: createMockFn()
}));

const TwitchAuthFactory = require('../../../src/auth/TwitchAuthFactory');
const { handleUserFacingError } = require('../../../src/utils/user-friendly-errors');
const { TokenValidator } = require('../../../src/auth/token-validator');

describe('token-validator behavior', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    const baseConfig = {
        clientId: 'cid',
        clientSecret: 'secret',
        accessToken: 'token',
        refreshToken: 'refresh'
    };

    const createAuthFactory = (managerImpl) => {
        const factory = {
            getInitializedAuthManager: createMockFn(async () => managerImpl),
            cleanup: createMockFn()
        };
        TwitchAuthFactory.mockImplementation(() => factory);
        return factory;
    };

    beforeEach(() => {
        });

    it('flags missing tokens and placeholders as needing new tokens', async () => {
        const validator = new TokenValidator();

        const missing = await validator.validateTwitchTokens({ clientId: 'cid', clientSecret: 's' });
        expect(missing.needsNewTokens).toBe(true);
        expect(missing.isValid).toBe(false);

        const placeholder = await validator.validateTwitchTokens({ ...baseConfig, accessToken: 'test_token_123' });
        expect(placeholder.needsNewTokens).toBe(true);
    });

    it('flags missing client credentials as blocking authentication', async () => {
        const validator = new TokenValidator();

        const result = await validator.validateTwitchTokens({ accessToken: 'token', refreshToken: 'refresh' });

        expect(result.isValid).toBe(false);
        expect(result.missingClientCredentials).toBe(true);
    });

    it('prompts for missing client credentials and skips OAuth flow', async () => {
        const validator = new TokenValidator();
        const oauthSpy = spyOn(validator, 'runOAuthFlow').mockResolvedValue({
            access_token: 'token',
            refresh_token: 'refresh'
        });
        const results = {
            isValid: false,
            platforms: {
                twitch: {
                    isValid: false,
                    missingClientCredentials: true,
                    errors: ['Missing clientId or clientSecret']
                }
            }
        };

        const isValid = await validator.handleAuthenticationFlow(results, { twitch: {} });

        expect(isValid).toBe(false);
        expect(oauthSpy).toHaveBeenCalledTimes(0);
        expect(handleUserFacingError).toHaveBeenCalled();
        const [error] = handleUserFacingError.mock.calls[0];
        expect(error.message).toMatch(/Missing clientId or clientSecret/);
    });

    it('bubbles scope validation retryable errors without forcing new tokens', async () => {
        const validator = new TokenValidator();
        spyOn(validator, '_validateTokenScopes').mockResolvedValue({ valid: false, errors: ['Network'], retryable: true });

        const result = await validator.validateTwitchTokens(baseConfig);

        expect(result.retryable).toBe(true);
        expect(result.needsNewTokens).toBe(false);
    });

    it('returns validated auth manager on success', async () => {
        const authManager = {
            getAccessToken: createMockFn(async () => 'token'),
            getAuthProvider: createMockFn(() => ({})),
            getUserId: createMockFn(() => 'user')
        };
        const factory = createAuthFactory(authManager);
        const validator = new TokenValidator();
        spyOn(validator, '_validateTokenScopes').mockResolvedValue({ valid: true, errors: [] });

        const result = await validator.validateTwitchTokens(baseConfig);

        expect(result.isValid).toBe(true);
        expect(result.userExperience).toBe('seamless');
        expect(result.authManager).toBe(authManager);
        expect(factory.getInitializedAuthManager).toHaveBeenCalled();
    });

    it('marks needsRefresh when auth manager throws token error', async () => {
        const factory = {
            getInitializedAuthManager: createMockFn(async () => { throw new Error('Invalid refresh token'); }),
            cleanup: createMockFn()
        };
        TwitchAuthFactory.mockImplementation(() => factory);
        const validator = new TokenValidator();
        spyOn(validator, '_validateTokenScopes').mockResolvedValue({ valid: true, errors: [] });

        const result = await validator.validateTwitchTokens(baseConfig);

        expect(result.needsRefresh).toBe(true);
        expect(result.needsNewTokens).toBe(true);
    });
});
