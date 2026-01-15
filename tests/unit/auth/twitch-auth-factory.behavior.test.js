const { describe, test, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const TwitchAuthFactory = require('../../../src/auth/TwitchAuthFactory');

describe('TwitchAuthFactory behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const logger = {
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn()
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
