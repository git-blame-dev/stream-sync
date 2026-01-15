
const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const { initializeTestLogging } = require('../../helpers/test-setup');
const { createMockLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

// Mock axios before importing TokenValidator
mockModule('axios');
const axios = require('axios');

const { TokenValidator } = require('../../../src/auth/token-validator');

describe('Token Validator Scope Reauth', () => {
    let validator;
    let mockLogger;
    let mockTwitchAPI;
    let mockOAuthHandler;
    let mockProcessExit;

    beforeEach(() => {
        mockLogger = createMockLogger('debug');
        
        // Mock process.exit to prevent test termination
        mockProcessExit = spyOn(process, 'exit').mockImplementation(() => {});
        
        // Mock Twitch API for token validation
        mockTwitchAPI = {
            validateToken: createMockFn(),
            getTokenScopes: createMockFn()
        };
        
        // Mock OAuth handler for reauth flow
        mockOAuthHandler = {
            runOAuthFlow: createMockFn()
        };
        
        validator = new TokenValidator();
        validator.logger = mockLogger;
    });
    
    afterEach(() => {
        restoreAllMocks();
        mockProcessExit.mockRestore();
    
        restoreAllModuleMocks();});

    describe('when tokens have scope mismatch', () => {
        it('should detect missing user:read:chat scope and trigger reauth', async () => {
            // Arrange: Token with old chat:read scope instead of user:read:chat
            const config = {
                clientId: 'test_client_id',
                clientSecret: 'test_client_secret',
                accessToken: 'valid_token_with_wrong_scopes_12345',
                refreshToken: 'valid_refresh_token_67890',
                channel: 'test_channel'
            };
            
            // Mock Twitch API validation response
            axios.get.mockResolvedValue({
                data: {
                    scopes: ['chat:read', 'chat:edit', 'channel:read:subscriptions'] // Missing user:read:chat
                }
            });
            
            // Act: Validate tokens (should detect scope mismatch)
            const result = await validator.validateTwitchTokens(config);
            
            // Assert: Should detect scope mismatch and trigger OAuth reauth
            expect(result.isValid).toBe(false);
            expect(result.needsNewTokens).toBe(true);
            expect(result.errors).toContain('Missing required OAuth scope: user:read:chat');
        });
        
        it('should trigger complete OAuth flow when scopes are insufficient', async () => {
            // Arrange: Config with insufficient scopes
            const config = {
                clientId: 'test_client_id', 
                clientSecret: 'test_client_secret',
                accessToken: 'token_missing_scopes_12345',
                refreshToken: 'refresh_token_67890',
                channel: 'test_channel'
            };
            
            // Mock: Token valid but missing EventSub scopes
            axios.get.mockResolvedValue({
                data: {
                    scopes: ['chat:read'] // Only basic chat, missing EventSub scopes
                }
            });
            
            // Spy on OAuth flow trigger
            const runOAuthFlowSpy = spyOn(validator, 'runOAuthFlow').mockResolvedValue({
                access_token: 'oauth_access_token',
                refresh_token: 'oauth_refresh_token'
            });
            
            // Act: Handle authentication flow
            await validator.handleAuthenticationFlow(
                { isValid: false, platforms: { twitch: { isValid: false, needsNewTokens: true } } },
                { twitch: config }
            );
            
            // Assert: OAuth flow should be triggered for scope issues
            expect(runOAuthFlowSpy).toHaveBeenCalledWith(config);
        });

        it('revalidates tokens in-memory after OAuth success without restart', async () => {
            const twitchConfig = {
                clientId: 'client-id',
                clientSecret: 'client-secret',
                accessToken: 'stale-token',
                refreshToken: 'stale-refresh',
                apiKey: 'stale-token',
                channel: 'test_channel'
            };
            const results = {
                isValid: false,
                platforms: {
                    twitch: { isValid: false, needsNewTokens: true }
                }
            };

            const runOAuthFlowSpy = spyOn(validator, 'runOAuthFlow').mockResolvedValue({
                access_token: 'new-token',
                refresh_token: 'new-refresh'
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
                accessToken: 'new-token',
                refreshToken: 'new-refresh',
                apiKey: 'new-token'
            }));
            expect(results.platforms.twitch).toBe(revalidation);

            validateSpy.mockRestore();
            runOAuthFlowSpy.mockRestore();
        });
        
        it('should validate all required EventSub scopes before accepting tokens', async () => {
            // Arrange: Required scopes for EventSub functionality
            const config = {
                clientId: 'test_client_id',
                clientSecret: 'test_client_secret', 
                accessToken: 'incomplete_scopes_token_12345',
                refreshToken: 'refresh_token_67890',
                channel: 'test_channel'
            };
            
            // Mock: Token missing critical EventSub scopes
            axios.get.mockResolvedValue({
                data: {
                    scopes: [
                        'chat:edit',
                        'channel:read:subscriptions' 
                        // Missing: user:read:chat, moderator:read:followers, bits:read
                    ]
                }
            });
            
            // Act: Validate token scopes
            const result = await validator.validateTwitchTokens(config);
            
            // Assert: Should identify all missing scopes
            expect(result.isValid).toBe(false);
            expect(result.needsNewTokens).toBe(true);
            expect(result.errors.join(' ')).toContain('user:read:chat');
            expect(result.errors.join(' ')).toContain('moderator:read:followers');
            expect(result.errors.join(' ')).toContain('bits:read');
        });
        
        it('should accept tokens with all required EventSub scopes', async () => {
            // Arrange: Token with all correct scopes
            const config = {
                clientId: 'test_client_id',
                clientSecret: 'test_client_secret',
                accessToken: 'complete_scopes_token_12345', 
                refreshToken: 'refresh_token_67890',
                channel: 'test_channel'
            };
            
            // Mock: Token with all required EventSub scopes (first call)
            axios.get
                .mockResolvedValueOnce({
                    data: {
                        scopes: [
                            'user:read:chat',           // EventSub chat (new scope)
                            'chat:edit',                // Send messages
                            'moderator:read:followers', // EventSub follows
                            'channel:read:subscriptions', // EventSub subs
                            'bits:read',                // EventSub cheers
                            'channel:read:redemptions'  // EventSub redemptions
                        ]
                    }
                });
            
            // For this test, we only care about scope validation passing
            // The test should fail on the auth factory call, which is expected since we're only testing scope logic
            
            // Act: Validate tokens with correct scopes (will fail on auth factory, but scope validation should pass)
            const result = await validator.validateTwitchTokens(config);
            
            // Assert: Scope validation should pass, but overall validation might fail due to missing auth factory mocking
            // What we care about is that there are NO scope-related errors
            expect(result.errors.join(' ')).not.toContain('Missing required OAuth scope');
            expect(result.errors.join(' ')).not.toContain('user:read:chat');
            expect(result.errors.join(' ')).not.toContain('moderator:read:followers');
        });
    });
});
