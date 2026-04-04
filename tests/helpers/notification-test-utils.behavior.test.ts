const { describe, it, expect } = require('bun:test');

const {
    createNotificationData,
    generateLogMessage,
    generateNotificationString,
    testNotificationGeneration,
    testGiftNotification,
    testCommandNotification,
    testFollowNotification,
    testSubscriptionNotification,
    testTemplateInterpolation,
    createNotificationTestSuite,
    testUsernameSanitization,
    interpolateTemplate
} = require('./notification-test-utils');

createNotificationTestSuite('platform:follow', [
    {
        description: 'supports generated suite behavior for helper contracts',
        userData: { username: 'test-suite-user' },
        eventData: {},
        expectedPatterns: {
            display: /test-suite-user/,
            tts: /test-suite-user/,
            log: /test-suite-user/
        },
        additionalAssertions: (result) => {
            expect(result.type).toBe('platform:follow');
        }
    }
]);

describe('notification-test-utils behavior', () => {
    it('validates required notification data inputs', () => {
        expect(() => createNotificationData('', 'tiktok', { username: 'test-user' }))
            .toThrow('type is required for notification test data');
        expect(() => createNotificationData('platform:follow', '', { username: 'test-user' }))
            .toThrow('platform is required for notification test data');
        expect(() => createNotificationData('platform:follow', 'tiktok', { username: '' }))
            .toThrow('username is required for notification test data');
    });

    it('builds notification payloads and preserves unknown-type fallbacks', () => {
        const notification = createNotificationData(
            'platform:follow',
            'tiktok',
            { username: 'test-user', userId: 'test-user-id' },
            {},
            { effectName: 'test-effect' }
        );

        expect(notification.username).toBe('test-user');
        expect(notification.vfxConfig.effectName).toBe('test-effect');

        const unknownType = createNotificationData('platform:invalid', 'tiktok', { username: 'test-user' });
        expect(unknownType.type).toBe('platform:invalid');
        expect(typeof unknownType.logMessage).toBe('string');
    });

    it('generates log and string variants with required input validation', () => {
        expect(() => generateLogMessage('', { platform: 'tiktok', username: 'test-user' }))
            .toThrow('type is required for notification log message');
        expect(() => generateLogMessage('platform:follow', { platform: '', username: 'test-user' }))
            .toThrow('platform is required for notification log message');
        expect(() => generateLogMessage('platform:follow', { platform: 'tiktok', username: '' }))
            .toThrow('username is required for notification log message');

        const logMessage = generateLogMessage('platform:follow', {
            platform: 'tiktok',
            username: 'test-user',
            userId: 'test-user-id'
        });
        expect(typeof logMessage).toBe('string');
        expect(logMessage.length).toBeGreaterThan(0);

        const data = {
            type: 'platform:follow',
            platform: 'tiktok',
            username: 'test-user',
            userId: 'test-user-id'
        };
        expect(generateNotificationString(data, 'display')).toContain('test-user');
        expect(generateNotificationString(data, 'tts')).toContain('test-user');
        expect(generateNotificationString(data, 'log')).toContain('test-user');
        expect(generateNotificationString(data, 'unknown')).toContain('test-user');

        expect(() => generateNotificationString({ platform: 'tiktok', username: 'test-user' }, 'display'))
            .toThrow('type is required for notification string');
    });

    it('exercises notification helper wrappers across supported scenarios', () => {
        const generic = testNotificationGeneration(
            'platform:follow',
            { username: 'test-user' },
            {},
            { display: /test-user/ }
        );
        expect(generic.platform).toBe('tiktok');

        const gift = testGiftNotification(
            { giftType: 'Rose', giftName: 'test-gift', giftCount: 1, quantity: 1, amount: 1, currency: 'coins', totalValue: 1 },
            { display: /TestUser/i }
        );
        expect(gift.type).toBe('platform:gift');

        const command = testCommandNotification('!test', 'test', 'test-user');
        expect(command.displayMessage).toContain('!test');

        const follow = testFollowNotification('test-user');
        expect(follow.type).toBe('platform:follow');

        const newSub = testSubscriptionNotification(
            { username: 'test-user' },
            { amount: 5, totalMonths: 1 },
            'new'
        );

        expect(newSub.type).toBe('platform:paypiggy');
    });

    it('supports template interpolation helpers and username sanitization', () => {
        expect(testTemplateInterpolation('Hello {username}', { username: 'test-user' }, 'Hello test-user'))
            .toBe('Hello test-user');
        expect(interpolateTemplate('Amount {amount}', { amount: 10 })).toBe('Amount 10');

        const sanitized = testUsernameSanitization(' test-user ', 'test-user', 'test-user');
        expect(sanitized.displayMessage).toContain('test-user');
    });
});
