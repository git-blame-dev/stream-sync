
const MessageTTSHandler = require('../../src/utils/message-tts-handler');

describe('MessageTTSHandler', () => {
    describe('createTTSStages', () => {
        test('should create two-stage TTS for SuperChat with message', () => {
            const notification = {
                type: 'gift',
                isSuperChat: true,
                username: 'TestUser',
                ttsMessage: 'TestUser sent 5 dollars',
                message: 'Thanks for the stream!'
            };
            
            const stages = MessageTTSHandler.createTTSStages(notification);
            
            expect(stages).toHaveLength(2);
            expect(stages[0]).toEqual({
                text: 'TestUser sent 5 dollars',
                delay: 0,
                type: 'primary'
            });
            expect(stages[1]).toEqual({
                text: 'TestUser says Thanks for the stream!',
                delay: 4000,
                type: 'message'
            });
        });

        test('should not suppress profane messages when generating TTS stages', () => {
            const notification = {
                type: 'gift',
                isSuperChat: true,
                username: 'TestUser',
                ttsMessage: 'TestUser sent 5 dollars',
                message: 'fuck this'
            };
            const config = {
                contentFilter: {
                    enabled: true,
                    strictness: 'high'
                }
            };

            const stages = MessageTTSHandler.createTTSStages(notification, config);

            expect(stages).toHaveLength(2);
            expect(stages[1]).toEqual({
                text: 'TestUser says fuck this',
                delay: 4000,
                type: 'message'
            });
        });

        test('should create single-stage TTS for SuperChat without message', () => {
            const notification = {
                type: 'gift',
                isSuperChat: true,
                username: 'TestUser',
                ttsMessage: 'TestUser sent 5 dollars',
                message: ''
            };
            
            const stages = MessageTTSHandler.createTTSStages(notification);
            
            expect(stages).toHaveLength(1);
            expect(stages[0]).toEqual({
                text: 'TestUser sent 5 dollars',
                delay: 0,
                type: 'primary'
            });
        });

        test('should create two-stage TTS for canonical paypiggy supporter messages', () => {
            const notification = {
                type: 'paypiggy',
                username: 'TwitchUser',
                ttsMessage: 'TwitchUser subscribed for 6 months',
                message: 'Love this channel!'
            };

            const stages = MessageTTSHandler.createTTSStages(notification);

            expect(stages).toHaveLength(2);
            expect(stages[0]).toEqual({
                text: 'TwitchUser subscribed for 6 months',
                delay: 0,
                type: 'primary'
            });
            expect(stages[1]).toEqual({
                text: 'TwitchUser says Love this channel!',
                delay: 4000,
                type: 'message'
            });
        });

        test('should create two-stage TTS for paypiggy renewal messages without alias flags', () => {
            const notification = {
                type: 'paypiggy',
                username: 'RenewalUser',
                ttsMessage: 'RenewalUser renewed subscription for 3 months',
                message: 'Still here after three months!'
            };

            const stages = MessageTTSHandler.createTTSStages(notification);

            expect(stages).toHaveLength(2);
            expect(stages[1]).toEqual({
                text: 'RenewalUser says Still here after three months!',
                delay: 4000,
                type: 'message'
            });
        });

        test('should create single-stage TTS for Twitch bits with message', () => {
            const notification = {
                type: 'gift',
                isBits: true,
                username: 'BitUser',
                ttsMessage: 'BitUser sent 100 bits. Keep up the great work!',
                message: 'Keep up the great work!'
            };
            
            const stages = MessageTTSHandler.createTTSStages(notification);
            
            expect(stages).toHaveLength(1);
            expect(stages[0]).toEqual({
                text: 'BitUser sent 100 bits. Keep up the great work!',
                delay: 0,
                type: 'primary'
            });
        });

        test('treats canonical paypiggy membership copy as message-supporting only when message exists', () => {
            const notification = {
                type: 'paypiggy',
                platform: 'youtube',
                isMembership: true,
                username: 'MemberUser',
                ttsMessage: 'MemberUser just became a member',
                message: ''
            };

            const stages = MessageTTSHandler.createTTSStages(notification);

            expect(stages).toHaveLength(1);
            expect(stages[0]).toEqual({
                text: 'MemberUser just became a member',
                delay: 0,
                type: 'primary'
            });
        });

        test('should create immediate TTS for TikTok comment', () => {
            const notification = {
                type: 'chat',
                isComment: true,
                username: 'TikTokUser',
                ttsMessage: 'TikTokUser commented',
                message: 'Cool stream!'
            };
            
            const stages = MessageTTSHandler.createTTSStages(notification);
            
            expect(stages).toHaveLength(2);
            expect(stages[1]).toEqual({
                text: 'TikTokUser says Cool stream!',
                delay: 0, // Immediate for chat comments
                type: 'message'
            });
        });

        test('should handle notification without primary TTS message', () => {
            const notification = {
                type: 'gift',
                isSuperChat: true,
                username: 'TestUser',
                message: 'Thanks!'
            };
            
            const stages = MessageTTSHandler.createTTSStages(notification);
            
            expect(stages).toHaveLength(1);
            expect(stages[0]).toEqual({
                text: 'TestUser says Thanks!',
                delay: 4000,
                type: 'message'
            });
        });

        test('should handle notification without any message support', () => {
            const notification = {
                type: 'follow',
                username: 'Follower',
                ttsMessage: 'Follower just followed'
            };
            
            const stages = MessageTTSHandler.createTTSStages(notification);
            
            expect(stages).toHaveLength(1);
            expect(stages[0]).toEqual({
                text: 'Follower just followed',
                delay: 0,
                type: 'primary'
            });
        });

        test('should ignore whitespace-only messages', () => {
            const notification = {
                type: 'gift',
                isSuperChat: true,
                username: 'TestUser',
                ttsMessage: 'TestUser sent 5 dollars',
                message: '   \n\t   '
            };
            
            const stages = MessageTTSHandler.createTTSStages(notification);
            
            expect(stages).toHaveLength(1);
            expect(stages[0].type).toBe('primary');
        });

        test('should handle very long messages with proper sanitization', () => {
            const longMessage = 'A'.repeat(500);
            const notification = {
                type: 'gift',
                isSuperChat: true,
                username: 'VeryLongUsernameForTesting',
                ttsMessage: 'User sent 10 dollars',
                message: longMessage
            };
            
            const stages = MessageTTSHandler.createTTSStages(notification);
            
            expect(stages).toHaveLength(2);
            expect(stages[1].text).toContain('VeryLongUser says'); // Username should be truncated
            expect(stages[1].text.length).toBeLessThan(600); // Should be reasonable length
        });
    });

    describe('supportsMessages', () => {
        test('should return true for SuperChat notifications', () => {
            const notification = { type: 'gift', isSuperChat: true };
            expect(MessageTTSHandler.supportsMessages(notification)).toBe(true);
        });

        test('should return true for paypiggy messages without alias flags', () => {
            const notification = {
                type: 'paypiggy',
                message: 'Membership message body',
                ttsMessage: 'MemberUser renewed subscription'
            };

            expect(MessageTTSHandler.supportsMessages(notification)).toBe(true);
        });

        test('should return false for Twitch bits notifications', () => {
            const notification = { type: 'gift', isBits: true };
            expect(MessageTTSHandler.supportsMessages(notification)).toBe(false);
        });

        test('should return true for TikTok comment notifications', () => {
            const notification = { type: 'chat', isComment: true };
            expect(MessageTTSHandler.supportsMessages(notification)).toBe(true);
        });

        test('should return false for follow notifications', () => {
            const notification = { type: 'follow' };
            expect(MessageTTSHandler.supportsMessages(notification)).toBe(false);
        });

        test('should return false for raid notifications', () => {
            const notification = { type: 'raid' };
            expect(MessageTTSHandler.supportsMessages(notification)).toBe(false);
        });

        test('should return false for TikTok gift notifications', () => {
            const notification = { type: 'gift', platform: 'tiktok' };
            expect(MessageTTSHandler.supportsMessages(notification)).toBe(false);
        });
    });

    describe('hasValidMessage', () => {
        test('should return true for non-empty string', () => {
            expect(MessageTTSHandler.hasValidMessage('Hello world')).toBe(true);
        });

        test('should return true for string with leading/trailing whitespace', () => {
            expect(MessageTTSHandler.hasValidMessage('  Hello world  ')).toBe(true);
        });

        test('should return false for empty string', () => {
            expect(MessageTTSHandler.hasValidMessage('')).toBe(false);
        });

        test('should return false for whitespace-only string', () => {
            expect(MessageTTSHandler.hasValidMessage('   \n\t   ')).toBe(false);
        });

        test('should return false for null', () => {
            expect(MessageTTSHandler.hasValidMessage(null)).toBe(false);
        });

        test('should return false for undefined', () => {
            expect(MessageTTSHandler.hasValidMessage(undefined)).toBe(false);
        });

        test('should return false for non-string values', () => {
            expect(MessageTTSHandler.hasValidMessage(123)).toBe(false);
            expect(MessageTTSHandler.hasValidMessage({})).toBe(false);
            expect(MessageTTSHandler.hasValidMessage([])).toBe(false);
        });
    });

    describe('createMessageTTS', () => {
        test('should create properly formatted message TTS', () => {
            const result = MessageTTSHandler.createMessageTTS('TestUser', 'Hello world');
            expect(result).toBe('TestUser says Hello world');
        });

        test('should sanitize username for TTS', () => {
            const result = MessageTTSHandler.createMessageTTS('🎮VeryLongUsernameForTesting🎮', 'Hello');
            expect(result).toBe('VeryLongUser says Hello'); // Should be sanitized and truncated
        });

        test('should trim message content', () => {
            const result = MessageTTSHandler.createMessageTTS('User', '  Hello world  ');
            expect(result).toBe('User says Hello world');
        });

        test('should handle empty message gracefully', () => {
            const result = MessageTTSHandler.createMessageTTS('User', '');
            expect(result).toBe('User says ');
        });
    });

    describe('getMessageDelay', () => {
        test('should return 4000ms delay for SuperChat', () => {
            const notification = { type: 'gift', isSuperChat: true };
            expect(MessageTTSHandler.getMessageDelay(notification)).toBe(4000);
        });

        test('should return paypiggy delay for canonical paypiggy messages', () => {
            const notification = { type: 'paypiggy', message: 'Renewal with message' };
            expect(MessageTTSHandler.getMessageDelay(notification)).toBe(MessageTTSHandler.MESSAGE_DELAYS.paypiggy);
        });

        test('should return 3000ms delay for Twitch bits', () => {
            const notification = { type: 'gift', isBits: true };
            expect(MessageTTSHandler.getMessageDelay(notification)).toBe(3000);
        });

        test('should return 0ms delay for TikTok comments', () => {
            const notification = { type: 'chat', isComment: true };
            expect(MessageTTSHandler.getMessageDelay(notification)).toBe(0);
        });
    });
});
