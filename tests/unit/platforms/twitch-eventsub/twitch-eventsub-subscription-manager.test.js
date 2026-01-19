const { describe, test, expect } = require('bun:test');
const { noOpLogger } = require('../../../helpers/mock-factories');
const { createTwitchEventSubSubscriptionManager } = require('../../../../src/platforms/twitch/eventsub/subscription-manager');

describe('Twitch EventSub subscription manager', () => {
    test('categorizes subscription errors as critical or retryable', () => {
        const manager = createTwitchEventSubSubscriptionManager({
            logger: noOpLogger,
            authManager: { authState: { executeWhenReady: async (fn) => fn() }, getAccessToken: async () => 'testToken' },
            config: { clientId: 'testClientId', accessToken: 'testAccessToken' },
            subscriptions: new Map(),
            getClientId: () => 'testClientId',
            validateConnectionForSubscriptions: () => true,
            logError: () => {}
        });

        const critical = manager.parseSubscriptionError(
            { response: { data: { error: 'Unauthorized', message: 'bad' }, status: 401 } },
            { type: 'channel.follow' }
        );
        const retryable = manager.parseSubscriptionError(
            { response: { data: { error: 'Too Many Requests', message: 'rate' }, status: 429 } },
            { type: 'channel.follow' }
        );

        expect(critical.isCritical).toBe(true);
        expect(retryable.isRetryable).toBe(true);
    });
});
