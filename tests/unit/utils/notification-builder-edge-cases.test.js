
const NotificationBuilder = require('../../../src/utils/notification-builder');

describe('Notification Builder Edge Cases', () => {
    describe('Input Validation Edge Cases', () => {
        test('returns null for null or undefined input', () => {
            expect(NotificationBuilder.build(null)).toBeNull();
            expect(NotificationBuilder.build(undefined)).toBeNull();
        });

        test('returns null for non-object input', () => {
            expect(NotificationBuilder.build('string')).toBeNull();
            expect(NotificationBuilder.build(123)).toBeNull();
        });

        test('returns null for array input', () => {
            expect(NotificationBuilder.build([])).toBeNull();
        });

        test('returns null for empty object input', () => {
            expect(NotificationBuilder.build({})).toBeNull();
        });
    });

    describe('Required Fields Edge Cases', () => {
        test('returns null when username is missing', () => {
            const data = {
                platform: 'youtube',
                type: 'chat',
                message: 'Hello'
            };

            expect(NotificationBuilder.build(data)).toBeNull();
        });

        test('throws when platform is missing', () => {
            const data = {
                type: 'chat',
                username: 'TestUser',
                message: 'Hello'
            };

            expect(() => NotificationBuilder.build(data)).toThrow('Notification requires platform');
        });

        test('throws when type is missing', () => {
            const data = {
                platform: 'youtube',
                username: 'TestUser',
                message: 'Hello'
            };

            expect(() => NotificationBuilder.build(data)).toThrow('Notification requires type');
        });
    });

    describe('Username Normalization Edge Cases', () => {
        test('trims surrounding whitespace in username', () => {
            const data = {
                platform: 'youtube',
                type: 'chat',
                username: '  TrimMe  ',
                message: 'Hello'
            };

            const notification = NotificationBuilder.build(data);
            expect(notification.username).toBe('TrimMe');
        });

        test('preserves special characters in username', () => {
            const data = {
                platform: 'youtube',
                type: 'chat',
                username: 'User_123',
                message: 'Hello'
            };

            const notification = NotificationBuilder.build(data);
            expect(notification.username).toBe('User_123');
        });
    });

    describe('Message and Amount Edge Cases', () => {
        test('throws when chat message is null', () => {
            const data = {
                platform: 'youtube',
                type: 'chat',
                username: 'TestUser',
                message: null
            };

            expect(() => NotificationBuilder.build(data)).toThrow('Notification of type "chat" requires message content');
        });

        test('preserves numeric amounts', () => {
            const data = {
                platform: 'youtube',
                type: 'gift',
                username: 'TestUser',
                giftType: 'Super Chat',
                giftCount: 1,
                amount: 5.5,
                currency: 'USD'
            };

            const notification = NotificationBuilder.build(data);
            expect(notification.amount).toBe(5.5);
        });
    });

    describe('UserId Normalization Edge Cases', () => {
        test('coerces userId to string when provided', () => {
            const data = {
                platform: 'twitch',
                type: 'chat',
                username: 'TestUser',
                userId: 12345,
                message: 'Hello'
            };

            const notification = NotificationBuilder.build(data);
            expect(notification.userId).toBe('12345');
        });
    });
});
