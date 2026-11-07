import { describe, expect, it } from 'bun:test';
import { validateUserVisibleContent, validateGiftData, validateNotificationData, expectValidNotification, expectNoTechnicalArtifacts, expectValidUserFeedback } from './behavior-validation';

describe('behavior-validation content contracts', () => {
    it.each([NaN, Infinity, -Infinity])('rejects nonfinite gift amount %s', amount => {
        expect(() => validateGiftData({ username: 'synthetic-viewer', amount, currency: 'coins' })).toThrow();
    });

    it('validates user-visible content and input data contracts', () => {
        expect(() => validateUserVisibleContent('Thanks test-user for the gift')).not.toThrow();
        expect(() => validateUserVisibleContent(123)).toThrow('User-visible content must be a string');
        expect(() => validateUserVisibleContent('undefined')).toThrow('technical artifact');
        expect(() => validateUserVisibleContent('{username}')).toThrow('template placeholders');
        expect(() => validateUserVisibleContent('TypeError: bad call')).toThrow('JavaScript error');
        expect(() => validateUserVisibleContent('   ')).toThrow('empty or whitespace-only');

        expect(() => validateGiftData(null)).toThrow('Gift data must be an object');
        expect(() => validateGiftData({ username: 'test-user', amount: 1 })).toThrow('missing required field: currency');
        expect(() => validateGiftData({ username: '', amount: 1, currency: 'coins' })).toThrow('valid username');
        expect(() => validateGiftData({ username: 'test-user', amount: 0, currency: 'coins' })).toThrow('positive number');
        expect(() => validateGiftData({ username: 'test-user', amount: 1, currency: '' })).toThrow('non-empty string');
        expect(() => validateGiftData({ username: 'test-user', amount: 1, currency: 'coins' })).not.toThrow();

        expect(() => validateNotificationData(null)).toThrow('Notification data must be an object');
        expect(() => validateNotificationData({ type: 'platform:gift' })).toThrow('missing required field: username');
        expect(() => validateNotificationData({ type: 'invalid', username: 'test-user' })).toThrow('Invalid notification type');
        expect(() => validateNotificationData({ type: 'platform:gift', username: '  ' })).toThrow('valid username');
        expect(() => validateNotificationData({ type: 'platform:gift', username: 'test-user' })).not.toThrow();
    });

    it('validates additional user-facing helper assertions', () => {
        const notification = expectValidNotification({ displayMessage: 'Hello test-user' });
        expect(notification.displayMessage).toBe('Hello test-user');
        expect(() => expectValidNotification({})).toThrow();

        expect(expectNoTechnicalArtifacts('Clean test output')).toBe('Clean test output');
        expect(expectNoTechnicalArtifacts('')).toBeUndefined();
        expect(expectNoTechnicalArtifacts(null)).toBeUndefined();
        expect(() => expectNoTechnicalArtifacts('undefined value')).toThrow();
        expect(() => expectNoTechnicalArtifacts('function call')).toThrow();

        expect(() => expectValidUserFeedback()).toThrow('User feedback is required');
        expect(() => expectValidUserFeedback(100)).toThrow('must be a string');
        expect(() => expectValidUserFeedback('ok')).toThrow('too short to be meaningful');
        expect(() => expectValidUserFeedback('Routine acknowledgement text')).toThrow('user-relevant information');
        expect(expectValidUserFeedback('The streamer displayed a visual command success message')).toContain('visual command success');
    });
});
