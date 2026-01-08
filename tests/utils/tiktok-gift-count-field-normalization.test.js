
const { extractTikTokGiftData } = require('../../src/utils/tiktok-data-extraction');

describe('TikTok Gift Count Field Normalization', () => {
    describe('Real TikTok API Gift Events', () => {
        it('should extract count from repeatCount for standard single gift', () => {
            // Arrange: Real TikTok gift event structure
            const giftEvent = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0 },
                repeatCount: 1,
                repeatEnd: 1,
                giftType: 0,
                groupId: ''
            };

            // Act
            const result = extractTikTokGiftData(giftEvent);

            // Assert: Verify correct count is extracted
            expect(result.giftCount).toBe(1);
            expect(result.giftType).toBe('Rose');
            expect(result.unitAmount).toBe(1);
            expect(result.amount).toBe(1);
        });

        it('should extract final count from repeatCount for combo gift streak', () => {
            // Arrange: Final event in a combo streak (user sent 5 roses total)
            const comboFinalEvent = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 },
                repeatCount: 5,      // FINAL total count
                repeatEnd: 1,        // Streak is complete
                giftType: 1,         // Combo-enabled gift
                groupId: 'combo_123'
            };

            // Act
            const result = extractTikTokGiftData(comboFinalEvent);

            // Assert: Verify final count is extracted
            expect(result.giftCount).toBe(5);
            expect(result.giftType).toBe('Rose');
            expect(result.repeatEnd).toBe(1);  // Returns truthy value (not converted)
        });

        it('should extract intermediate count from repeatCount during active combo', () => {
            // Arrange: Intermediate event during combo (3 out of eventual 5)
            const comboIntermediateEvent = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 },
                repeatCount: 3,      // Current count (will increase)
                repeatEnd: 0,        // Streak still active
                giftType: 1,
                groupId: 'combo_123'
            };

            // Act
            const result = extractTikTokGiftData(comboIntermediateEvent);

            // Assert: Verify intermediate count is extracted
            // NOTE: Platform handler will discard this until repeatEnd: true
            expect(result.giftCount).toBe(3);
            expect(result.repeatEnd).toBe(0);
        });

        it('should extract count from repeatCount for high-value gifts', () => {
            // Arrange: Expensive gift with high diamond count
            const expensiveGift = {
                giftDetails: { giftName: 'Lion', diamondCount: 29999, giftType: 0 },
                repeatCount: 1,
                repeatEnd: 1,
                giftType: 0,
                groupId: ''
            };

            // Act
            const result = extractTikTokGiftData(expensiveGift);

            // Assert
            expect(result.giftCount).toBe(1);
        });

        it('should extract count from repeatCount for multi-gift send', () => {
            // Arrange: User sends 10 gifts at once (not combo, just quantity)
            const multiGiftEvent = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0 },
                repeatCount: 10,
                repeatEnd: 1,
                giftType: 0,  // Non-combo
                groupId: ''
            };

            // Act
            const result = extractTikTokGiftData(multiGiftEvent);

            // Assert
            expect(result.giftCount).toBe(10);
        });
    });

    describe('Edge Cases and Defensive Coding', () => {
        it('throws when repeatCount is missing', () => {
            // Arrange: Malformed event with no count fields
            const malformedEvent = {
                giftDetails: { giftName: 'Unknown', diamondCount: 0, giftType: 0 }
                // No repeatCount field - this is a DATA ERROR
            };

            // Act
            const build = () => extractTikTokGiftData(malformedEvent);

            // Assert: Invalid payload rejected
            expect(build).toThrow('requires repeatCount');
        });

        it('throws when repeatCount is 0 (invalid data)', () => {
            // Arrange: Edge case with zero count (TikTok API malformed)
            const zeroCountEvent = {
                giftDetails: { giftName: 'Gift', diamondCount: 1, giftType: 0 },
                repeatCount: 0  // Invalid - TikTok should never send 0
            };

            // Act
            const build = () => extractTikTokGiftData(zeroCountEvent);

            // Assert: Invalid payload rejected
            expect(build).toThrow('requires repeatCount');
        });

        it('throws on null data', () => {
            // Arrange: Null input (defensive)
            const nullData = null;

            // Act
            const build = () => extractTikTokGiftData(nullData);

            // Assert: Invalid payload rejected
            expect(build).toThrow('gift payload');
        });

        it('throws on undefined data', () => {
            // Arrange: Undefined input (defensive)
            const undefinedData = undefined;

            // Act
            const build = () => extractTikTokGiftData(undefinedData);

            // Assert: Invalid payload rejected
            expect(build).toThrow('gift payload');
        });

        it('throws on empty object', () => {
            // Arrange: Empty event data
            const emptyData = {};

            // Act
            const build = () => extractTikTokGiftData(emptyData);

            // Assert: Invalid payload rejected
            expect(build).toThrow('requires giftDetails');
        });
    });

    describe('TikTok API Field Semantics (Documentation)', () => {
        // These tests document WHAT the fields mean, not that we use wrong ones

        it('documents that comboCount is NOT used (removed fallback)', () => {
            // Arrange: Event with BOTH repeatCount and comboCount
            // comboCount is for combo badge display, NOT gift quantity
            const eventWithBothFields = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 },
                repeatCount: 5,      // Actual gift count (ONLY field we use)
                comboCount: 99,      // Combo badge count (IGNORED)
                repeatEnd: 1,
                giftType: 1
            };

            // Act
            const result = extractTikTokGiftData(eventWithBothFields);

            // Assert: Should ONLY use repeatCount, comboCount is ignored
            expect(result.giftCount).toBe(5);  // From repeatCount
            expect(result.giftCount).not.toBe(99);  // comboCount is NOT used
        });

        it('documents that giftCount field is NOT used (removed fallback)', () => {
            // Arrange: Event with repeatCount and battle giftCount
            const battleRelatedEvent = {
                giftDetails: { giftName: 'Gift', diamondCount: 10, giftType: 0 },
                repeatCount: 3,      // Actual gift count (ONLY field we use)
                giftCount: 100,      // Battle-related field (IGNORED)
                repeatEnd: 1
            };

            // Act
            const result = extractTikTokGiftData(battleRelatedEvent);

            // Assert: Should ONLY use repeatCount, battle giftCount is ignored
            expect(result.giftCount).toBe(3);  // From repeatCount
            expect(result.giftCount).not.toBe(100);  // battle giftCount is NOT used
        });
    });

    describe('Combo Gift Behavior (repeatEnd: true)', () => {
        it('should only care about final repeatCount when combo completes', () => {
            // Arrange: Sequence of combo events (simulating real TikTok behavior)
            const comboEvent1 = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 },
                repeatCount: 1,
                repeatEnd: 0,  // NOT done yet
                giftType: 1,
                groupId: 'combo_abc'
            };

            const comboEvent2 = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 },
                repeatCount: 2,
                repeatEnd: 0,  // Still NOT done
                giftType: 1,
                groupId: 'combo_abc'
            };

            const comboEventFinal = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 },
                repeatCount: 5,
                repeatEnd: 1,  // NOW it's done!
                giftType: 1,
                groupId: 'combo_abc'
            };

            // Act: Extract from all events
            const result1 = extractTikTokGiftData(comboEvent1);
            const result2 = extractTikTokGiftData(comboEvent2);
            const resultFinal = extractTikTokGiftData(comboEventFinal);

            // Assert: All extract their repeatCount correctly
            // (Platform handler will only process the final one)
            expect(result1.giftCount).toBe(1);
            expect(result1.repeatEnd).toBe(0);  // repeatEnd propagated as-is

            expect(result2.giftCount).toBe(2);
            expect(result2.repeatEnd).toBe(0);  // repeatEnd propagated as-is

            expect(resultFinal.giftCount).toBe(5);  // This is what we care about
            expect(resultFinal.repeatEnd).toBe(1);  // Truthy value (1) returned directly
        });
    });

    describe('Performance and Data Types', () => {
        it('throws when repeatCount is not numeric', () => {
            // Arrange: API might return string instead of number
            const stringCountEvent = {
                giftDetails: { giftName: 'Gift', diamondCount: 1, giftType: 0 },
                repeatCount: '5',  // String instead of number
                repeatEnd: 1
            };

            // Act
            const build = () => extractTikTokGiftData(stringCountEvent);

            // Assert: Invalid payload rejected
            expect(build).toThrow('requires repeatCount');
        });

        it('should complete extraction in under 5ms', () => {
            // Arrange: Standard event
            const event = {
                giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0 },
                repeatCount: 10,
                repeatEnd: 1
            };

            // Act & Assert: Performance check
            const startTime = performance.now();
            for (let i = 0; i < 1000; i++) {
                extractTikTokGiftData(event);
            }
            const endTime = performance.now();
            const avgTime = (endTime - startTime) / 1000;

            // Should average under 0.005ms per call
            expect(avgTime).toBeLessThan(0.01);  // 0.01ms = 10 microseconds
        });
    });
});
