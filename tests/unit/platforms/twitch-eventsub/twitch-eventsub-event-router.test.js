const { createTwitchEventSubEventRouter } = require('../../../../src/platforms/twitch-eventsub/events/twitch-eventsub-event-router');

describe('Twitch EventSub event router', () => {
    const createLogger = () => ({
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
    });

    test('emits chat message payloads with preserved timestamps for old-message filtering', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { channel: 'streamer', dataLoggingEnabled: false },
            logger: createLogger(),
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleNotificationEvent('channel.chat.message', {
            chatter_user_id: '1',
            chatter_user_name: 'viewer',
            broadcaster_user_id: '2',
            message: { text: 'hi', timestamp: '2024-01-01T00:00:00Z' },
            message_timestamp: '2024-01-01T00:00:00Z'
        });

        const messageEvent = emitted.find((evt) => evt.type === 'message');
        expect(messageEvent).toBeDefined();
        expect(messageEvent.payload.message).toBe('hi');
        expect(messageEvent.payload.channel).toBe('#streamer');
        expect(messageEvent.payload.context['tmi-sent-ts']).toBe(String(Date.parse('2024-01-01T00:00:00Z')));
    });

    test('suppresses gift subscription notifications for gift events', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: createLogger(),
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handlePaypiggyEvent({
            user_name: 'GiftedUser',
            user_id: '123',
            is_gift: true
        });

        expect(emitted).toEqual([]);
    });

    test('extracts text content from bits.use fragments and emits a cheer payload', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: createLogger(),
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleBitsUseEvent({
            user_name: 'Cheerer',
            user_id: '777',
            bits: 50,
            id: 'bits-evt-1',
            message: {
                fragments: [
                    { type: 'cheermote', text: 'Cheer50', cheermote: { prefix: 'Cheer', bits: 50 } },
                    { type: 'text', text: 'hello ' },
                    { type: 'text', text: 'world' }
                ]
            },
            timestamp: '2024-01-01T00:00:00Z'
        });

        const cheerEvent = emitted.find((evt) => evt.type === 'cheer');
        expect(cheerEvent).toBeDefined();
        expect(cheerEvent.payload.username).toBe('Cheerer');
        expect(cheerEvent.payload.bits).toBe(50);
        expect(cheerEvent.payload.message).toBe('hello world');
        expect(cheerEvent.payload.repeatCount).toBe(1);
        expect(cheerEvent.payload.id).toEqual(expect.any(String));
    });

    test('emits paypiggyGift payloads with gift count and cumulative total', () => {
        const emitted = [];
        const router = createTwitchEventSubEventRouter({
            config: { dataLoggingEnabled: false },
            logger: createLogger(),
            emit: (type, payload) => emitted.push({ type, payload }),
            logRawPlatformData: async () => {},
            logError: () => {}
        });

        router.handleNotificationEvent('channel.subscription.gift', {
            user_name: 'GiftPilot',
            user_id: 'tw-gift-1',
            tier: '1000',
            total: 3,
            cumulative_total: 12,
            is_anonymous: true,
            timestamp: '2024-01-01T00:00:00Z'
        });

        const giftEvent = emitted.find((evt) => evt.type === 'paypiggyGift');
        expect(giftEvent).toBeDefined();
        expect(giftEvent.payload).toMatchObject({
            username: 'GiftPilot',
            userId: 'tw-gift-1',
            tier: '1000',
            giftCount: 3,
            cumulativeTotal: 12,
            isAnonymous: true,
            timestamp: '2024-01-01T00:00:00Z'
        });
    });
});
