const { describe, expect, it, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const TwitchAuthFactory = require('../../../src/auth/TwitchAuthFactory');

describe('TwitchAuthFactory behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('allows OAuth flow when tokens are missing', () => {
        expect(() => new TwitchAuthFactory({
            clientId: 'client-id',
            clientSecret: 'client-secret',
            channel: 'channel-name',
            accessToken: null,
            refreshToken: null
        }, { logger: noOpLogger })).not.toThrow();
    });

    it('rejects missing core OAuth configuration fields', () => {
        expect(() => new TwitchAuthFactory({
            clientSecret: 'client-secret',
            channel: 'channel-name'
        }, { logger: noOpLogger })).toThrow(/clientId/);
    });
});
