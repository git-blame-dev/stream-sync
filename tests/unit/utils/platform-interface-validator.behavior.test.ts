const { describe, test, expect } = require('bun:test');
const {
    assertPlatformInterface
} = require('../../../src/utils/platform-interface-validator');
export {};

describe('platform-interface-validator behavior', () => {
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
