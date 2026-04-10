const { describe, expect, it } = require('bun:test');
export {};
const NotificationBuilder = require('../../../src/utils/notification-builder.js');

const { NotificationPayloadBuilder } = require('../../../src/notifications/notification-payload-builder');

describe('NotificationPayloadBuilder', () => {
    it('strips internal fields and merges sourceType into metadata for non-monetization', () => {
        const payloadBuilder = new NotificationPayloadBuilder(NotificationBuilder);
        const data = {
            type: 'platform:follow',
            platform: 'tiktok',
            username: 'test-user',
            userId: 'test-user-id',
            displayName: 'Test User',
            isSuperfan: true,
            isGift: true,
            isBits: true,
            message: 'hello',
            metadata: { origin: 'custom' },
            sourceType: 'legacy'
        };

        const result = payloadBuilder.buildPayload({
            canonicalType: 'platform:follow',
            platform: 'tiktok',
            data,
            originalType: 'platform:follow',
            isMonetizationType: false
        });

        expect(result.notificationData.metadata).toEqual({ origin: 'custom', sourceType: 'legacy' });
        expect(result.notificationData.sourceType).toBe('legacy');
        expect(result.notificationData.type).toBe('platform:follow');
    });

    it('removes metadata and writes sourceType at top-level for monetization', () => {
        const payloadBuilder = new NotificationPayloadBuilder(NotificationBuilder);
        const data = {
            type: 'platform:gift',
            platform: 'tiktok',
            username: 'test-user',
            giftType: 'rose',
            giftCount: 1,
            amount: 100,
            currency: 'coins',
            metadata: { origin: 'custom' },
            sourceType: 'legacy'
        };

        const result = payloadBuilder.buildPayload({
            canonicalType: 'platform:gift',
            platform: 'tiktok',
            data,
            originalType: 'platform:gift',
            isMonetizationType: true
        });

        expect(result.notificationData.metadata).toBeUndefined();
        expect(result.notificationData.sourceType).toBe('legacy');
    });

    it('overwrites notification type with the canonical type', () => {
        const payloadBuilder = new NotificationPayloadBuilder(NotificationBuilder);
        const data = {
            type: 'platform:follow',
            platform: 'tiktok',
            username: 'test-user'
        };

        const result = payloadBuilder.buildPayload({
            canonicalType: 'platform:follow',
            platform: 'tiktok',
            data,
            originalType: 'platform:follow',
            isMonetizationType: false
        });

        expect(result.notificationData.type).toBe('platform:follow');
    });
});
