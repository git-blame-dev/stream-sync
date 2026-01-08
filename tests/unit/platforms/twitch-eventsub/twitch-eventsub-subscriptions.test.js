const { createTwitchEventSubSubscriptions } = require('../../../../src/platforms/twitch-eventsub/subscriptions/twitch-eventsub-subscriptions');

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

        expect(byType('channel.chat.message').getCondition('123')).toEqual({
            broadcaster_user_id: '123',
            user_id: '123'
        });
        expect(byType('channel.follow').getCondition('123')).toEqual({
            broadcaster_user_id: '123',
            moderator_user_id: '123'
        });
        expect(byType('channel.raid').getCondition('123')).toEqual({
            to_broadcaster_user_id: '123'
        });
        expect(byType('stream.online').getCondition('123')).toEqual({
            broadcaster_user_id: '123'
        });
    });
});

