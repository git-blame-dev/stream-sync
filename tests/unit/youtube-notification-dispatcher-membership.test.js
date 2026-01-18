const { describe, test, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');

const logging = require('../../src/core/logging');
logging.setConfigValidator(() => ({ logging: {} }));

const { YouTubeNotificationDispatcher } = require('../../src/utils/youtube-notification-dispatcher');

describe('YouTubeNotificationDispatcher membership routing', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('dispatches membership notifications to onMembership with months/level preserved', async () => {
        const dispatcher = new YouTubeNotificationDispatcher({
            logger: noOpLogger
        });
        const onMembership = createMockFn();
        const chatItem = {
            item: {
                id: 'LCC.test-membership-001',
                timestampUsec: '1700000000000000',
                author: { id: 'chan123', name: 'MemberUser' },
                headerPrimaryText: { runs: [{ text: 'Member' }] },
                headerSubtext: { runs: [{ text: 'Welcome back!' }] },
                memberMilestoneDurationInMonths: 3
            },
            author: { name: 'MemberUser', channelId: 'chan123' }
        };

        await dispatcher.dispatchMembership(chatItem, { onMembership });

        expect(onMembership).toHaveBeenCalledTimes(1);
        const payload = onMembership.mock.calls[0][0];
        expect(payload.type).toBe('platform:paypiggy');
        expect(payload.membershipLevel).toBe('Member');
        expect(payload.months).toBe(3);
        expect(payload.membershipMonths).toBeUndefined();
        expect(payload.id).toBe('LCC.test-membership-001');
        expect(payload.timestamp).toBe(new Date(1700000000000).toISOString());
    });
});
