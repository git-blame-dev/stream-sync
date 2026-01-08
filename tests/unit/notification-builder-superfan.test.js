const NotificationBuilder = require('../../src/utils/notification-builder');

describe('NotificationBuilder SuperFan notifications', () => {
    it('formats SuperFan display and TTS strings with SuperFan wording', () => {
        const notification = NotificationBuilder.build({
            type: 'paypiggy',
            platform: 'tiktok',
            username: 'SuperFanUser',
            userId: 'superfan_1',
            tier: 'superfan'
        });

        expect(notification.displayMessage).toMatch(/SuperFan/);
        expect(notification.ttsMessage).toMatch(/SuperFan/);
        expect(notification.type).toBe('paypiggy');
    });
});
