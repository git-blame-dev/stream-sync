describe('notification builder fallback username behavior', () => {
    it('uses placeholder username for error TTS when sanitized username is empty', () => {
        const NotificationBuilder = require('../../../src/utils/notification-builder');

        const ttsMessage = NotificationBuilder.generateTtsMessage({
            type: 'gift',
            username: '   ',
            isError: true
        });

        expect(ttsMessage).toContain('Unknown');
    });
});
