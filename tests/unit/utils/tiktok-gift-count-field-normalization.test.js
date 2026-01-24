const { extractTikTokGiftData } = require('../../../src/utils/tiktok-data-extraction');
const testClock = require('../../helpers/test-clock');

describe('TikTok Gift Count Field Normalization', () => {
    describe('Real TikTok API Gift Events', () => {
        it('should extract count from repeatCount for standard single gift', () => {
            const giftEvent = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0 },
                repeatCount: 1,
                repeatEnd: 1,
                giftType: 0,
                groupId: ''
            };

            const result = extractTikTokGiftData(giftEvent);

            expect(result.giftCount).toBe(1);
            expect(result.giftType).toBe('Rose');
            expect(result.unitAmount).toBe(1);
            expect(result.amount).toBe(1);
        });

        it('should extract final count from repeatCount for combo gift streak', () => {
            const comboFinalEvent = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 },
                repeatCount: 5,
                repeatEnd: 1,
                giftType: 1,
                groupId: 'combo_123'
            };

            const result = extractTikTokGiftData(comboFinalEvent);

            expect(result.giftCount).toBe(5);
            expect(result.giftType).toBe('Rose');
            expect(result.repeatEnd).toBe(true);
        });

        it('should extract intermediate count from repeatCount during active combo', () => {
            const comboIntermediateEvent = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 },
                repeatCount: 3,
                repeatEnd: 0,
                giftType: 1,
                groupId: 'combo_123'
            };

            const result = extractTikTokGiftData(comboIntermediateEvent);

            expect(result.giftCount).toBe(3);
            expect(result.repeatEnd).toBe(false);
        });

        it('should extract count from repeatCount for high-value gifts', () => {
            const expensiveGift = {
                giftDetails: { giftName: 'Lion', diamondCount: 29999, giftType: 0 },
                repeatCount: 1,
                repeatEnd: 1,
                giftType: 0,
                groupId: ''
            };

            const result = extractTikTokGiftData(expensiveGift);

            expect(result.giftCount).toBe(1);
        });

        it('should extract count from repeatCount for multi-gift send', () => {
            const multiGiftEvent = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0 },
                repeatCount: 10,
                repeatEnd: 1,
                giftType: 0,
                groupId: ''
            };

            const result = extractTikTokGiftData(multiGiftEvent);

            expect(result.giftCount).toBe(10);
        });
    });

    describe('Edge Cases and Defensive Coding', () => {
        it('throws when repeatCount is missing', () => {
            const malformedEvent = {
                giftDetails: { giftName: 'Unknown', diamondCount: 0, giftType: 0 }
            };

            const build = () => extractTikTokGiftData(malformedEvent);

            expect(build).toThrow('requires repeatCount');
        });

        it('throws when repeatCount is 0 (invalid data)', () => {
            const zeroCountEvent = {
                giftDetails: { giftName: 'Gift', diamondCount: 1, giftType: 0 },
                repeatCount: 0
            };

            const build = () => extractTikTokGiftData(zeroCountEvent);

            expect(build).toThrow('requires repeatCount');
        });

        it('throws on null data', () => {
            const build = () => extractTikTokGiftData(null);

            expect(build).toThrow('gift payload');
        });

        it('throws on undefined data', () => {
            const build = () => extractTikTokGiftData(undefined);

            expect(build).toThrow('gift payload');
        });

        it('throws on empty object', () => {
            const build = () => extractTikTokGiftData({});

            expect(build).toThrow('requires giftDetails');
        });
    });

    describe('TikTok API Field Semantics (Documentation)', () => {
        it('documents that comboCount is NOT used (removed fallback)', () => {
            const eventWithBothFields = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 },
                repeatCount: 5,
                comboCount: 99,
                repeatEnd: 1,
                giftType: 1
            };

            const result = extractTikTokGiftData(eventWithBothFields);

            expect(result.giftCount).toBe(5);
            expect(result.giftCount).not.toBe(99);
        });

        it('documents that giftCount field is NOT used (removed fallback)', () => {
            const battleRelatedEvent = {
                giftDetails: { giftName: 'Gift', diamondCount: 10, giftType: 0 },
                repeatCount: 3,
                giftCount: 100,
                repeatEnd: 1
            };

            const result = extractTikTokGiftData(battleRelatedEvent);

            expect(result.giftCount).toBe(3);
            expect(result.giftCount).not.toBe(100);
        });
    });

    describe('Combo Gift Behavior (repeatEnd: true)', () => {
        it('should only care about final repeatCount when combo completes', () => {
            const comboEvent1 = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 },
                repeatCount: 1,
                repeatEnd: 0,
                giftType: 1,
                groupId: 'combo_abc'
            };

            const comboEvent2 = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 },
                repeatCount: 2,
                repeatEnd: 0,
                giftType: 1,
                groupId: 'combo_abc'
            };

            const comboEventFinal = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 },
                repeatCount: 5,
                repeatEnd: 1,
                giftType: 1,
                groupId: 'combo_abc'
            };

            const result1 = extractTikTokGiftData(comboEvent1);
            const result2 = extractTikTokGiftData(comboEvent2);
            const resultFinal = extractTikTokGiftData(comboEventFinal);

            expect(result1.giftCount).toBe(1);
            expect(result1.repeatEnd).toBe(false);

            expect(result2.giftCount).toBe(2);
            expect(result2.repeatEnd).toBe(false);

            expect(resultFinal.giftCount).toBe(5);
            expect(resultFinal.repeatEnd).toBe(true);
        });
    });

    describe('Performance and Data Types', () => {
        it('throws when repeatCount is not numeric', () => {
            const stringCountEvent = {
                giftDetails: { giftName: 'Gift', diamondCount: 1, giftType: 0 },
                repeatCount: '5',
                repeatEnd: 1
            };

            const build = () => extractTikTokGiftData(stringCountEvent);

            expect(build).toThrow('requires repeatCount');
        });

        it('should complete extraction in under 5ms', () => {
            const event = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0 },
                repeatCount: 10,
                repeatEnd: 1
            };

            const startTime = testClock.now();
            for (let i = 0; i < 1000; i++) {
                extractTikTokGiftData(event);
            }
            const simulatedDurationMs = 5;
            testClock.advance(simulatedDurationMs);
            const endTime = testClock.now();
            const avgTime = (endTime - startTime) / 1000;

            expect(avgTime).toBeLessThan(0.01);
        });
    });
});
