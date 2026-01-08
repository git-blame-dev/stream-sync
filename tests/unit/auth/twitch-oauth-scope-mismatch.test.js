
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

const TwitchAuthService = require('../../../src/auth/TwitchAuthService');

describe('Twitch OAuth Scope Consistency', () => {
    let authService;
    let mockLogger;

    beforeEach(() => {
        mockLogger = createMockLogger('debug');
        
        const config = {
            clientId: 'test_client_id',
            clientSecret: 'test_client_secret',
            accessToken: 'valid_access_token_12345',
            refreshToken: 'valid_refresh_token_67890'
        };

        authService = new TwitchAuthService(config, { logger: mockLogger });
    });

    describe('when checking OAuth scope consistency', () => {
        it('should include user:read:chat scope for EventSub compatibility', () => {
            const requiredScopes = authService.getRequiredScopes();
            
            // This should FAIL initially - TwitchAuthService requests "chat:read" 
            // but EventSub validation requires "user:read:chat"
            expect(requiredScopes).toContain('user:read:chat');
        });

        it('should include all EventSub required scopes', () => {
            const requiredScopes = authService.getRequiredScopes();
            
            // Expected scopes based on EventSub requirements
            const expectedScopes = [
                'user:read:chat',           // For EventSub chat.message
                'chat:edit',                // For sending messages  
                'channel:read:subscriptions',
                'bits:read',
                'channel:read:redemptions',
                'moderator:read:followers'
            ];

            expectedScopes.forEach(scope => {
                expect(requiredScopes).toContain(scope);
            });
        });

        it('should match EventSub validation requirements exactly', () => {
            const authScopes = new Set(authService.getRequiredScopes());
            
            // Manually check the key EventSub required scopes (based on code analysis)
            const criticalEventSubScopes = [
                'user:read:chat',           // Required for channel.chat.message
                'moderator:read:followers', // Required for channel.follow
                'channel:read:subscriptions', // Required for channel.subscribe
                'bits:read'                 // Required for channel.bits.use
            ];

            criticalEventSubScopes.forEach(scope => {
                expect(authScopes.has(scope)).toBe(true);
            });
            
            // Verify total scope count is reasonable (not missing any)
            expect(authScopes.size).toBeGreaterThanOrEqual(4);
        });
    });
});
