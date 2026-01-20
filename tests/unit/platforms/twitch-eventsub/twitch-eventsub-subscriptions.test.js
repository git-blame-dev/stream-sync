const { describe, test, expect } = require('bun:test');
const { createTwitchEventSubSubscriptions } = require('../../../../src/platforms/twitch/eventsub/subscriptions');

describe('Twitch EventSub subscriptions', () => {
    test('builds subscription definitions with correct conditions and handlers', () => {
        const subscriptions = createTwitchEventSubSubscriptions();
        const byType = (type) => subscriptions.find((sub) => sub.type === type);

        expect(byType('channel.chat.message').handler).toBe('handleChatMessage');
        expect(byType('channel.follow').handler).toBe('handleFollow');
        expect(byType('channel.subscribe').handler).toBe('handlePaypiggy');
        expect(byType('channel.raid').handler).toBe('handleRaid');
        expect(byType('channel.bits.use').handler).toBe('handleBitsUse');
        expect(byType('channel.subscription.gift').handler).toBe('handlePaypiggyGift');
        expect(byType('channel.subscription.message').handler).toBe('handlePaypiggyMessage');
        expect(byType('stream.online').handler).toBe('handleStreamOnline');
        expect(byType('stream.offline').handler).toBe('handleStreamOffline');

        const testUserId = 'test-user-123';
        const testBroadcasterId = 'test-broadcaster-999';
        expect(byType('channel.chat.message').getCondition({ userId: testUserId, broadcasterId: testBroadcasterId })).toEqual({
            broadcaster_user_id: testBroadcasterId,
            user_id: testUserId
        });
        expect(byType('channel.follow').getCondition({ userId: testUserId, broadcasterId: testBroadcasterId })).toEqual({
            broadcaster_user_id: testBroadcasterId,
            moderator_user_id: testUserId
        });
        expect(byType('channel.raid').getCondition({ broadcasterId: testBroadcasterId })).toEqual({
            to_broadcaster_user_id: testBroadcasterId
        });
        expect(byType('stream.online').getCondition({ broadcasterId: testBroadcasterId })).toEqual({
            broadcaster_user_id: testBroadcasterId
        });
    });
});
