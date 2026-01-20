
const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const { TokenValidator } = require('../../../src/auth/token-validator');

describe('Token Validator Scope Reauth', () => {
    let validator;
    let mockLogger;
    let mockAxios;
    let mockProcessExit;

    beforeEach(() => {
        mockLogger = noOpLogger;

        mockAxios = {
            get: createMockFn(),
            post: createMockFn()
        };

        mockProcessExit = spyOn(process, 'exit').mockImplementation(() => {});

        validator = new TokenValidator(null, { axios: mockAxios });
        validator.logger = mockLogger;
    });

    afterEach(() => {
        restoreAllMocks();
        mockProcessExit.mockRestore();
    });

    describe('when tokens have scope mismatch', () => {
        it('should detect missing user:read:chat scope and trigger reauth', async () => {
            const config = {
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret',
                accessToken: 'test-valid-token-with-wrong-scopes',
                refreshToken: 'test-valid-refresh-token',
                channel: 'test-channel'
            };

            mockAxios.get.mockResolvedValue({
                data: {
                    scopes: ['chat:read', 'chat:edit', 'channel:read:subscriptions']
                }
            });

            const result = await validator.validateTwitchTokens(config);

            expect(result.isValid).toBe(false);
            expect(result.needsNewTokens).toBe(true);
            expect(result.errors).toContain('Missing required OAuth scope: user:read:chat');
        });

        it('should trigger complete OAuth flow when scopes are insufficient', async () => {
            const config = {
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret',
                accessToken: 'test-token-missing-scopes',
                refreshToken: 'test-refresh-token',
                channel: 'test-channel'
            };

            mockAxios.get.mockResolvedValue({
                data: {
                    scopes: ['chat:read']
                }
            });

            const runOAuthFlowSpy = spyOn(validator, 'runOAuthFlow').mockResolvedValue({
                access_token: 'test-oauth-access-token',
                refresh_token: 'test-oauth-refresh-token'
            });

            await validator.handleAuthenticationFlow(
                { isValid: false, platforms: { twitch: { isValid: false, needsNewTokens: true } } },
                { twitch: config }
            );

            expect(runOAuthFlowSpy).toHaveBeenCalledWith(config);
        });

        it('revalidates tokens in-memory after OAuth success without restart', async () => {
            const twitchConfig = {
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret',
                accessToken: 'test-stale-token',
                refreshToken: 'test-stale-refresh',
                channel: 'test-channel'
            };
            const results = {
                isValid: false,
                platforms: {
                    twitch: { isValid: false, needsNewTokens: true }
                }
            };

            const runOAuthFlowSpy = spyOn(validator, 'runOAuthFlow').mockResolvedValue({
                access_token: 'test-new-token',
                refresh_token: 'test-new-refresh'
            });
            const revalidation = {
                isValid: true,
                needsNewTokens: false,
                authManager: { getState: () => 'READY' }
            };
            const validateSpy = spyOn(validator, 'validateTwitchTokens').mockResolvedValue(revalidation);

            const outcome = await validator.handleAuthenticationFlow(results, { twitch: { ...twitchConfig } });

            expect(outcome).toBe(true);
            expect(process.exit).not.toHaveBeenCalled();
            expect(runOAuthFlowSpy).toHaveBeenCalled();
            expect(validateSpy).toHaveBeenCalledWith(expect.objectContaining({
                accessToken: 'test-new-token',
                refreshToken: 'test-new-refresh'
            }));
            expect(results.platforms.twitch).toBe(revalidation);

            validateSpy.mockRestore();
            runOAuthFlowSpy.mockRestore();
        });

        it('should validate all required EventSub scopes before accepting tokens', async () => {
            const config = {
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret',
                accessToken: 'test-incomplete-scopes-token',
                refreshToken: 'test-refresh-token',
                channel: 'test-channel'
            };

            mockAxios.get.mockResolvedValue({
                data: {
                    scopes: [
                        'chat:edit',
                        'channel:read:subscriptions'
                    ]
                }
            });

            const result = await validator.validateTwitchTokens(config);

            expect(result.isValid).toBe(false);
            expect(result.needsNewTokens).toBe(true);
            expect(result.errors.join(' ')).toContain('user:read:chat');
            expect(result.errors.join(' ')).toContain('moderator:read:followers');
            expect(result.errors.join(' ')).toContain('bits:read');
        });

        it('should accept tokens with all required EventSub scopes', async () => {
            const config = {
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret',
                accessToken: 'test-complete-scopes-token',
                refreshToken: 'test-refresh-token',
                channel: 'test-channel'
            };

            mockAxios.get.mockResolvedValueOnce({
                data: {
                    scopes: [
                        'user:read:chat',
                        'chat:edit',
                        'moderator:read:followers',
                        'channel:read:subscriptions',
                        'bits:read',
                        'channel:read:redemptions'
                    ]
                }
            });

            const result = await validator.validateTwitchTokens(config);

            expect(result.errors.join(' ')).not.toContain('Missing required OAuth scope');
            expect(result.errors.join(' ')).not.toContain('user:read:chat');
            expect(result.errors.join(' ')).not.toContain('moderator:read:followers');
        });
    });
});
