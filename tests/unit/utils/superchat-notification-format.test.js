const NotificationBuilder = require('../../../src/utils/notification-builder');

describe('SuperChat Notification Format', () => {
    test('formats Super Chat display and TTS output', () => {
        const result = NotificationBuilder.build({
            platform: 'youtube',
            type: 'platform:gift',
            username: 'SuperChatUser',
            giftType: 'Super Chat',
            giftCount: 1,
            amount: 5.00,
            currency: 'USD',
            message: 'Thanks for the stream!'
        });

        expect(result.displayMessage).toBe('SuperChatUser sent a $5.00 Super Chat: Thanks for the stream!');
        expect(result.ttsMessage).toContain('SuperChatUser sent');
        expect(result.ttsMessage).toContain('5 US dollars');
        expect(result.ttsMessage).toContain('Super Chat');
        expect(result.ttsMessage).toContain('Thanks for the stream');
    });

    test('formats Super Sticker display and TTS output', () => {
        const result = NotificationBuilder.build({
            platform: 'youtube',
            type: 'platform:gift',
            username: 'StickerUser',
            giftType: 'Super Sticker',
            giftCount: 1,
            amount: 10.50,
            currency: 'USD'
        });

        expect(result.displayMessage).toBe('StickerUser sent a $10.50 Super Sticker');
        expect(result.ttsMessage).toContain('StickerUser sent');
        expect(result.ttsMessage).toContain('10 US dollars 50');
        expect(result.ttsMessage).toContain('Super Sticker');
    });
});
