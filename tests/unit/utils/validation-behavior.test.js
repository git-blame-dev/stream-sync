
const {
    sanitizeForTTS,
    getFirstWord,
    sanitizeForTTSGreeting,
    formatUsernameForTTSGreeting,
    isValidCommand,
    sanitizeCommand,
    validateMessage,
    isValidPlatformUsername,
    validateForTTS,
    extractYouTubeVideoId,
    sanitizeForDisplay,
    isValidUrl,
    validateConfigStructure,
    isValidUserId,
    getMessageLengthLimit
} = require('../../../src/utils/validation');

describe('validation utilities', () => {
    describe('sanitizeForTTS', () => {
        it('removes emojis/special chars and truncates long numbers', () => {
            expect(sanitizeForTTS('🔥User123')).toBe('User1');
            expect(sanitizeForTTS(' normal_user ')).toBe('normal user');
        });

        it('returns empty string for invalid inputs', () => {
            expect(sanitizeForTTS('🔥💯')).toBe('');
            expect(sanitizeForTTS(null)).toBe('');
        });
    });

    describe('getFirstWord', () => {
        it('returns first number when username starts with number', () => {
            expect(getFirstWord('123abc')).toBe('1');
        });

        it('returns first letter word when username starts with letters', () => {
            expect(getFirstWord('john_doe_99')).toBe('john');
        });

        it('falls back to Unknown User when no alphanumerics', () => {
            expect(getFirstWord('🔥 💯')).toBe('Unknown User');
        });
    });

    describe('greeting TTS formatting', () => {
        it('sanitizes for greeting TTS with generous length', () => {
            expect(sanitizeForTTSGreeting('💋DemoStar💋 the Great 999')).toBe('DemoStar the Great 9');
        });

        it('caps at ~20 chars while keeping words where possible', () => {
            const result = formatUsernameForTTSGreeting('Very Long Username With Spaces And Numbers 1234');
            expect(result.length).toBeLessThanOrEqual(20);
            expect(result).toContain('Very');
        });

        it('falls back to Unknown User when nothing remains after sanitization', () => {
            expect(formatUsernameForTTSGreeting('💯🔥')).toBe('Unknown User');
        });
    });

    describe('command validation/sanitization', () => {
        it('accepts valid commands and rejects invalid patterns', () => {
            expect(isValidCommand('!hello world')).toBe(true);
            expect(isValidCommand('hello')).toBe(false);
            expect(isValidCommand('!bad<script>')).toBe(false);
        });

        it('sanitizes commands to remove HTML and shell injection chars', () => {
            expect(sanitizeCommand('!test<script>alert(1)</script>')).toBe('!testscriptalert(1)/script');
            expect(sanitizeCommand('!cmd; rm -rf /')).toBe('!cmd rm -rf /');
        });
    });

    describe('message validation', () => {
        it('rejects overly long messages per platform limits and strips HTML/JS', () => {
            const tooLong = validateMessage('a'.repeat(600), 'YouTube');
            expect(tooLong.isValid).toBe(false);
            expect(tooLong.errors[0]).toContain('Message too long');

            const sanitized = validateMessage('<b>Hello</b><script>alert(1)</script>', 'TikTok');
            expect(sanitized.isValid).toBe(true);
            expect(sanitized.sanitized).toBe('Hello');
        });
    });

    describe('platform username validation', () => {
        it('uses platform-specific rules', () => {
            expect(isValidPlatformUsername('valid_user', 'twitch')).toBe(true);
            expect(isValidPlatformUsername('ab', 'twitch')).toBe(false);
            expect(isValidPlatformUsername('@user.name', 'tiktok')).toBe(true);
            expect(isValidPlatformUsername('name', 'youtube')).toBe(true);
        });
    });

    describe('validateForTTS', () => {
        it('returns invalid when sanitization removes all content', () => {
            const result = validateForTTS('🔥🔥');
            expect(result.isValid).toBe(false);
            expect(result.sanitized).toBe('');
        });

        it('returns sanitized content when valid', () => {
            const result = validateForTTS('User123!');
            expect(result.isValid).toBe(true);
            expect(result.sanitized).toBe('User1');
        });
    });

    describe('extractYouTubeVideoId', () => {
        it('extracts IDs from youtube and youtu.be URLs', () => {
            expect(extractYouTubeVideoId('https://youtube.com/watch?v=abc123XYZ89')).toBe('abc123XYZ89');
            expect(extractYouTubeVideoId('https://youtu.be/xyz98765432')).toBe('xyz98765432');
            expect(extractYouTubeVideoId('not-a-url')).toBeNull();
        });
    });

    describe('sanitizeForDisplay', () => {
        it('removes HTML/script and trims/limits length', () => {
            const result = sanitizeForDisplay('<b>Hello</b> <script>alert(1)</script>', 20);
            expect(result).toBe('Hello alert(1)');
        });
    });

    describe('isValidUrl', () => {
        it('accepts http/https and rejects others', () => {
            expect(isValidUrl('https://example.com')).toBe(true);
            expect(isValidUrl('ftp://example.com')).toBe(false);
        });
    });

    describe('validateConfigStructure', () => {
        it('throws when general section missing and returns true when present', () => {
            expect(() => validateConfigStructure(null)).toThrow();
            expect(() => validateConfigStructure({ obs: {} })).toThrow('Missing required configuration section: general');
            expect(() => validateConfigStructure({ general: {} })).not.toThrow();
            expect(validateConfigStructure({ general: {} })).toBe(true);
        });
    });

    describe('isValidUserId', () => {
        it('requires non-empty trimmed strings', () => {
            expect(isValidUserId(' user ')).toBe(true);
            expect(isValidUserId('   ')).toBe(false);
        });
    });

    describe('getMessageLengthLimit', () => {
        it('returns platform-specific or default limits', () => {
            expect(getMessageLengthLimit('TikTok')).toBe(150);
            expect(getMessageLengthLimit('unknown')).toBe(200);
        });
    });
});
