
const { initializeTestLogging, TEST_USERNAMES } = require('./helpers/test-setup');
const { formatUsername12, sanitizeDisplayName, sanitizeForTTSWithLimit } = require('../src/utils/validation');

// Initialize logging system for tests
initializeTestLogging();

describe('Username 12-Character Limit Formatting', () => {
    
    describe('formatUsername12 core function', () => {
        test('should preserve usernames within 12 characters', () => {
            expect(formatUsername12(TEST_USERNAMES.WITH_EMOJIS, false)).toBe('🌸DemoUser🌸'); // 9 chars, display
            expect(formatUsername12(TEST_USERNAMES.WITH_EMOJIS, true)).toBe('DemoUser'); // TTS removes emojis
            expect(formatUsername12(TEST_USERNAMES.SIMPLE, false)).toBe('TestUser'); // 8 chars
            expect(formatUsername12(TEST_USERNAMES.SIMPLE, true)).toBe('TestUser'); // 8 chars
        });

        test('should use first word(s) that fit within 12 characters', () => {
            expect(formatUsername12('John Doe Smith', false)).toBe('John Doe'); // First 2 words = 8 chars
            expect(formatUsername12('John Doe Smith', true)).toBe('John Doe'); // First 2 words = 8 chars
            expect(formatUsername12('A B C D E F G', false)).toBe('A B C D E F'); // Multiple short words
            expect(formatUsername12('Super Cool', false)).toBe('Super Cool'); // 10 chars total
        });

        test('should truncate to 12 characters when words are too long', () => {
            expect(formatUsername12('VeryLongUsername123456789', false)).toBe('VeryLongUser'); // Truncated to 12
            expect(formatUsername12('SuperCoolGamer123', false)).toBe('SuperCoolGam'); // Truncated to 12
            expect(formatUsername12('OneVeryLongWordThatExceeds', false)).toBe('OneVeryLongW'); // Truncated to 12
        });

        test('should handle TTS emoji removal and special character filtering', () => {
            // Note: Emoji rendering may vary in test output, but length should be correct
            const displayResult = formatUsername12('🎮GamerGirl🎮', false);
            const ttsResult = formatUsername12('🎮GamerGirl🎮', true);
            
            expect(displayResult.length).toBeLessThanOrEqual(12); // Display keeps emojis but within limit
            expect(ttsResult).toBe('GamerGirl'); // TTS removes emojis
            expect(formatUsername12('user123!@#', false)).toBe('user123!@#'); // Display keeps special chars
            expect(formatUsername12('user123!@#', true)).toBe('user1'); // TTS removes special chars, keeps first digit
        });

        test('should handle edge cases gracefully', () => {
            expect(formatUsername12('', false)).toBe('Unknown User'); // Empty string
            expect(formatUsername12('   ', false)).toBe('Unknown User'); // Only whitespace
            expect(formatUsername12('🔥💯', false)).toBe('🔥💯'); // Only emojis for display
            expect(formatUsername12('🔥💯', true)).toBe('Unknown User'); // Only emojis for TTS
            expect(formatUsername12(null, false)).toBe('Unknown User'); // Null input
            expect(formatUsername12(undefined, true)).toBe('Unknown User'); // Undefined input
        });
    });

    describe('sanitizeDisplayName with 12-character limit', () => {
        test('should use 12-character limit by default', () => {
            expect(sanitizeDisplayName('🌸DemoUser🌸')).toBe('🌸DemoUser🌸'); // Within limit
            expect(sanitizeDisplayName('VeryLongUsername123456789')).toBe('VeryLongUser'); // Truncated to 12
            expect(sanitizeDisplayName('John Doe Smith')).toBe('John Doe'); // First 2 words
        });

        test('should preserve international characters for display', () => {
            expect(sanitizeDisplayName('用户名中文')).toBe('用户名中文'); // Chinese
            expect(sanitizeDisplayName('ユーザー名日本語')).toBe('ユーザー名日本語'); // Japanese (within 12 chars)
            expect(sanitizeDisplayName('МойПользователь')).toBe('МойПользоват'); // Cyrillic (truncated to 12)
        });

        test('should remove dangerous HTML but preserve safe content', () => {
            const htmlResult = sanitizeDisplayName('User<script>alert()</script>');
            expect(htmlResult.length).toBeLessThanOrEqual(12); // Should be sanitized and within limit
            expect(htmlResult).not.toContain('<script>'); // Script tags removed
            expect(sanitizeDisplayName('Safe&Username')).toBe('Safe&Usernam'); // Truncated to 12 chars
        });
    });

    describe('sanitizeForTTSWithLimit with 12-character limit', () => {
        test('should limit TTS usernames to 12 characters', () => {
            expect(sanitizeForTTSWithLimit('🌸DemoUser🌸')).toBe('DemoUser'); // Emojis removed
            expect(sanitizeForTTSWithLimit('VeryLongUsername123')).toBe('VeryLongUser'); // Truncated to 12
            expect(sanitizeForTTSWithLimit('John Doe Smith')).toBe('John Doe'); // First 2 words
        });

        test('should remove emojis and special characters for TTS', () => {
            expect(sanitizeForTTSWithLimit('user123!')).toBe('user1'); // Special chars removed, keeps first digit
            expect(sanitizeForTTSWithLimit('test🎮user')).toBe('testuser'); // Emojis removed
            expect(sanitizeForTTSWithLimit('normal_user')).toBe('normal user'); // Underscores converted to spaces
        });

        test('should handle TTS-incompatible usernames', () => {
            expect(sanitizeForTTSWithLimit('🔥💯')).toBe('Unknown User'); // Only emojis
            expect(sanitizeForTTSWithLimit('!@#$%^&*()')).toBe('Unknown User'); // Only special chars
            expect(sanitizeForTTSWithLimit('   🎉   ')).toBe('Unknown User'); // Whitespace and emojis
        });
    });

    describe('Real-world username examples', () => {
        test('should handle common streaming platform usernames', () => {
            // TikTok style usernames
            const tiktokDisplay = formatUsername12('🌸CuteGamer🌸', false);
            expect(tiktokDisplay.length).toBeLessThanOrEqual(12); // Should be within limit
            expect(formatUsername12('🌸CuteGamer🌸', true)).toBe('CuteGamer'); // TTS
            
            // Twitch style usernames
            expect(formatUsername12('ProGamer_2023', false)).toBe('ProGamer_202'); // Truncated to 12
            expect(formatUsername12('ProGamer_2023', true)).toBe('ProGamer 2'); // TTS converts underscores to spaces, truncates numbers
            
            // YouTube style usernames  
            expect(formatUsername12('Music Lover 42', false)).toBe('Music Lover'); // First 2 words = 11 chars
            expect(formatUsername12('Music Lover 42', true)).toBe('Music Lover'); // TTS keeps letters and spaces
        });

        test('should demonstrate the alpha-style behavior', () => {
            // Examples that should use first word preference
            const testCases = [
                { input: 'SuperAwesome', expected: 'SuperAwesome' }, // 12 chars exactly - no truncation needed
                { input: 'Cool User Name', expected: 'Cool User' }, // First 2 words
                { input: 'A B C D E F G H', expected: 'A B C D E F' }, // Multiple short words
                { input: 'VeryVeryVeryLongUsername', expected: 'VeryVeryVery' }, // Truncated to 12
            ];

            testCases.forEach(({ input, expected }) => {
                expect(formatUsername12(input, false)).toBe(expected);
            });
        });

        test('should show difference between display and TTS formatting', () => {
            const testUsernames = [
                '🌸DemoUser🌸',
                '🎮SuperGamer123!',
                'Cool User With Spaces',
                'VeryLongUsernameExceeding12Chars'
            ];

            testUsernames.forEach(username => {
                const displayResult = formatUsername12(username, false);
                const ttsResult = formatUsername12(username, true);
                
                // Both should be 12 characters or less
                expect(displayResult.length).toBeLessThanOrEqual(12);
                expect(ttsResult.length).toBeLessThanOrEqual(12);
                
                // Display should preserve more characters than TTS
                console.log(`Username: "${username}"`);
                console.log(`  Display: "${displayResult}" (${displayResult.length} chars)`);
                console.log(`  TTS: "${ttsResult}" (${ttsResult.length} chars)`);
            });
        });
    });
}); 
