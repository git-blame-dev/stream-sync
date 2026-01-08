const { extractTikTokGiftData } = require('../../../src/utils/tiktok-data-extraction');

describe('extractTikTokGiftData - WebcastGiftMessage shape', () => {
    it('parses nested webcast gift with diamondCount and repeatCount', () => {
        const raw = {
            giftDetails: {
                giftName: 'Corgi',
                diamondCount: 299,
                giftType: 2,
                giftId: 6267
            },
            gift: {
                giftName: { giftName: 'Corgi' },
                diamondCount: 299,
                giftType: 2,
                giftId: 6267,
                repeatCount: 2
            },
            repeatCount: 2
        };

        const result = extractTikTokGiftData(raw);

        expect(result.giftType).toBe('Corgi');
        expect(result.unitAmount).toBe(299);
        expect(result.amount).toBe(598);
        expect(result.giftCount).toBe(2);
        expect(result.comboType).toBe(2);
        expect(result.combo).toBe(false);
    });

    it('uses top-level repeatCount for gift count', () => {
        const raw = {
            giftDetails: {
                giftName: 'Heart Me',
                diamondCount: 25,
                giftType: 0
            },
            gift: {
                giftName: { giftName: 'Heart Me' },
                diamondCount: 25,
                giftType: 0
            },
            repeatCount: 3
        };

        const result = extractTikTokGiftData(raw);

        expect(result.giftType).toBe('Heart Me');
        expect(result.unitAmount).toBe(25);
        expect(result.amount).toBe(75);
        expect(result.giftCount).toBe(3);
        expect(result.comboType).toBe(0);
    });
});
