describe('notification builder error message behavior', () => {
    it('generates generic error message when sanitized username is empty', () => {
        const NotificationBuilder = require('../../../src/utils/notification-builder');

        const ttsMessage = NotificationBuilder.generateTtsMessage({
            type: 'gift',
            username: '   ',
            isError: true
        });

        expect(ttsMessage).toBe('Error processing gift');
    });

    it('includes username in error message when username is valid', () => {
        const NotificationBuilder = require('../../../src/utils/notification-builder');

        const ttsMessage = NotificationBuilder.generateTtsMessage({
            type: 'gift',
            username: 'TestUser',
            isError: true
        });

        expect(ttsMessage).toBe('Error processing gift from TestUser');
    });
});
