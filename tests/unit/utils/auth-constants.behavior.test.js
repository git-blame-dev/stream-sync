const {
    AUTH_STATES,
    TWITCH_OAUTH_SCOPES,
    PLACEHOLDER_TOKEN_PATTERNS,
    REQUIRED_CONFIG_FIELDS,
    RETRY_CONFIG,
    PERFORMANCE_THRESHOLDS
} = require('../../../src/utils/auth-constants');

describe('auth-constants behavior', () => {
    it('exposes required auth scopes and states', () => {
        expect(AUTH_STATES.READY).toBe('READY');
        expect(TWITCH_OAUTH_SCOPES).toEqual(
            expect.arrayContaining(['chat:edit', 'user:read:chat'])
        );
    });

    it('defines placeholder patterns and required config fields', () => {
        expect(PLACEHOLDER_TOKEN_PATTERNS.some((re) => re.test('test_token_123'))).toBe(true);
        expect(REQUIRED_CONFIG_FIELDS.BASIC).toEqual(
            expect.arrayContaining(['clientId', 'accessToken', 'channel'])
        );
    });

    it('includes retry and performance thresholds', () => {
        expect(RETRY_CONFIG.INITIAL_DELAY_MS).toBeGreaterThan(0);
        expect(PERFORMANCE_THRESHOLDS.TOKEN_REFRESH_MS).toBeGreaterThan(0);
    });
});
