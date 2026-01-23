
const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const { TokenValidator } = require('../../../src/auth/token-validator');

describe('token-validator behavior', () => {
    let mockLogger;

    afterEach(() => {
        restoreAllMocks();
    });

    beforeEach(() => {
        mockLogger = noOpLogger;
    });

    const baseConfig = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token'
    };

    const createMockAuthFactory = (managerImpl) => ({
        getInitializedAuthManager: createMockFn(async () => managerImpl),
        cleanup: createMockFn()
    });

    it('flags missing tokens and placeholders as needing new tokens', async () => {
        const validator = new TokenValidator();
        validator.logger = mockLogger;

        const missing = await validator.validateTwitchTokens({
            clientId: 'test-client-id',
            clientSecret: 'test-secret'
        });
        expect(missing.needsNewTokens).toBe(true);
        expect(missing.isValid).toBe(false);

        const placeholder = await validator.validateTwitchTokens({
            ...baseConfig,
            accessToken: 'test_token_123'
        });
        expect(placeholder.needsNewTokens).toBe(true);
    });

    it('flags missing client credentials as blocking authentication', async () => {
        const validator = new TokenValidator();
        validator.logger = mockLogger;

        const result = await validator.validateTwitchTokens({
            accessToken: 'test-token',
            refreshToken: 'test-refresh'
        });

        expect(result.isValid).toBe(false);
        expect(result.missingClientCredentials).toBe(true);
    });

    it('prompts for missing client credentials and skips OAuth flow', async () => {
        const validator = new TokenValidator();
        validator.logger = mockLogger;
        const oauthSpy = spyOn(validator, 'runOAuthFlow').mockResolvedValue({
            access_token: 'test-token',
            refresh_token: 'test-refresh'
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
    });

    it('bubbles scope validation retryable errors without forcing new tokens', async () => {
        const validator = new TokenValidator();
        validator.logger = mockLogger;
        spyOn(validator, '_validateTokenScopes').mockResolvedValue({
            valid: false,
            errors: ['Network'],
            retryable: true
        });

        const result = await validator.validateTwitchTokens(baseConfig);

        expect(result.retryable).toBe(true);
        expect(result.needsNewTokens).toBe(false);
    });

    it('returns validated auth manager on success', async () => {
        const authManager = {
            getAccessToken: createMockFn(async () => 'test-token'),
            getAuthProvider: createMockFn(() => ({})),
            getUserId: createMockFn(() => 'test-user-id')
        };
        const mockFactory = createMockAuthFactory(authManager);
        const validator = new TokenValidator(mockFactory);
        validator.logger = mockLogger;
        spyOn(validator, '_validateTokenScopes').mockResolvedValue({
            valid: true,
            errors: []
        });

        const result = await validator.validateTwitchTokens(baseConfig);

        expect(result.isValid).toBe(true);
        expect(result.userExperience).toBe('seamless');
        expect(result.authManager).toBe(authManager);
        expect(mockFactory.getInitializedAuthManager).toHaveBeenCalled();
    });

    it('marks needsRefresh when auth manager throws token error', async () => {
        const mockFactory = {
            getInitializedAuthManager: createMockFn(async () => {
                throw new Error('Invalid refresh token');
            }),
            cleanup: createMockFn()
        };
        const validator = new TokenValidator(mockFactory);
        validator.logger = mockLogger;
        spyOn(validator, '_validateTokenScopes').mockResolvedValue({
            valid: true,
            errors: []
        });

        const result = await validator.validateTwitchTokens(baseConfig);

        expect(result.needsRefresh).toBe(true);
        expect(result.needsNewTokens).toBe(true);
    });
});
