const { sanitizeForOBS } = require('../../../src/utils/obs-text-sanitizer');

describe('OBS Text Sanitizer - Unicode Crash Prevention', () => {
    describe('Unicode Crash Prevention', () => {
        it('should remove problematic Unicode from Coolguy username that crashed OBS', () => {
            const crashingUsername = "Coolguy✗'𝙤🥭";
            const result = sanitizeForOBS(crashingUsername);

            expect(result).toBe("Coolguy'");
            expect(result).not.toContain('�');
            expect(result).toMatch(/^[\x20-\x7E]*$/);
        });

        it('should preserve normal text and keyboard symbols', () => {
            const normalText = "User123!@#$%^&*()_+-=[]{}|;':\",./<>?";
            const result = sanitizeForOBS(normalText);

            expect(result).toBe(normalText);
        });

        it('should handle chat messages with emojis and Unicode', () => {
            const messageWithEmojis = "Hello world! 😊👍 Thanks for streaming! 🎮🔥";
            const result = sanitizeForOBS(messageWithEmojis);

            expect(result).toBe("Hello world!  Thanks for streaming! ");
        });

        it('should handle complex Unicode usernames from TikTok', () => {
            const unicodeUsernames = [
                "用户名中文",           // Chinese characters
                "Пользователь",        // Cyrillic
                "ユーザー名",           // Japanese
                "🔥💯BestUser💯🔥",    // Emoji sandwich
                "User▲▼◆◇",          // Geometric symbols
                "Test™®©",            // Trademark symbols
            ];

            unicodeUsernames.forEach(username => {
                const result = sanitizeForOBS(username);

                expect(result).toMatch(/^[\x20-\x7E]*$/);
                expect(result).not.toContain('�');
            });
        });

        it('should handle mixed ASCII and Unicode content', () => {
            const mixedContent = "NormalText🚀MoreText✨EndText";
            const result = sanitizeForOBS(mixedContent);

            expect(result).toBe("NormalTextMoreTextEndText");
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty input', () => {
            expect(sanitizeForOBS('')).toBe('');
        });

        it('should handle null input', () => {
            expect(sanitizeForOBS(null)).toBe('');
        });

        it('should handle undefined input', () => {
            expect(sanitizeForOBS(undefined)).toBe('');
        });

        it('should handle non-string input', () => {
            expect(sanitizeForOBS(123)).toBe('');
            expect(sanitizeForOBS({})).toBe('');
            expect(sanitizeForOBS([])).toBe('');
        });

        it('should trim whitespace from result', () => {
            const textWithUnicodeSpaces = "  Normal text  \u2000\u2001\u2002  ";
            const result = sanitizeForOBS(textWithUnicodeSpaces);

            expect(result).toBe("  Normal text    ");
        });

        it('should handle text that becomes empty after sanitization', () => {
            const onlyEmojis = "😊🎮🔥💯";
            const result = sanitizeForOBS(onlyEmojis);

            expect(result).toBe('');
        });

        it('should handle very long text with Unicode', () => {
            const longText = "A".repeat(100) + "🚀" + "B".repeat(100) + "✨" + "C".repeat(100);
            const result = sanitizeForOBS(longText);

            expect(result).toHaveLength(300);
            expect(result).toMatch(/^[ABC]*$/);
        });
    });

    describe('Character Range Validation', () => {
        it('should preserve all ASCII printable characters (32-126)', () => {
            const allAsciiPrintable = Array.from(
                { length: 95 },
                (_, i) => String.fromCharCode(32 + i)
            ).join('');

            const result = sanitizeForOBS(allAsciiPrintable);
            expect(result).toBe(allAsciiPrintable);
        });

        it('should remove ASCII control characters', () => {
            const withControlChars = "Normal\x00\x01\x02\x1F text";
            const result = sanitizeForOBS(withControlChars);

            expect(result).toBe("Normal text");
        });

        it('should remove high ASCII characters (127+)', () => {
            const withHighAscii = "Normal\x7F\x80\xFF text";
            const result = sanitizeForOBS(withHighAscii);

            expect(result).toBe("Normal text");
        });
    });

});
