const { describe, it, expect } = require('bun:test');
const { createSyntheticGiftFromAggregated } = require('../../../src/notifications/aggregated-donation-transformer');

describe('createSyntheticGiftFromAggregated', () => {
    it('creates synthetic gift with isAggregated flag', () => {
        const result = createSyntheticGiftFromAggregated({
            userId: 'testUser123',
            username: 'testDonor',
            giftTypes: ['Rose'],
            totalGifts: 5,
            totalCoins: 100,
            message: 'Thanks!'
        });

        expect(result.isAggregated).toBe(true);
    });

    it('preserves userId and username', () => {
        const result = createSyntheticGiftFromAggregated({
            userId: 'testId',
            username: 'testName',
            giftTypes: [],
            totalGifts: 0,
            totalCoins: 0
        });

        expect(result.userId).toBe('testId');
        expect(result.username).toBe('testName');
    });

    it('formats multiple gift types in giftType string', () => {
        const result = createSyntheticGiftFromAggregated({
            userId: 'test',
            username: 'test',
            giftTypes: ['Rose', 'Heart', 'Star'],
            totalGifts: 10,
            totalCoins: 500
        });

        expect(result.giftType).toBe('Multiple Gifts (Rose, Heart, Star)');
    });

    it('maps totalGifts to giftCount', () => {
        const result = createSyntheticGiftFromAggregated({
            userId: 'test',
            username: 'test',
            giftTypes: ['Rose'],
            totalGifts: 15,
            totalCoins: 300
        });

        expect(result.giftCount).toBe(15);
    });

    it('maps totalCoins to amount with coins currency', () => {
        const result = createSyntheticGiftFromAggregated({
            userId: 'test',
            username: 'test',
            giftTypes: ['Rose'],
            totalGifts: 5,
            totalCoins: 250
        });

        expect(result.amount).toBe(250);
        expect(result.currency).toBe('coins');
    });

    it('preserves message', () => {
        const result = createSyntheticGiftFromAggregated({
            userId: 'test',
            username: 'test',
            giftTypes: [],
            totalGifts: 0,
            totalCoins: 0,
            message: 'Test message!'
        });

        expect(result.message).toBe('Test message!');
    });

    it('handles empty giftTypes array', () => {
        const result = createSyntheticGiftFromAggregated({
            userId: 'test',
            username: 'test',
            giftTypes: [],
            totalGifts: 0,
            totalCoins: 0
        });

        expect(result.giftType).toBe('Multiple Gifts ()');
    });

    it('handles single gift type', () => {
        const result = createSyntheticGiftFromAggregated({
            userId: 'test',
            username: 'test',
            giftTypes: ['Diamond'],
            totalGifts: 1,
            totalCoins: 1000
        });

        expect(result.giftType).toBe('Multiple Gifts (Diamond)');
    });
});
