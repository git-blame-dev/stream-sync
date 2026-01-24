const { describe, test, expect } = require('bun:test');
const { extractTikTokGiftData } = require('../../../src/utils/tiktok-data-extraction');

describe('extractTikTokGiftData', () => {
    const createValidGiftPayload = (overrides = {}) => ({
        user: { uniqueId: 'testUser123', nickname: 'testNickname' },
        giftDetails: {
            giftName: 'testGift',
            diamondCount: 100,
            giftType: 1
        },
        repeatCount: 5,
        repeatEnd: 1,
        groupId: 'testGroup123',
        ...overrides
    });

    describe('repeatEnd normalization', () => {
        test('normalizes repeatEnd 1 to boolean true', () => {
            const payload = createValidGiftPayload({ repeatEnd: 1 });
            const result = extractTikTokGiftData(payload);
            expect(result.repeatEnd).toBe(true);
        });

        test('normalizes repeatEnd 0 to boolean false', () => {
            const payload = createValidGiftPayload({ repeatEnd: 0 });
            const result = extractTikTokGiftData(payload);
            expect(result.repeatEnd).toBe(false);
        });

        test('returns boolean type for repeatEnd', () => {
            const payload = createValidGiftPayload({ repeatEnd: 1 });
            const result = extractTikTokGiftData(payload);
            expect(typeof result.repeatEnd).toBe('boolean');
        });
    });
});
