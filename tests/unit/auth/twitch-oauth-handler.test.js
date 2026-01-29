const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../src/core/secrets');

describe('TwitchOAuthHandler', () => {
    let TwitchOAuthHandler;

    afterEach(() => {
        restoreAllMocks();
        _resetForTesting();
        initializeStaticSecrets();
    });

    beforeEach(() => {
        _resetForTesting();
        secrets.twitch.clientSecret = 'testClientSecret';
    });

    test('generates auth URL with required OAuth parameters', () => {
        ({ TwitchOAuthHandler } = require('../../../src/auth/oauth-handler'));

        const handler = new TwitchOAuthHandler({
            clientId: 'testClientId',
            channel: 'testChannel'
        }, {
            logger: noOpLogger,
            port: 8080
        });

        const authUrl = handler.generateAuthUrl();

        expect(authUrl).toContain('https://id.twitch.tv/oauth2/authorize');
        expect(authUrl).toContain('client_id=testClientId');
        expect(authUrl).toContain('redirect_uri=');
        expect(authUrl).toContain('response_type=code');
        expect(authUrl).toContain('scope=');
        expect(authUrl).toContain('state=');
    });

    test('constructs handler with provided configuration', () => {
        ({ TwitchOAuthHandler } = require('../../../src/auth/oauth-handler'));

        const handler = new TwitchOAuthHandler({
            clientId: 'testClientId',
            channel: 'testChannel'
        }, {
            logger: noOpLogger,
            port: 9000
        });

        expect(handler.config.clientId).toBe('testClientId');
        expect(handler.port).toBe(9000);
        expect(handler.redirectUri).toBe('https://localhost:9000');
    });

    test('uses default port when not specified', () => {
        ({ TwitchOAuthHandler } = require('../../../src/auth/oauth-handler'));

        const handler = new TwitchOAuthHandler({
            clientId: 'testClientId',
            channel: 'testChannel'
        }, {
            logger: noOpLogger
        });

        expect(handler.port).toBe(3000);
    });
});
