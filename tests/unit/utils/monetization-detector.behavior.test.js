const MonetizationDetector = require('../../../src/utils/monetization-detector');

describe('monetization-detector behavior', () => {
    beforeEach(() => {
        MonetizationDetector.resetMetrics();
    });

    afterEach(() => {
        MonetizationDetector.resetMetrics();
    });

    test('detects twitch bits and tracks detection metrics', () => {
        const result = MonetizationDetector.detectMonetization(
            { message: 'Cheer100 ShowLove50 Cheer0' },
            'twitch'
        );

        expect(result.detected).toBe(true);
        expect(result.type).toBe('twitch_bits');
        expect(result.details.totalBits).toBe(150);
        expect(result.details.cheermoteCount).toBe(2);

        const metrics = MonetizationDetector.getMetrics();
        expect(metrics.totalDetections).toBe(1);
        expect(metrics.detectionsByType.twitch_bits).toBe(1);
    });

    test('returns none for unsupported platforms while still recording the attempt', () => {
        const result = MonetizationDetector.detectMonetization(
            { message: 'hello world' },
            'unknown'
        );

        expect(result.detected).toBe(false);

        const metrics = MonetizationDetector.getMetrics();
        expect(metrics.totalDetections).toBe(1);
        expect(metrics.detectionsByType.twitch_bits).toBeUndefined();
    });

    test('handles invalid payloads gracefully without mutating metrics', () => {
        const result = MonetizationDetector.detectMonetization(null, null);

        expect(result.detected).toBe(false);
        expect(result.error).toBe('messageData must be a valid object');

        const metrics = MonetizationDetector.getMetrics();
        expect(metrics.totalDetections).toBe(0);
    });

    test('detects youtube superchat when amount and currency are present', () => {
        const result = MonetizationDetector.detectMonetization(
            { amount: 5, currency: 'USD' },
            'youtube'
        );

        expect(result.detected).toBe(true);
        expect(result.type).toBe('youtube_superchat');
        expect(result.details.amount).toBe(5);
        expect(result.details.currency).toBe('USD');
        expect(result.details.hasValidAmount).toBe(true);
    });

    test('requires amount and currency for youtube superchat detection', () => {
        const result = MonetizationDetector.detectMonetization(
            { amount: '5.00' },
            'youtube'
        );

        expect(result.detected).toBe(false);
        expect(result.error).toBe('YouTube SuperChat detection requires amount and currency');
    });

    test('detects tiktok gifts only when gift data is complete', () => {
        const result = MonetizationDetector.detectMonetization(
            { giftType: 'rose', giftCount: 2, amount: 3, currency: 'coins' },
            'tiktok'
        );

        expect(result.detected).toBe(true);
        expect(result.type).toBe('tiktok_gift');
        expect(result.details.giftCount).toBe(2);
        expect(result.details.giftType).toBe('rose');
        expect(result.details.amount).toBe(3);
        expect(result.details.totalValue).toBe(3);
        expect(result.details.currency).toBe('coins');
    });

    test('detects tiktok gifts with numeric-string giftCount and amount', () => {
        const result = MonetizationDetector.detectMonetization(
            { giftType: 'rose', giftCount: '5', amount: '10', currency: 'coins' },
            'tiktok'
        );

        expect(result.detected).toBe(true);
        expect(result.type).toBe('tiktok_gift');
        expect(result.details.giftCount).toBe(5);
        expect(result.details.amount).toBe(10);
    });
});
