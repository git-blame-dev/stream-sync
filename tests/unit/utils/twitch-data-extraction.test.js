
const {
    extractTwitchRaidData
} = require('../../../src/utils/twitch-data-extraction');

describe('extractTwitchRaidData', () => {
    test('returns provided viewer count', () => {
        const result = extractTwitchRaidData({
            from_broadcaster_user_name: 'KnownRaider',
            from_broadcaster_user_id: 'raider-1',
            viewers: 42
        });

        expect(result.viewerCount).toBe(42);
    });

    test('throws when raid payload is missing required fields', () => {
        const build = () => extractTwitchRaidData({
            from_broadcaster_user_name: 'MysteryRaider'
        });

        expect(build).toThrow('from_broadcaster_user_name');
    });
});

describe('extractTwitchUserData', () => {
    test('extracts nested user id and username', () => {
        const result = require('../../../src/utils/twitch-data-extraction').extractTwitchUserData({
            user: { id: '123', display_name: 'Streamer' }
        });

        expect(result).toEqual({ userId: '123', username: 'Streamer' });
    });

    test('throws when display name is missing', () => {
        const build = () => require('../../../src/utils/twitch-data-extraction').extractTwitchUserData({
            user: { id: 'abc', login: 'fallbackUser' }
        });

        expect(build).toThrow('user.display_name');
    });

    test('throws when user object is missing', () => {
        const build = () => require('../../../src/utils/twitch-data-extraction').extractTwitchUserData({
            userId: 'flat-1',
            username: 'Flat User'
        });

        expect(build).toThrow('user object');
    });
});

describe('extractTwitchBitsData', () => {
    test('uses bits field and preserves message and anonymity flags', () => {
        const result = require('../../../src/utils/twitch-data-extraction').extractTwitchBitsData({
            bits: 250,
            message: 'Great stream!',
            isAnonymous: true,
            user: { id: 'user-1', display_name: 'ViewerOne' }
        });

        expect(result).toEqual({
            bits: 250,
            message: 'Great stream!',
            isAnonymous: true,
            userId: 'user-1',
            username: 'ViewerOne'
        });
    });

    test('throws when bits are missing', () => {
        const build = () => require('../../../src/utils/twitch-data-extraction').extractTwitchBitsData({
            amount: 100,
            userId: 'user-2'
        });

        expect(build).toThrow('numeric bits');
    });
});

describe('extractTwitchSubscriptionData', () => {
    test('normalizes new subscription with required fields', () => {
        const result = require('../../../src/utils/twitch-data-extraction').extractTwitchSubscriptionData({
            user: { id: 'u1', display_name: 'Subber' },
            tier: '1000',
            months: 1,
            isGift: false
        });

        expect(result.months).toBe(1);
        expect(result.isRenewal).toBe(false);
        expect(result.tier).toBe('1000');
        expect(result.isGift).toBe(false);
        expect(result.username).toBe('Subber');
    });

    test('treats month metadata as renewal and carries streak metadata', () => {
        const result = require('../../../src/utils/twitch-data-extraction').extractTwitchSubscriptionData({
            user: { id: 'u2', display_name: 'ResubUser' },
            tier: '1000',
            months: 5,
            message: 'Back again!'
        });

        expect(result.months).toBe(5);
        expect(result.isRenewal).toBe(true);
        expect(result.message).toBe('Back again!');
    });

    test('detects gift subscription data', () => {
        const result = require('../../../src/utils/twitch-data-extraction').extractTwitchSubscriptionData({
            user: { id: 'gifter', display_name: 'Gifter' },
            isGift: true,
            tier: '2000'
        });

        expect(result.isGift).toBe(true);
        expect(result.tier).toBe('2000');
    });

    test('ignores legacy isResub alias when determining renewal', () => {
        const result = require('../../../src/utils/twitch-data-extraction').extractTwitchSubscriptionData({
            user: { id: 'u3', display_name: 'LegacyResub' },
            tier: '1000',
            months: 1,
            isResub: true
        });

        expect(result.isRenewal).toBe(false);
    });
});

describe('formatters', () => {
    const { formatTwitchBits, formatTwitchTier } = require('../../../src/utils/twitch-data-extraction');

    test('formats bits with dollar conversion and leaves zero blank', () => {
        expect(formatTwitchBits(150)).toBe(' (150 bits - $1.50)');
        expect(formatTwitchBits(0)).toBe('');
    });

    test('formats tier strings and returns empty for base tier', () => {
        expect(formatTwitchTier('1000')).toBe('');
        expect(formatTwitchTier('2000')).toBe(' (Tier 2)');
        expect(formatTwitchTier('4000')).toBe(' (Tier 4000)');
    });
});
