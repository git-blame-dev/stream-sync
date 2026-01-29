
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

describe('Twitch OAuth Scope Consistency', () => {
    let authService;
    let mockLogger;

    beforeEach(() => {
        mockLogger = noOpLogger;
        
        const config = {
            clientId: 'test_client_id',
            accessToken: 'valid_access_token_12345',
            refreshToken: 'valid_refresh_token_67890'
        };

        authService = new TwitchAuthService(config, { logger: mockLogger });

        _resetForTesting();
        secrets.twitch.clientSecret = 'test_client_secret';
    });

    afterEach(() => {
        _resetForTesting();
        initializeStaticSecrets();
    });

    describe('when checking OAuth scope consistency', () => {
        it('should include user:read:chat scope for EventSub compatibility', () => {
            const requiredScopes = authService.getRequiredScopes();

            expect(requiredScopes).toContain('user:read:chat');
        });

        it('should include all EventSub required scopes', () => {
            const requiredScopes = authService.getRequiredScopes();

            const expectedScopes = [
                'user:read:chat',
                'chat:edit',
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

            const criticalEventSubScopes = [
                'user:read:chat',
                'moderator:read:followers',
                'channel:read:subscriptions',
                'bits:read'
            ];

            criticalEventSubScopes.forEach(scope => {
                expect(authScopes.has(scope)).toBe(true);
            });

            expect(authScopes.size).toBeGreaterThanOrEqual(4);
        });
    });
});
