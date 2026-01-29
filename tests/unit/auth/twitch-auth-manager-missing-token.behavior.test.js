const { describe, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const TwitchAuthManager = require('../../../src/auth/TwitchAuthManager');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../src/core/secrets');

describe('TwitchAuthManager OAuth handling', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        _resetForTesting();
        secrets.twitch.clientSecret = 'client-secret';
    });

    afterEach(() => {
        restoreAllMocks();
        process.env = { ...originalEnv };
        clearAllMocks();
        _resetForTesting();
        initializeStaticSecrets();
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
            channel: 'channel-name',
            accessToken: null,
            refreshToken: null
        }, { logger: noOpLogger, mockOAuthHandler });

        await manager.initialize();

        expect(manager.getState()).toBe('READY');
        expect(manager.getConfig().accessToken).toBe('oauth-access');
        expect(manager.getConfig().refreshToken).toBe('oauth-refresh');
    });
});
