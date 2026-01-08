const NotificationBuilder = require('../src/utils/notification-builder');

describe('NotificationBuilder integration', () => {
    test('builds TikTok gift messages with coins', () => {
        const result = NotificationBuilder.build({
            type: 'gift',
            platform: 'tiktok',
            username: 'TestUser',
            userId: 'user-1',
            id: 'gift-evt-1',
            giftType: 'Rose',
            giftCount: 2,
            amount: 10,
            currency: 'coins',
            timestamp: '2024-01-01T00:00:00Z'
        });

        expect(result.displayMessage).toContain('TestUser');
        expect(result.displayMessage).toContain('Rose');
        expect(result.displayMessage).toContain('coin');
        expect(result.ttsMessage).toContain('TestUser');
        expect(result.ttsMessage).toContain('Rose');
        expect(result.logMessage).toContain('TestUser');
    });

    test('builds YouTube Super Chat messages with currency and message', () => {
        const result = NotificationBuilder.build({
            type: 'gift',
            platform: 'youtube',
            username: 'ChatSupporter',
            userId: 'user-2',
            id: 'gift-evt-2',
            giftType: 'Super Chat',
            giftCount: 1,
            amount: 5,
            currency: 'USD',
            message: 'Great stream!',
            timestamp: '2024-01-01T00:00:01Z'
        });

        expect(result.displayMessage).toContain('ChatSupporter');
        expect(result.displayMessage).toContain('Super Chat');
        expect(result.displayMessage).toContain('5');
        expect(result.ttsMessage).toContain('ChatSupporter');
        expect(result.ttsMessage).toContain('Super Chat');
        expect(result.ttsMessage).toContain('Great stream');
        expect(result.logMessage).toContain('ChatSupporter');
    });

    test('builds Twitch giftpaypiggy messages with tier', () => {
        const result = NotificationBuilder.build({
            type: 'giftpaypiggy',
            platform: 'twitch',
            username: 'GiftUser',
            userId: 'user-3',
            giftCount: 3,
            tier: '2000',
            timestamp: '2024-01-01T00:00:02Z'
        });

        expect(result.displayMessage).toContain('GiftUser');
        expect(result.displayMessage).toContain('gifted');
        expect(result.displayMessage).toContain('Tier 2');
        expect(result.ttsMessage).toContain('GiftUser');
        expect(result.ttsMessage).toContain('gifted');
        expect(result.logMessage).toContain('GiftUser');
    });
});
