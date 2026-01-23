const { describe, expect, it } = require('bun:test');

const {
    formatUsername12,
    formatUsernameForTTSGreeting,
    getFirstWord
} = require('../../../src/utils/validation');

describe('validation fallback username behavior', () => {
    it('returns fallback for null input', () => {
        const result = formatUsername12(null);
        expect(result).toBeTruthy();
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('returns fallback for undefined input', () => {
        const result = formatUsername12(undefined);
        expect(result).toBeTruthy();
        expect(typeof result).toBe('string');
    });

    it('returns fallback for non-alphanumeric input in TTS greeting', () => {
        const result = formatUsernameForTTSGreeting('!!!');
        expect(result).toBeTruthy();
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('returns fallback for non-alphanumeric input in getFirstWord', () => {
        const result = getFirstWord('!!!');
        expect(result).toBeTruthy();
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('preserves valid usernames without modification', () => {
        expect(formatUsername12('TestUser')).toBe('TestUser');
        expect(formatUsernameForTTSGreeting('ValidName')).toBe('ValidName');
        expect(getFirstWord('SimpleUser')).toBe('SimpleUser');
    });

    it('handles empty string as invalid input', () => {
        const result = formatUsername12('');
        expect(result).toBeTruthy();
        expect(result.length).toBeGreaterThan(0);
    });

    it('handles whitespace-only input as invalid', () => {
        const result = formatUsername12('   ');
        expect(result).toBeTruthy();
        expect(result.length).toBeGreaterThan(0);
    });
});
