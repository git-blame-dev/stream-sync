const { describe, it, expect } = require('bun:test');

const { getPlatformIconUrl } = require('../../../gui/src/shared/platform-icon-map');

describe('platform icon map behavior', () => {
    it('returns icon URLs for each supported platform id', () => {
        expect(getPlatformIconUrl('youtube')).toBe('/gui/assets/platform-icons/youtube-icon.png');
        expect(getPlatformIconUrl('twitch')).toBe('/gui/assets/platform-icons/twitch-icon.png');
        expect(getPlatformIconUrl('tiktok')).toBe('/gui/assets/platform-icons/tiktok-icon.png');
    });

    it('normalizes case and whitespace when resolving platform ids', () => {
        expect(getPlatformIconUrl('  YouTube  ')).toBe('/gui/assets/platform-icons/youtube-icon.png');
        expect(getPlatformIconUrl(' TwItCh ')).toBe('/gui/assets/platform-icons/twitch-icon.png');
    });

    it('returns null for unknown or non-string platform ids', () => {
        expect(getPlatformIconUrl('unknown')).toBeNull();
        expect(getPlatformIconUrl(null)).toBeNull();
        expect(getPlatformIconUrl(42)).toBeNull();
    });
});
