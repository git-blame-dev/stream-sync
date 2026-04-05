const { describe, expect, it } = require('bun:test');
export {};
const { normalizeGreetingIdentityKey } = require('../../../src/utils/greeting-identity-key-normalizer');

describe('normalizeGreetingIdentityKey', () => {
    it('normalizes casing and whitespace for greeting identity keys', () => {
        expect(normalizeGreetingIdentityKey('twitch', '  TeSt-User  ')).toBe('test-user');
        expect(normalizeGreetingIdentityKey('tiktok', '  TestUniqueId  ')).toBe('testuniqueid');
    });

    it('strips leading @ only for youtube greeting identity keys', () => {
        expect(normalizeGreetingIdentityKey('youtube', '  @@@TestUser  ')).toBe('testuser');
        expect(normalizeGreetingIdentityKey('twitch', '@@TestUser')).toBe('@@testuser');
        expect(normalizeGreetingIdentityKey('tiktok', '@@TestUser')).toBe('@@testuser');
    });

    it('returns empty key for non-string or blank identity input', () => {
        expect(normalizeGreetingIdentityKey('youtube', null)).toBe('');
        expect(normalizeGreetingIdentityKey('youtube', undefined)).toBe('');
        expect(normalizeGreetingIdentityKey('youtube', 42)).toBe('');
        expect(normalizeGreetingIdentityKey('youtube', {})).toBe('');
        expect(normalizeGreetingIdentityKey('youtube', '   ')).toBe('');
    });
});
