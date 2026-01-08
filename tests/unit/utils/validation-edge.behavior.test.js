
const {
    sanitizeForDisplay,
    isValidUrl
} = require('../../../src/utils/validation');

describe('validation edges', () => {
    describe('sanitizeForDisplay', () => {
        it('strips HTML/script and truncates to max length', () => {
            const result = sanitizeForDisplay('<b>Hello</b><script>alert(1)</script> world', 5);
            expect(result).toBe('Hello');
        });

        it('returns empty string for invalid inputs', () => {
            expect(sanitizeForDisplay(null)).toBe('');
            expect(sanitizeForDisplay(undefined)).toBe('');
        });
    });

    describe('isValidUrl', () => {
        it('accepts http/https and rejects javascript urls', () => {
            expect(isValidUrl('http://example.com')).toBe(true);
            expect(isValidUrl('https://example.com')).toBe(true);
            expect(isValidUrl('javascript:alert(1)')).toBe(false);
        });

        it('returns false for non-string inputs', () => {
            expect(isValidUrl(null)).toBe(false);
            expect(isValidUrl({})).toBe(false);
        });
    });

    describe('username helpers', () => {
        const {
            sanitizeForTTS,
            getFirstWord,
            formatUsername12
        } = require('../../../src/utils/validation');

        it('sanitizes usernames for TTS removing emoji/special chars and long numbers', () => {
            expect(sanitizeForTTS('🔥User12345!!')).toBe('User1');
            expect(sanitizeForTTS(null)).toBe('');
        });

        it('extracts first word with fallback when no letters', () => {
            expect(getFirstWord('123abc')).toBe('1');
            expect(getFirstWord('   ')).toBe('Unknown User');
        });

        it('formats usernames to 12 chars with TTS sanitization when needed', () => {
            expect(formatUsername12('VeryLongUsername123', false)).toBe('VeryLongUser');
            expect(formatUsername12('🌸DemoUser🌸', true)).toBe('DemoUser');
        });
    });
});
