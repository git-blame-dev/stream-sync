const {
    formatSuperChatAmount,
    formatCurrencyForTTS
} = require('../../../src/utils/notification-strings');
const { interpolateTemplate } = require('../../../src/utils/notification-template-interpolator');

describe('notification-strings behavior', () => {
    it('formats superchat amounts with safe zero when amount is invalid and currency is unknown', () => {
        const formatted = formatSuperChatAmount('not-a-number', 'ZZZ');
        expect(formatted).toBe('ZZZ0.00');
    });

    it('formats currency for TTS with safe zero output on invalid amount', () => {
        const formatted = formatCurrencyForTTS('oops', '€');
        expect(formatted).toBe('0');
    });

    it('throws when required template data is missing', () => {
        const build = () => interpolateTemplate('Gift {giftType} {formattedGiftCountForDisplay}', {});
        expect(build).toThrow('Missing template value');
    });
});
