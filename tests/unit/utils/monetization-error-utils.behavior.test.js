describe('monetization error payload no-fallback behavior', () => {
    it('omits username when not provided', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'gift',
            platform: 'twitch',
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
            notificationType: 'gift',
            platform: 'twitch',
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
            notificationType: 'gift',
            platform: 'twitch'
        });

        expect(payload).not.toHaveProperty('giftType');
        expect(payload).not.toHaveProperty('giftCount');
        expect(payload).not.toHaveProperty('amount');
        expect(payload).not.toHaveProperty('currency');
    });

    it('omits timestamp when not provided', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'gift',
            platform: 'twitch'
        });

        expect(payload).not.toHaveProperty('timestamp');
    });

    it('includes timestamp when provided', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'gift',
            platform: 'twitch',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(payload.timestamp).toBe('2024-01-01T00:00:00.000Z');
    });

    it('omits zero gift values for gift error payloads', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'gift',
            platform: 'twitch',
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
            notificationType: 'giftpaypiggy',
            platform: 'twitch',
            giftCount: 0,
            tier: '1000'
        });

        expect(payload).not.toHaveProperty('giftCount');
    });

    it('omits zero months for paypiggy error payloads', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'paypiggy',
            platform: 'youtube',
            months: 0
        });

        expect(payload).not.toHaveProperty('months');
    });
});
