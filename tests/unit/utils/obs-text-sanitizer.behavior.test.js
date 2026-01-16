const { describe, test, expect } = require('bun:test');

const {
    sanitizeForOBS,
    isOBSSafe,
    sanitizeUsernameForOBS,
    sanitizeChatForOBS
} = require('../../../src/utils/obs-text-sanitizer');

describe('obs-text-sanitizer behavior', () => {
    test('removes unsafe characters and keeps printable ASCII', () => {
        expect(sanitizeForOBS('Coolguy✗o🥭')).toBe('Coolguyo');
        expect(isOBSSafe('Hello World!')).toBe(true);
        expect(isOBSSafe('Hello 🌍!')).toBe(false);
    });

    test('falls back to safe defaults for invalid input', () => {
        expect(sanitizeForOBS(null)).toBe('');
        expect(sanitizeUsernameForOBS('🔥💯')).toBe('Unknown User');
        expect(sanitizeChatForOBS(undefined)).toBe('');
    });

    test('preserves structure while stripping unicode noise', () => {
        expect(sanitizeChatForOBS('User: Hello! 😊')).toBe('User: Hello! ');
        expect(sanitizeUsernameForOBS('NormalUser')).toBe('NormalUser');
    });

    test('returns fallback username when sanitized output is empty', () => {
        expect(sanitizeUsernameForOBS('')).toBe('Unknown User');
        expect(sanitizeUsernameForOBS('🔥💯')).toBe('Unknown User');
        expect(sanitizeUsernameForOBS('日本語')).toBe('Unknown User');
    });
});
