
jest.mock('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: jest.fn(() => ({
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    }))
}));

const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const TokenRefreshUtility = require('../../../src/utils/token-refresh-utility');

describe('TokenRefreshUtility', () => {
    const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('executeTokenRefresh', () => {
        it('returns success with tokens using enhanced client', async () => {
            const enhancedHttpClient = {
                post: jest.fn().mockResolvedValue({
                    data: { access_token: 'new', refresh_token: 'new-refresh', expires_in: 3600 }
                })
            };
            const util = new TokenRefreshUtility({ enhancedHttpClient, logger });

            const result = await util.executeTokenRefresh({
                refreshToken: 'r',
                clientId: 'id',
                clientSecret: 'secret'
            });

            expect(result.success).toBe(true);
            expect(result.tokens.access_token).toBe('new');
            expect(util.performanceMetrics.refreshCalls).toBe(1);
        });

        it('logs and returns failure when token response missing fields', async () => {
        const enhancedHttpClient = {
            post: jest.fn().mockResolvedValue({
                data: { access_token: 'only-access' }
            })
        };
        const util = new TokenRefreshUtility({ enhancedHttpClient, logger });
        util.platformErrorHandler = {
            handleEventProcessingError: jest.fn(),
            logOperationalError: jest.fn()
        };

        const result = await util.executeTokenRefresh({
            refreshToken: 'r',
            clientId: 'id',
            clientSecret: 'secret'
        });

        expect(result.success).toBe(false);
        expect(util.platformErrorHandler.logOperationalError).toHaveBeenCalled();
    });
});

    describe('calculateRefreshScheduling', () => {
        it('returns cannot schedule when expiresAt missing', () => {
            const util = new TokenRefreshUtility({ logger });

            const result = util.calculateRefreshScheduling(null);

            expect(result.canSchedule).toBe(false);
            expect(result.reason).toMatch(/No expiration time/);
        });
    });
});
