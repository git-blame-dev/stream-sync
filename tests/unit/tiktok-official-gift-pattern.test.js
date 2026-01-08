const { extractTikTokGiftData } = require('../../src/utils/tiktok-data-extraction');

describe('TikTok Official Gift Pattern', () => {
    describe('Gift Type Detection', () => {
        test('identifies giftType: 1 as combo-enabled gift', () => {
            const giftData = {
                repeatCount: 3,
                repeatEnd: false,
                groupId: 'combo_123',
                giftDetails: {
                    giftName: 'Rose',
                    giftType: 1,
                    diamondCount: 1
                }
            };

            const result = extractTikTokGiftData(giftData);
            expect(result.combo).toBe(true);
            expect(result.giftCount).toBe(3);
            expect(result.repeatEnd).toBe(false);
        });

        test('identifies giftType: 0 as non-combo gift', () => {
            const giftData = {
                repeatCount: 1,
                repeatEnd: false,
                giftDetails: {
                    giftName: 'Im Just a Hamster',
                    giftType: 0,
                    diamondCount: 499
                }
            };

            const result = extractTikTokGiftData(giftData);
            expect(result.combo).toBe(false);
            expect(result.giftCount).toBe(1);
        });

        test('prioritizes giftType over conflicting combo hints', () => {
            const giftData = {
                repeatCount: 1,
                giftDetails: {
                    giftName: 'Conflicted Gift',
                    giftType: 0,
                    combo: true,
                    diamondCount: 100
                }
            };

            const result = extractTikTokGiftData(giftData);
            expect(result.combo).toBe(false);
        });

        test('throws when giftType is missing', () => {
            const giftData = {
                repeatCount: 1,
                giftDetails: {
                    giftName: 'Sample Gift',
                    combo: true,
                    diamondCount: 50
                }
            };

            expect(() => extractTikTokGiftData(giftData)).toThrow('giftDetails.giftType');
        });

        test('throws when giftType is malformed', () => {
            const giftData = {
                repeatCount: 1,
                giftDetails: {
                    giftName: 'Malformed Gift',
                    giftType: 'invalid',
                    diamondCount: 25
                }
            };

            expect(() => extractTikTokGiftData(giftData)).toThrow('giftDetails.giftType');
        });
    });
});
