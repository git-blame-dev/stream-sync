const { describe, it, expect } = require('bun:test');
const { interpolateTemplate } = require('../../../src/utils/notification-template-interpolator');

describe('interpolateTemplate', () => {
    describe('edge cases', () => {
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
            const result = interpolateTemplate('{username} {paypiggyAction}!', {
                type: 'platform:paypiggy',
                username: 'testUser',
                tier: 'superfan',
                platform: 'tiktok'
            });
            expect(result).toBe('testUser became a SuperFan!');
        });

        it('uses membership copy for youtube platform', () => {
            const result = interpolateTemplate('{username} {paypiggyAction}!', {
                type: 'platform:paypiggy',
                username: 'testYoutuber',
                platform: 'youtube'
            });
            expect(result).toBe('testYoutuber just became a member!');
        });

        it('uses subscriber copy for default/twitch platform', () => {
            const result = interpolateTemplate('{username} {paypiggyAction}!', {
                type: 'platform:paypiggy',
                username: 'testStreamer',
                platform: 'twitch'
            });
            expect(result).toBe('testStreamer just subscribed!');
        });

        it('uses subscriber copy when platform is missing', () => {
            const result = interpolateTemplate('{username} {paypiggyAction}!', {
                type: 'platform:paypiggy',
                username: 'testUser'
            });
            expect(result).toBe('testUser just subscribed!');
        });

        it('uses resub copy for superfan renewal', () => {
            const result = interpolateTemplate('{username} {paypiggyResubAction} for {months} months!', {
                type: 'platform:paypiggy',
                username: 'testUser',
                tier: 'superfan',
                months: 3
            });
            expect(result).toBe('testUser renewed SuperFan for 3 months!');
        });

        it('uses resub copy for youtube membership renewal', () => {
            const result = interpolateTemplate('{username} {paypiggyResubAction} for {months} months!', {
                type: 'platform:paypiggy',
                username: 'testYoutuber',
                platform: 'youtube',
                months: 6
            });
            expect(result).toBe('testYoutuber renewed membership for 6 months!');
        });

        it('uses resub copy for twitch subscription renewal', () => {
            const result = interpolateTemplate('{username} {paypiggyResubAction} for {months} months!', {
                type: 'platform:paypiggy',
                username: 'testStreamer',
                platform: 'twitch',
                months: 12
            });
            expect(result).toBe('testStreamer renewed subscription for 12 months!');
        });
    });
});
