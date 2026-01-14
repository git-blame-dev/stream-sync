const { describe, test, expect } = require('bun:test');
const { createTwitchEventSubSubscriptionManager } = require('../../../../src/platforms/twitch-eventsub/subscriptions/twitch-eventsub-subscription-manager');

describe('Twitch EventSub subscription manager', () => {
    const createLogger = () => ({
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
    });

    test('categorizes subscription errors as critical or retryable', () => {
        const manager = createTwitchEventSubSubscriptionManager({
            logger: createLogger(),
            authManager: { authState: { executeWhenReady: async (fn) => fn() }, getAccessToken: async () => 'token' },
            config: { clientId: 'cid', accessToken: 'tok' },
            subscriptions: new Map(),
            getClientId: () => 'cid',
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

