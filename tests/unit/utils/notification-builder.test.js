const { describe, test, expect } = require('bun:test');
const NotificationBuilder = require('../../../src/utils/notification-builder');
const { getAnonymousUsername } = require('../../../src/utils/fallback-username');

describe('NotificationBuilder', () => {
    test('builds a basic notification object from minimal input', () => {
        const input = {
            platform: 'youtube',
            type: 'platform:gift',
            username: 'TestUser',
            userId: 'U123',
            message: 'Hello world!',
            giftType: 'Super Chat',
            giftCount: 1,
            amount: 5,
            currency: 'USD'
        };
        const notification = NotificationBuilder.build(input);
        expect(notification.platform).toBe('youtube');
        expect(notification.type).toBe('platform:gift');
        expect(notification.userId).toBe('U123');
        expect(notification.username).toBe('TestUser');
        expect(notification.message).toBe('Hello world!');
    });

    test('includes optional fields if provided', () => {
        const input = {
            platform: 'twitch',
            type: 'platform:gift',
            username: 'TwitchUser',
            userId: 'T456',
            message: 'Cheer!',
            giftType: 'bits',
            giftCount: 1,
            amount: 5,
            currency: 'bits',
            vfxConfig: { command: '!money' }
        };
        const notification = NotificationBuilder.build(input);
        expect(notification.amount).toBe(5);
        expect(notification.currency).toBe('bits');
        expect(notification.vfxConfig.command).toBe('!money');
    });

    test('handles missing/invalid input gracefully', () => {
        const result1 = NotificationBuilder.build(null);
        const result2 = NotificationBuilder.build({});

        expect(result1).toBeNull();
        expect(result2).toBeNull();
    });

    test('supports YouTube, Twitch, and TikTok platforms', () => {
        const platforms = ['youtube', 'twitch', 'tiktok'];
        for (const platform of platforms) {
            const input = {
                platform,
                type: 'test',
                username: 'name',
                userId: 'id',
                message: 'msg'
            };
            const notification = NotificationBuilder.build(input);
            expect(notification.platform).toBe(platform);
        }
    });

    test('allows custom notification templates', () => {
        const input = {
            platform: 'youtube',
            type: 'platform:gift',
            username: 'TestUser',
            userId: 'U123',
            message: 'Hello world!',
            giftType: 'Super Chat',
            giftCount: 1,
            amount: 5,
            currency: 'USD',
            template: (data) => `Custom: ${data.username} - ${data.message}`
        };
        const notification = NotificationBuilder.build(input);
        expect(notification.rendered).toBe('Custom: TestUser - Hello world!');
    });

    test('renders paypiggy with membership wording for YouTube', () => {
        const input = {
            platform: 'youtube',
            type: 'platform:paypiggy',
            username: 'MemberUser',
            userId: 'yt1',
            months: 3,
            membershipLevel: 'Test Member Plus'
        };

        const notification = NotificationBuilder.build(input);
        expect(notification.type).toBe('platform:paypiggy');
        expect(notification.displayMessage).toContain('membership');
        expect(notification.displayMessage).toContain('3');
        expect(notification.displayMessage).toContain('Test Member Plus');
        expect(notification.logMessage).toContain('Member');
        expect(notification.logMessage).toContain('Test Member Plus');
    });

    test('renders explicit error copy for monetization error payloads', () => {
        const errorInputs = [
            {
                platform: 'twitch',
                type: 'platform:gift',
                username: 'Unknown User',
                userId: 'unknown',
                giftType: 'Unknown gift',
                giftCount: 0,
                amount: 0,
                currency: 'unknown',
                isError: true
            },
            {
                platform: 'twitch',
                type: 'platform:giftpaypiggy',
                username: 'Unknown User',
                userId: 'unknown',
                giftCount: 0,
                tier: 'unknown',
                isError: true
            },
            {
                platform: 'twitch',
                type: 'platform:paypiggy',
                username: 'Unknown User',
                userId: 'unknown',
                months: 0,
                isError: true
            },
            {
                platform: 'tiktok',
                type: 'platform:envelope',
                username: 'Unknown User',
                userId: 'unknown',
                giftType: 'Treasure Chest',
                giftCount: 0,
                amount: 0,
                currency: 'unknown',
                isError: true
            }
        ];

        errorInputs.forEach((input) => {
            const notification = NotificationBuilder.build(input);
            expect(notification.displayMessage).toMatch(/error/i);
            expect(notification.ttsMessage).toMatch(/error/i);
            expect(notification.logMessage).toMatch(/error/i);
            expect(notification.isError).toBe(true);
        });
    });

    test('uses Anonymous User when isAnonymous is true and username is missing', () => {
        const notification = NotificationBuilder.build({
            platform: 'twitch',
            type: 'platform:gift',
            giftType: 'bits',
            giftCount: 1,
            amount: 25,
            currency: 'bits',
            isAnonymous: true
        });

        const anonymousUsername = getAnonymousUsername();
        expect(notification.displayMessage).toContain(anonymousUsername);
        expect(notification.ttsMessage).toContain(anonymousUsername);
        expect(notification.logMessage).toContain(anonymousUsername);
    });

    test('uses generic error copy when username is missing', () => {
        const notification = NotificationBuilder.build({
            platform: 'twitch',
            type: 'platform:gift',
            isError: true
        });

        expect(notification.displayMessage).toMatch(/error/i);
        expect(notification.displayMessage.toLowerCase()).not.toContain('from ');
        expect(notification.ttsMessage).toMatch(/error/i);
        expect(notification.ttsMessage.toLowerCase()).not.toContain('from ');
        expect(notification.logMessage).toMatch(/error/i);
        expect(notification.logMessage.toLowerCase()).not.toContain('from ');
    });
});
