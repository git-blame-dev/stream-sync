const { describe, expect, it, beforeEach, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../src/core/secrets');

const TwitchAuthFactory = require('../../../src/auth/TwitchAuthFactory');

describe('TwitchAuthFactory behavior', () => {
    beforeEach(() => {
        _resetForTesting();
        secrets.twitch.clientSecret = 'client-secret';
    });

    afterEach(() => {
        restoreAllMocks();
        _resetForTesting();
        initializeStaticSecrets();
    });

    it('allows OAuth flow when tokens are missing', () => {
        expect(() => new TwitchAuthFactory({
            clientId: 'client-id',
            channel: 'channel-name',
            accessToken: null,
            refreshToken: null
        }, { logger: noOpLogger })).not.toThrow();
    });

    it('rejects missing core OAuth configuration fields', () => {
        expect(() => new TwitchAuthFactory({
            channel: 'channel-name'
        }, { logger: noOpLogger })).toThrow(/clientId/);
    });
});
