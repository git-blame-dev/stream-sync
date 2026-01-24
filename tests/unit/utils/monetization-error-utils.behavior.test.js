describe('monetization error payload no-fallback behavior', () => {
    it('omits username when not provided', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'platform:gift',
            platform: 'twitch',
            timestamp: '2024-01-01T00:00:00.000Z',
            giftType: 'bits',
            giftCount: 1,
            amount: 5,
            currency: 'bits'
        });

        expect(payload).not.toHaveProperty('username');
        expect(payload).not.toHaveProperty('userId');
        expect(payload.isError).toBe(true);
    });

    it('includes username when provided', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'platform:gift',
            platform: 'twitch',
            timestamp: '2024-01-01T00:00:00.000Z',
            username: 'TestUser',
            userId: '123',
            giftType: 'bits',
            giftCount: 1,
            amount: 5,
            currency: 'bits'
        });

        expect(payload.username).toBe('TestUser');
        expect(payload.userId).toBe('123');
        expect(payload.isError).toBe(true);
    });

    it('omits gift fields when not provided', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'platform:gift',
            platform: 'twitch',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(payload).not.toHaveProperty('giftType');
        expect(payload).not.toHaveProperty('giftCount');
        expect(payload).not.toHaveProperty('amount');
        expect(payload).not.toHaveProperty('currency');
    });

    it('requires a timestamp when building error payloads', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        expect(() => createMonetizationErrorPayload({
            notificationType: 'platform:gift',
            platform: 'twitch'
        })).toThrow('Monetization error payload requires ISO timestamp');
    });

    it('includes timestamp when provided', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'platform:gift',
            platform: 'twitch',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(payload.timestamp).toBe('2024-01-01T00:00:00.000Z');
    });

    it('omits zero gift values for gift error payloads', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'platform:gift',
            platform: 'twitch',
            timestamp: '2024-01-01T00:00:00.000Z',
            giftType: 'bits',
            giftCount: 0,
            amount: 0,
            currency: 'bits'
        });

        expect(payload.giftType).toBe('bits');
        expect(payload.currency).toBe('bits');
        expect(payload).not.toHaveProperty('giftCount');
        expect(payload).not.toHaveProperty('amount');
    });

    it('omits zero giftCount for giftpaypiggy error payloads', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'platform:giftpaypiggy',
            platform: 'twitch',
            timestamp: '2024-01-01T00:00:00.000Z',
            giftCount: 0,
            tier: '1000'
        });

        expect(payload).not.toHaveProperty('giftCount');
    });

    it('omits zero months for paypiggy error payloads', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'platform:paypiggy',
            platform: 'youtube',
            timestamp: '2024-01-01T00:00:00.000Z',
            months: 0
        });

        expect(payload).not.toHaveProperty('months');
    });

    it('rejects object userIds instead of stringifying to [object Object]', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'platform:gift',
            platform: 'twitch',
            timestamp: '2024-01-01T00:00:00.000Z',
            userId: { invalid: 'object' }
        });

        expect(payload).not.toHaveProperty('userId');
    });

    it('rejects boolean values for numeric fields', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'platform:gift',
            platform: 'twitch',
            timestamp: '2024-01-01T00:00:00.000Z',
            giftCount: true,
            amount: true
        });

        expect(payload).not.toHaveProperty('giftCount');
        expect(payload).not.toHaveProperty('amount');
    });

    it('throws for whitespace-only platform', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        expect(() => createMonetizationErrorPayload({
            notificationType: 'platform:gift',
            platform: '   ',
            timestamp: '2024-01-01T00:00:00.000Z'
        })).toThrow('Monetization error payload requires platform');
    });

    it('includes tier for Twitch regardless of casing', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'platform:giftpaypiggy',
            platform: 'Twitch',
            timestamp: '2024-01-01T00:00:00.000Z',
            tier: '2000'
        });

        expect(payload.tier).toBe('2000');
    });

    it('handles gift fields for notification type regardless of casing', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'PLATFORM:GIFT',
            platform: 'tiktok',
            timestamp: '2024-01-01T00:00:00.000Z',
            giftType: 'rose',
            giftCount: 5
        });

        expect(payload.giftType).toBe('rose');
        expect(payload.giftCount).toBe(5);
    });
});
