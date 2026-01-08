const {
    assertPlatformInterface,
    validatePlatformInterface
} = require('../../../src/utils/platform-interface-validator');

describe('platform-interface-validator behavior', () => {
    test('reports missing required methods with deterministic output', () => {
        const result = validatePlatformInterface('twitch', {});

        expect(result.valid).toBe(false);
        expect(result.missingMethods).toEqual(['cleanup', 'initialize', 'on']);
        expect(result.issues.join(' ')).toContain('missing required methods');
        expect(result.issues.join(' ')).toContain('initialize');
        expect(result.issues.join(' ')).toContain('cleanup');
        expect(result.issues.join(' ')).toContain('on');
    });

    test('assertPlatformInterface throws a user-friendly error for invalid platforms', () => {
        expect(() => assertPlatformInterface('youtube', null)).toThrow(/youtube/i);
        expect(() => assertPlatformInterface('youtube', null)).toThrow(/platform/i);
        expect(() => assertPlatformInterface('youtube', null)).toThrow(/object/i);
    });

    test('assertPlatformInterface returns the instance when valid', () => {
        const instance = { initialize: () => {}, cleanup: () => {}, on: () => {} };

        expect(assertPlatformInterface('tiktok', instance)).toBe(instance);
    });
});
