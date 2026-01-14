
const { describe, it, expect } = require('bun:test');
const { unmockModule, resetModules, requireActual } = require('../../helpers/bun-module-mocks');

unmockModule('../../../src/platforms/twitch-eventsub');
resetModules();
const TwitchEventSub = requireActual('../../../src/platforms/twitch-eventsub');

const createAuthManager = () => ({
    getState: () => 'READY',
    getUserId: () => '123456',
    authState: {
        executeWhenReady: async (fn) => fn()
    },
    getAccessToken: async () => 'test-access-token'
});

describe('TwitchEventSub chat sending', () => {
    it('sends chat messages through the EventSub transport', async () => {
        const eventSub = new TwitchEventSub(
            {
                clientId: 'client-id',
                accessToken: 'access-token',
                channel: 'streamer',
                username: 'streamer',
                dataLoggingEnabled: false
            },
            {
                authManager: createAuthManager(),
                logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
            }
        );

        await expect(eventSub.sendMessage('hello world')).resolves.toMatchObject({
            success: true
        });
    });
});
