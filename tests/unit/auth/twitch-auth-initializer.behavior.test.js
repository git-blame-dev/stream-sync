const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const TwitchAuthInitializer = require('../../../src/auth/TwitchAuthInitializer');

describe('TwitchAuthInitializer behavior', () => {
    const buildAuthService = (overrides = {}) => ({
        isInitialized: false,
        config: {},
        validateCredentials: createMockFn().mockReturnValue({ hasToken: true, isExpired: false, isValid: true, issues: [] }),
        setAuthenticationState: createMockFn(),
        ...overrides
    });

    afterEach(() => {
        restoreAllMocks();
        clearAllMocks();
    });

    it('short-circuits initialization when already initialized', async () => {
        const authService = buildAuthService({ isInitialized: true });
        const initializer = new TwitchAuthInitializer({ logger: noOpLogger });

        const result = await initializer.initializeAuthentication(authService);
        expect(result).toBe(true);
        expect(authService.validateCredentials).not.toHaveBeenCalled();
    });

    it('triggers OAuth flow when token is missing', async () => {
        const authService = buildAuthService({
            validateCredentials: createMockFn().mockReturnValue({ hasToken: false })
        });
        const initializer = new TwitchAuthInitializer({ logger: noOpLogger });
        initializer.triggerOAuthFlow = createMockFn().mockResolvedValue({ accessToken: 'new', refreshToken: 'refresh' });

        const result = await initializer.initializeAuthentication(authService);
        expect(result).toBe(true);
    });

    it('returns false when credentials are invalid', async () => {
        const authService = buildAuthService({
            validateCredentials: createMockFn().mockReturnValue({ hasToken: true, isExpired: false, isValid: false, issues: ['bad'] })
        });
        const initializer = new TwitchAuthInitializer({ logger: noOpLogger });

        const result = await initializer.initializeAuthentication(authService);
        expect(result).toBe(false);
    });
});
