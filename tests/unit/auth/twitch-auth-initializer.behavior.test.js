const TwitchAuthInitializer = require('../../../src/auth/TwitchAuthInitializer');

describe('TwitchAuthInitializer behavior', () => {
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const buildAuthService = (overrides = {}) => ({
        isInitialized: false,
        config: {},
        validateCredentials: jest.fn().mockReturnValue({ hasToken: true, isExpired: false, isValid: true, issues: [] }),
        setAuthenticationState: jest.fn(),
        ...overrides
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('short-circuits initialization when already initialized', async () => {
        const authService = buildAuthService({ isInitialized: true });
        const initializer = new TwitchAuthInitializer({ logger });

        const result = await initializer.initializeAuthentication(authService);
        expect(result).toBe(true);
        expect(authService.validateCredentials).not.toHaveBeenCalled();
    });

    it('triggers OAuth flow when token is missing', async () => {
        const authService = buildAuthService({
            validateCredentials: jest.fn().mockReturnValue({ hasToken: false })
        });
        const initializer = new TwitchAuthInitializer({ logger });
        initializer.triggerOAuthFlow = jest.fn().mockResolvedValue({ accessToken: 'new', refreshToken: 'refresh' });

        const result = await initializer.initializeAuthentication(authService);
        expect(initializer.triggerOAuthFlow).toHaveBeenCalledWith(authService);
        expect(result).toBe(true);
    });

    it('logs initializer error and returns false when credentials are invalid', async () => {
        const authService = buildAuthService({
            validateCredentials: jest.fn().mockReturnValue({ hasToken: true, isExpired: false, isValid: false, issues: ['bad'] })
        });
        const initializer = new TwitchAuthInitializer({ logger });
        initializer._logInitializerError = jest.fn();

        const result = await initializer.initializeAuthentication(authService);
        expect(initializer._logInitializerError).toHaveBeenCalledWith(
            expect.stringContaining('configuration invalid'),
            null,
            'oauth-config',
            expect.objectContaining({ issues: ['bad'] })
        );
        expect(result).toBe(false);
    });
});
