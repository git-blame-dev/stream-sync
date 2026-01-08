
const { extractTikTokGiftData } = require('../src/utils/tiktok-data-extraction');

describe('TikTok Combo System', () => {
    describe('Data Extraction', () => {
        test('should extract combo fields correctly with giftType', () => {
            const comboData = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 },
                repeatCount: 3,
                groupId: 'combo_456',
                repeatEnd: true
            };

            const extracted = extractTikTokGiftData(comboData);

            expect(extracted).toEqual({
                giftType: 'Rose',
                giftCount: 3,
                amount: 3,
                currency: 'coins',
                unitAmount: 1,
                combo: true,
                comboType: 1,
                groupId: 'combo_456',
                repeatEnd: true
            });
        });

        test('should extract standard gifts without combo flags', () => {
            const standardData = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0 },
                repeatCount: 1
                // Missing combo fields
            };

            const extracted = extractTikTokGiftData(standardData);

            expect(extracted).toEqual({
                giftType: 'Rose',
                giftCount: 1,  // From repeatCount
                amount: 1,
                currency: 'coins',
                unitAmount: 1,
                combo: false,
                comboType: 0,
                groupId: undefined,
                repeatEnd: undefined
            });
        });


        test('should throw when data is null', () => {
            expect(() => extractTikTokGiftData(null)).toThrow('gift payload');
        });

        test('should throw when data is empty', () => {
            expect(() => extractTikTokGiftData({})).toThrow('requires giftDetails');
        });
    });

    describe('Combo Logic Validation', () => {
        test('should correctly identify standard gifts (giftType: 0)', () => {
            const standardGift = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0 },
                repeatCount: 1
            };

            const extracted = extractTikTokGiftData(standardGift);
            expect(extracted.combo).toBe(false);
            expect(extracted.comboType).toBe(0);
        });

        test('should correctly identify combo gifts (giftType: 1)', () => {
            const comboGift = {
                giftDetails: { giftName: 'Diamond', diamondCount: 5, giftType: 1 },
                repeatCount: 3,
                groupId: 'combo_123',
                repeatEnd: false
            };

            const extracted = extractTikTokGiftData(comboGift);
            expect(extracted.combo).toBe(true);
            expect(extracted.comboType).toBe(1);
            expect(extracted.groupId).toBe('combo_123');
            expect(extracted.repeatEnd).toBe(false);
        });

        test('should detect combo completion (giftType: 1, repeatEnd: true)', () => {
            const completedCombo = {
                giftDetails: { giftName: 'Diamond', diamondCount: 5, giftType: 1 },
                repeatCount: 10,
                groupId: 'combo_123',
                repeatEnd: true
            };

            const extracted = extractTikTokGiftData(completedCombo);
            expect(extracted.combo).toBe(true);
            expect(extracted.comboType).toBe(1);
            expect(extracted.groupId).toBe('combo_123');
            expect(extracted.repeatEnd).toBe(true);
        });
    });

    describe('Field Priority and Fallbacks', () => {
        test('should prioritize giftType over extendedGiftInfo.combo', () => {
            const data = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0, combo: true },
                repeatCount: 2,
                groupId: 'direct_group',
                repeatEnd: false
            };

            const extracted = extractTikTokGiftData(data);
            expect(extracted.combo).toBe(false); // giftType: 0 overrides combo field
            expect(extracted.comboType).toBe(0);
            expect(extracted.giftType).toBe('Rose');
            expect(extracted.groupId).toBe('direct_group');
        });

        test('should throw when giftType is missing', () => {
            const data = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, combo: true },
                repeatCount: 2,
                groupId: 'combo_123',
                repeatEnd: true
            };

            expect(() => extractTikTokGiftData(data)).toThrow('requires giftDetails.giftType');
        });
    });
}); 
