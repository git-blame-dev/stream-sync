const TwitchAuthFactory = require('../../../src/auth/TwitchAuthFactory');

describe('TwitchAuthFactory behavior', () => {
    const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    };

    it('allows OAuth flow when tokens are missing', () => {
        expect(() => new TwitchAuthFactory({
            clientId: 'client-id',
            clientSecret: 'client-secret',
            channel: 'channel-name',
            accessToken: null,
            refreshToken: null
        }, { logger })).not.toThrow();
    });

    it('rejects missing core OAuth configuration fields', () => {
        expect(() => new TwitchAuthFactory({
            clientSecret: 'client-secret',
            channel: 'channel-name'
        }, { logger })).toThrow(/clientId/);
    });
});
