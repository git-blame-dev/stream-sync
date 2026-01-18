
const { describe, test, expect } = require('bun:test');

const { createNotificationData } = require('../helpers/notification-test-utils');
const MessageTTSHandler = require('../../src/utils/message-tts-handler');

describe('MessageTTS Integration', () => {
    describe('YouTube SuperChat Integration', () => {
        test('should create SuperChat notification with proper message content', () => {
            const notificationData = createNotificationData(
                'platform:gift',
                'youtube',
                { username: 'SuperChatUser' },
                {
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: 5.00,
                    currency: 'USD',
                    message: 'Thanks for the stream!'
                }
            );

            expect(notificationData.message).toBe('Thanks for the stream!');
            expect(notificationData.ttsMessage).toContain('SuperChatUser sent');
            expect(notificationData.ttsMessage).toContain('5 US dollars');
            expect(notificationData.type).toBe('platform:gift');
        });

        test('should generate TTS with message included for SuperChat', () => {
            const notificationData = createNotificationData(
                'platform:gift',
                'youtube',
                { username: 'SuperChatUser' },
                {
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: 5.00,
                    currency: 'USD',
                    message: 'Thanks for the stream!'
                }
            );

            const ttsStages = MessageTTSHandler.createTTSStages(notificationData);

            expect(ttsStages).toHaveLength(1);
            expect(ttsStages[0]).toEqual({
                text: expect.stringContaining('SuperChatUser sent'),
                delay: 0,
                type: 'primary'
            });
            expect(ttsStages[0].text).toContain('Thanks for the stream');
        });

        test('should generate single-stage TTS for SuperChat without message', () => {
            const notificationData = createNotificationData(
                'platform:gift',
                'youtube',
                { username: 'SuperChatUser' },
                {
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: 5.00,
                    currency: 'USD',
                    message: ''
                }
            );

            const ttsStages = MessageTTSHandler.createTTSStages(notificationData);

            expect(ttsStages).toHaveLength(1);
            expect(ttsStages[0].type).toBe('primary');
        });
    });

    describe('YouTube Membership Integration', () => {
        test('should create membership notification with message content', () => {
            const notificationData = createNotificationData(
                'platform:paypiggy',
                'youtube',
                { username: 'MemberUser' },
                {
                    message: 'Happy to support!'
                }
            );

            expect(notificationData.message).toBe('Happy to support!');
            expect(notificationData.type).toBe('platform:paypiggy');
        });

        test('should generate two-stage TTS for membership so user message is spoken', () => {
            const notificationData = createNotificationData(
                'platform:paypiggy',
                'youtube',
                { username: 'MemberUser' },
                {
                    message: 'Happy to support!'
                }
            );

            const ttsStages = MessageTTSHandler.createTTSStages(notificationData);

            expect(ttsStages).toHaveLength(2);
            expect(ttsStages[0]).toEqual({
                text: expect.stringContaining('MemberUser'),
                delay: 0,
                type: 'primary'
            });
            expect(ttsStages[1]).toEqual({
                text: 'MemberUser says Happy to support!',
                delay: 4000,
                type: 'message'
            });
        });
    });

    describe('Twitch Paypiggy Message Integration', () => {
        test('should create paypiggy notification with message content', () => {
            const notificationData = createNotificationData(
                'platform:paypiggy',
                'twitch',
                { username: 'TwitchSub' },
                {
                    message: 'Love this channel!',
                    months: 6
                }
            );

            expect(notificationData.message).toBe('Love this channel!');
            expect(notificationData.type).toBe('platform:paypiggy');
        });

        test('should generate two-stage TTS for paypiggy renewals so user message is spoken', () => {
            const notificationData = createNotificationData(
                'platform:paypiggy',
                'twitch',
                { username: 'TwitchSub' },
                {
                    message: 'Love this channel!',
                    months: 6
                }
            );

            const ttsStages = MessageTTSHandler.createTTSStages(notificationData);

            expect(ttsStages).toHaveLength(2);
            expect(ttsStages[0]).toEqual({
                text: expect.stringContaining('TwitchSub'),
                delay: 0,
                type: 'primary'
            });
            expect(ttsStages[1]).toEqual({
                text: 'TwitchSub says Love this channel!',
                delay: 4000,
                type: 'message'
            });
        });
    });

    describe('Twitch Bits Integration', () => {
        test('should create bits notification with message content', () => {
            const notificationData = createNotificationData(
                'platform:gift',
                'twitch',
                { username: 'BitUser' },
                {
                    message: 'Great stream!',
                    bits: 100,
                    giftType: 'bits',
                    giftCount: 1,
                    amount: 100,
                    currency: 'bits'
                }
            );

            expect(notificationData.message).toBe('Great stream!');
            expect(notificationData.type).toBe('platform:gift');
            expect(notificationData.currency).toBe('bits');
        });

        test('should generate single-stage TTS for bits with message included', () => {
            const notificationData = createNotificationData(
                'platform:gift',
                'twitch',
                { username: 'BitUser' },
                {
                    message: 'Great stream!',
                    bits: 100,
                    giftType: 'bits',
                    giftCount: 1,
                    amount: 100,
                    currency: 'bits'
                }
            );

            const ttsStages = MessageTTSHandler.createTTSStages(notificationData);

            expect(ttsStages).toHaveLength(1);
            expect(ttsStages[0].text).toContain('BitUser');
            expect(ttsStages[0].text).toContain('Great stream');
            expect(ttsStages[0].type).toBe('primary');
        });
    });

    describe('TikTok Comment Integration', () => {
        test('should create comment notification with message content', () => {
            const notificationData = createNotificationData(
                'chat',
                'tiktok',
                { username: 'TikTokUser' },
                {
                    message: 'Cool stream!'
                }
            );

            expect(notificationData.message).toBe('Cool stream!');
            expect(notificationData.type).toBe('chat');
        });

        test('should generate single-stage TTS for comments', () => {
            const notificationData = createNotificationData(
                'chat',
                'tiktok',
                { username: 'TikTokUser' },
                {
                    message: 'Cool stream!'
                }
            );

            const ttsStages = MessageTTSHandler.createTTSStages(notificationData);

            expect(ttsStages).toHaveLength(1);
            expect(ttsStages[0].text).toBe('Cool stream!');
            expect(ttsStages[0].type).toBe('primary');
        });
    });

    describe('Non-Message Supporting Notifications', () => {
        test('should have correct type for follow notifications', () => {
            const notificationData = createNotificationData(
                'platform:follow',
                'twitch',
                { username: 'Follower' },
                { message: 'This should be ignored' }
            );

            expect(notificationData.type).toBe('platform:follow');
        });

        test('should generate single-stage TTS for non-message notifications', () => {
            const notificationData = createNotificationData(
                'platform:follow',
                'twitch',
                { username: 'Follower' },
                { message: 'This should be ignored' }
            );

            const ttsStages = MessageTTSHandler.createTTSStages(notificationData);

            expect(ttsStages).toHaveLength(1);
            expect(ttsStages[0].type).toBe('primary');
        });

        test('should use gift type for TikTok gift notifications', () => {
            const notificationData = createNotificationData(
                'platform:gift',
                'tiktok',
                { username: 'GiftSender' },
                {
                    giftType: 'Rose',
                    giftCount: 5,
                    amount: 5,
                    currency: 'coins',
                    message: 'This should be ignored for TikTok gifts'
                }
            );

            expect(notificationData.type).toBe('platform:gift');
        });
    });

    describe('Message Validation Integration', () => {
        test('should ignore empty messages in SuperChat', () => {
            const notificationData = createNotificationData(
                'platform:gift',
                'youtube',
                { username: 'SuperChatUser' },
                {
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: 5.00,
                    currency: 'USD',
                    message: ''
                }
            );

            const ttsStages = MessageTTSHandler.createTTSStages(notificationData);

            expect(ttsStages).toHaveLength(1);
            expect(ttsStages[0].type).toBe('primary');
        });

        test('should ignore whitespace-only messages', () => {
            const notificationData = createNotificationData(
                'platform:gift',
                'youtube',
                { username: 'SuperChatUser' },
                {
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: 5.00,
                    currency: 'USD',
                    message: '   \n\t   '
                }
            );

            const ttsStages = MessageTTSHandler.createTTSStages(notificationData);

            expect(ttsStages).toHaveLength(1);
            expect(ttsStages[0].type).toBe('primary');
        });

        test('should trim message content for TTS', () => {
            const notificationData = createNotificationData(
                'platform:gift',
                'youtube',
                { username: 'SuperChatUser' },
                {
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: 5.00,
                    currency: 'USD',
                    message: '   Thanks for the stream!   '
                }
            );

            const ttsStages = MessageTTSHandler.createTTSStages(notificationData);

            expect(ttsStages).toHaveLength(1);
            expect(ttsStages[0].text).toContain('Thanks for the stream');
        });
    });

    describe('Cross-Platform Currency Support', () => {
        test('should handle EUR SuperChat with message', () => {
            const notificationData = createNotificationData(
                'platform:gift',
                'youtube',
                { username: 'EuroUser' },
                {
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: 10.50,
                    currency: 'EUR',
                    message: 'Greetings from Europe!'
                }
            );

            const ttsStages = MessageTTSHandler.createTTSStages(notificationData);

            expect(ttsStages).toHaveLength(1);
            expect(ttsStages[0].text).toContain('10 euros');
            expect(ttsStages[0].text).toContain('Greetings from Europe');
        });

        test('should handle GBP SuperChat with message', () => {
            const notificationData = createNotificationData(
                'platform:gift',
                'youtube',
                { username: 'BritUser' },
                {
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: 7.99,
                    currency: 'GBP',
                    message: 'Cheers from the UK!'
                }
            );

            const ttsStages = MessageTTSHandler.createTTSStages(notificationData);

            expect(ttsStages).toHaveLength(1);
            expect(ttsStages[0].text).toContain('7 British pounds');
            expect(ttsStages[0].text).toContain('Cheers from the UK');
        });
    });

    describe('Username Sanitization Integration', () => {
        test('should sanitize usernames with emojis for TTS messages', () => {
            const notificationData = createNotificationData(
                'platform:gift',
                'youtube',
                { username: '🎮SuperLongUsernameWithEmojis🎮' },
                {
                    giftType: 'Super Chat',
                    giftCount: 1,
                    amount: 5.00,
                    currency: 'USD',
                    message: 'Hello world!'
                }
            );

            const ttsStages = MessageTTSHandler.createTTSStages(notificationData);

            expect(ttsStages).toHaveLength(1);
            expect(ttsStages[0].text).toContain('SuperLongUsernameWithEmojis');
            expect(ttsStages[0].text).toContain('Hello world');
        });
    });
});
