const { describe, it, expect } = require('bun:test');
const {
    formatCoins,
    formatGiftCount,
    formatViewerCount,
    formatMonths,
    interpolateTemplate,
    formatSuperChatAmount,
    formatCurrencyForTTS,
    getCurrencyWord,
    NOTIFICATION_TEMPLATES
} = require('../../../src/utils/notification-strings');

describe('notification-strings formatting functions', () => {
    describe('formatCoins', () => {
        it('returns "0 coins" for zero', () => {
            expect(formatCoins(0)).toBe('0 coins');
        });

        it('returns "1 coin" for singular', () => {
            expect(formatCoins(1)).toBe('1 coin');
        });

        it('returns plural form for multiple coins', () => {
            expect(formatCoins(5)).toBe('5 coins');
            expect(formatCoins(100)).toBe('100 coins');
        });

        it('returns "0 coins" for null', () => {
            expect(formatCoins(null)).toBe('0 coins');
        });

        it('returns "0 coins" for undefined', () => {
            expect(formatCoins(undefined)).toBe('0 coins');
        });

        it('returns "0 coins" for NaN', () => {
            expect(formatCoins(NaN)).toBe('0 coins');
        });

        it('returns "0 coins" for Infinity', () => {
            expect(formatCoins(Infinity)).toBe('0 coins');
        });

        it('floors decimal values', () => {
            expect(formatCoins(2.9)).toBe('2 coins');
        });

        it('treats negative values as zero', () => {
            expect(formatCoins(-5)).toBe('0 coins');
        });
    });

    describe('formatGiftCount', () => {
        it('returns plural with zero count', () => {
            expect(formatGiftCount(0, 'Rose')).toBe('0 roses');
        });

        it('returns singular for count of 1', () => {
            expect(formatGiftCount(1, 'Rose')).toBe('1 rose');
        });

        it('returns singular for numeric string "1"', () => {
            expect(formatGiftCount('1', 'Rose')).toBe('1 rose');
        });

        it('returns plural for numeric string "5"', () => {
            expect(formatGiftCount('5', 'Rose')).toBe('5 roses');
        });

        it('returns plural for multiple', () => {
            expect(formatGiftCount(5, 'Rose')).toBe('5 roses');
        });

        it('handles "Bits" specially - singular', () => {
            expect(formatGiftCount(1, 'Bits')).toBe('1 bit');
        });

        it('handles "Bits" specially - plural', () => {
            expect(formatGiftCount(100, 'Bits')).toBe('100 bits');
        });

        it('handles cheermote types like "ShowLove Bits" - singular', () => {
            expect(formatGiftCount(1, 'ShowLove Bits')).toBe('1 ShowLove bit');
        });

        it('handles cheermote types like "ShowLove Bits" - plural', () => {
            expect(formatGiftCount(50, 'ShowLove Bits')).toBe('50 ShowLove bits');
        });

        it('handles cheermote types case-insensitively', () => {
            expect(formatGiftCount(25, 'Cheer bits')).toBe('25 Cheer bits');
        });

        it('handles gift types already ending in s', () => {
            expect(formatGiftCount(5, 'diamonds')).toBe('5 diamonds');
        });

        it('handles null count', () => {
            expect(formatGiftCount(null, 'Rose')).toBe('0 roses');
        });
    });

    describe('formatViewerCount', () => {
        it('returns "0 viewers" for zero', () => {
            expect(formatViewerCount(0)).toBe('0 viewers');
        });

        it('returns "1 viewer" for singular', () => {
            expect(formatViewerCount(1)).toBe('1 viewer');
        });

        it('returns "1 viewer" for numeric string "1"', () => {
            expect(formatViewerCount('1')).toBe('1 viewer');
        });

        it('returns plural for numeric string "500"', () => {
            expect(formatViewerCount('500')).toBe('500 viewers');
        });

        it('returns plural for multiple', () => {
            expect(formatViewerCount(500)).toBe('500 viewers');
        });

        it('handles null', () => {
            expect(formatViewerCount(null)).toBe('0 viewers');
        });

        it('handles undefined', () => {
            expect(formatViewerCount(undefined)).toBe('0 viewers');
        });
    });

    describe('formatMonths', () => {
        it('returns "0 months" for zero', () => {
            expect(formatMonths(0)).toBe('0 months');
        });

        it('returns "1 month" for singular', () => {
            expect(formatMonths(1)).toBe('1 month');
        });

        it('returns "1 month" for numeric string "1"', () => {
            expect(formatMonths('1')).toBe('1 month');
        });

        it('returns plural for numeric string "12"', () => {
            expect(formatMonths('12')).toBe('12 months');
        });

        it('returns plural for multiple', () => {
            expect(formatMonths(12)).toBe('12 months');
        });

        it('handles null', () => {
            expect(formatMonths(null)).toBe('0 months');
        });

        it('handles undefined', () => {
            expect(formatMonths(undefined)).toBe('0 months');
        });
    });

    describe('formatSuperChatAmount', () => {
        it('formats USD amounts with dollar sign', () => {
            expect(formatSuperChatAmount(5.00, 'USD')).toBe('$5.00');
        });

        it('formats EUR amounts with euro sign', () => {
            expect(formatSuperChatAmount(10.50, 'EUR')).toBe('€10.50');
        });

        it('formats GBP amounts with pound sign', () => {
            expect(formatSuperChatAmount(7.25, 'GBP')).toBe('£7.25');
        });

        it('returns zero format for zero amount', () => {
            expect(formatSuperChatAmount(0, 'USD')).toBe('$0.00');
        });

        it('uses currency code for currencies that share symbols', () => {
            expect(formatSuperChatAmount(100, 'CAD')).toBe('CAD100.00');
            expect(formatSuperChatAmount(50, 'AUD')).toBe('AUD50.00');
        });

        it('defaults to dollar sign for unknown currency', () => {
            expect(formatSuperChatAmount(25, '$')).toBe('$25.00');
        });

        it('returns zero format for null amount', () => {
            expect(formatSuperChatAmount(null, 'USD')).toBe('$0.00');
        });

        it('returns zero format for invalid string amount', () => {
            expect(formatSuperChatAmount('not-a-number', 'EUR')).toBe('€0.00');
        });
    });

    describe('formatCurrencyForTTS', () => {
        it('formats whole dollar amounts', () => {
            expect(formatCurrencyForTTS(5, 'USD')).toBe('5 dollars');
        });

        it('formats singular dollar amount', () => {
            expect(formatCurrencyForTTS(1, 'USD')).toBe('1 dollar');
        });

        it('formats amounts with cents', () => {
            expect(formatCurrencyForTTS(5.50, 'USD')).toBe('5 dollars 50');
        });

        it('formats euro amounts', () => {
            expect(formatCurrencyForTTS(10, 'EUR')).toBe('10 euros');
        });

        it('formats singular euro', () => {
            expect(formatCurrencyForTTS(1, 'EUR')).toBe('1 euro');
        });

        it('returns zero for null amount', () => {
            expect(formatCurrencyForTTS(null, 'USD')).toBe('0');
        });

        it('returns zero for invalid amount', () => {
            expect(formatCurrencyForTTS(NaN, 'USD')).toBe('0');
        });

        it('returns zero for zero amount', () => {
            expect(formatCurrencyForTTS(0, 'USD')).toBe('0');
        });
    });

    describe('getCurrencyWord', () => {
        it('returns dollars for USD', () => {
            expect(getCurrencyWord('USD')).toBe('dollars');
        });

        it('returns euros for EUR', () => {
            expect(getCurrencyWord('EUR')).toBe('euros');
        });

        it('returns yen for JPY', () => {
            expect(getCurrencyWord('JPY')).toBe('yen');
        });

        it('returns dollars for unknown currency', () => {
            expect(getCurrencyWord('XYZ')).toBe('dollars');
        });

        it('handles symbol input', () => {
            expect(getCurrencyWord('$')).toBe('dollars');
            expect(getCurrencyWord('€')).toBe('euros');
        });
    });

    describe('interpolateTemplate edge cases', () => {
        it('throws for non-string template', () => {
            expect(() => interpolateTemplate(null, {})).toThrow('Template must be a string');
            expect(() => interpolateTemplate(123, {})).toThrow('Template must be a string');
        });

        it('throws for missing template variable', () => {
            expect(() => interpolateTemplate('{missing}', {})).toThrow('Missing template value');
        });

        it('handles non-paypiggy data types without enrichment', () => {
            const result = interpolateTemplate('{username} followed', { username: 'testUser' });
            expect(result).toBe('testUser followed');
        });

        it('handles null data gracefully', () => {
            const result = interpolateTemplate('static text', null);
            expect(result).toBe('static text');
        });

        it('handles undefined data gracefully', () => {
            const result = interpolateTemplate('static text', undefined);
            expect(result).toBe('static text');
        });

        it('handles array values by using first element', () => {
            const result = interpolateTemplate('{items}', { items: ['first', 'second'] });
            expect(result).toBe('first');
        });

        it('handles empty array values as empty string', () => {
            const result = interpolateTemplate('{items}', { items: [] });
            expect(result).toBe('');
        });

        it('handles objects with name property', () => {
            const result = interpolateTemplate('{user}', { user: { name: 'TestName' } });
            expect(result).toBe('TestName');
        });

        it('handles numbers in templates', () => {
            const result = interpolateTemplate('{count} items', { count: 42 });
            expect(result).toBe('42 items');
        });

        it('handles boolean values', () => {
            const result = interpolateTemplate('{flag}', { flag: true });
            expect(result).toBe('true');
        });

        it('sanitizes template injection attempts', () => {
            const result = interpolateTemplate('{name}', { name: 'test{injection}' });
            expect(result).toBe('test');
            expect(result).not.toContain('{');
        });

        it('limits very long strings', () => {
            const longString = 'x'.repeat(2000);
            const result = interpolateTemplate('{text}', { text: longString });
            expect(result.length).toBeLessThanOrEqual(1000);
        });
    });

    describe('resolvePaypiggyCopy via interpolateTemplate', () => {
        it('uses superfan copy when tier is superfan', () => {
            const template = NOTIFICATION_TEMPLATES['platform:paypiggy'].display;
            const data = {
                type: 'platform:paypiggy',
                username: 'testUser',
                tier: 'superfan',
                platform: 'tiktok'
            };

            const result = interpolateTemplate(template, data);

            expect(result).toBe('testUser became a SuperFan!');
        });

        it('uses membership copy for youtube platform', () => {
            const template = NOTIFICATION_TEMPLATES['platform:paypiggy'].display;
            const data = {
                type: 'platform:paypiggy',
                username: 'testYoutuber',
                platform: 'youtube'
            };

            const result = interpolateTemplate(template, data);

            expect(result).toBe('testYoutuber just became a member!');
        });

        it('uses subscriber copy for default/twitch platform', () => {
            const template = NOTIFICATION_TEMPLATES['platform:paypiggy'].display;
            const data = {
                type: 'platform:paypiggy',
                username: 'testStreamer',
                platform: 'twitch'
            };

            const result = interpolateTemplate(template, data);

            expect(result).toBe('testStreamer just subscribed!');
        });

        it('uses subscriber copy when platform is missing', () => {
            const template = NOTIFICATION_TEMPLATES['platform:paypiggy'].display;
            const data = {
                type: 'platform:paypiggy',
                username: 'testUser'
            };

            const result = interpolateTemplate(template, data);

            expect(result).toBe('testUser just subscribed!');
        });

        it('uses resub copy for superfan renewal', () => {
            const template = NOTIFICATION_TEMPLATES['platform:paypiggy'].displayResub;
            const data = {
                type: 'platform:paypiggy',
                username: 'testUser',
                tier: 'superfan',
                months: 3
            };

            const result = interpolateTemplate(template, data);

            expect(result).toBe('testUser renewed SuperFan for 3 months!');
        });

        it('uses resub copy for youtube membership renewal', () => {
            const template = NOTIFICATION_TEMPLATES['platform:paypiggy'].displayResub;
            const data = {
                type: 'platform:paypiggy',
                username: 'testYoutuber',
                platform: 'youtube',
                months: 6
            };

            const result = interpolateTemplate(template, data);

            expect(result).toBe('testYoutuber renewed membership for 6 months!');
        });

        it('uses resub copy for twitch subscription renewal', () => {
            const template = NOTIFICATION_TEMPLATES['platform:paypiggy'].displayResub;
            const data = {
                type: 'platform:paypiggy',
                username: 'testStreamer',
                platform: 'twitch',
                months: 12
            };

            const result = interpolateTemplate(template, data);

            expect(result).toBe('testStreamer renewed subscription for 12 months!');
        });
    });
});
