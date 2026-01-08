describe('monetization error payload fallback username behavior', () => {
    it('uses placeholder username when username is missing', () => {
        const { createMonetizationErrorPayload } = require('../../../src/utils/monetization-error-utils');

        const payload = createMonetizationErrorPayload({
            notificationType: 'gift',
            platform: 'twitch',
            giftType: 'bits',
            giftCount: 1,
            amount: 5,
            currency: 'bits',
            userId: 'fake-user-id'
        });

        expect(payload.username).toBe('Unknown');
    });
});
