const { describe, test, expect, afterEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const TwitchAuthManager = require('../../../src/auth/TwitchAuthManager');

describe('TwitchAuthManager OAuth handling', () => {
    const logger = {
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn()
    };
    const originalEnv = { ...process.env };

    afterEach(() => {
        restoreAllMocks();
        process.env = { ...originalEnv };
        clearAllMocks();
    });

    it('auto-triggers OAuth flow when access token is missing', async () => {
        process.env.NODE_ENV = 'test';
        delete process.env.TWITCH_DISABLE_AUTH;

        const mockOAuthHandler = {
            runOAuthFlow: createMockFn().mockResolvedValue({
                access_token: 'oauth-access',
                refresh_token: 'oauth-refresh'
            })
        };

        const manager = TwitchAuthManager.getInstance({
            clientId: 'client-id',
            clientSecret: 'client-secret',
            channel: 'channel-name',
            accessToken: null,
            refreshToken: null
        }, { logger, mockOAuthHandler });

        await manager.initialize();

        expect(mockOAuthHandler.runOAuthFlow).toHaveBeenCalled();
        expect(manager.getState()).toBe('READY');
        expect(manager.getConfig().accessToken).toBe('oauth-access');
        expect(manager.getConfig().refreshToken).toBe('oauth-refresh');
    });
});
