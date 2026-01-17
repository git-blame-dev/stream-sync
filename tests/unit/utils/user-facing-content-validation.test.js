const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');
const { TEST_TIMEOUTS } = require('../../helpers/test-setup');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const { expectNoTechnicalArtifacts } = require('../../helpers/behavior-validation');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

describe('User-Facing Content Validation', () => {
    afterEach(() => {
        restoreAllModuleMocks();
    });

    let createNotificationData;

    beforeEach(() => {
        resetModules();

        const testUtils = require('../../helpers/notification-test-utils');
        createNotificationData = testUtils.createNotificationData;
    });

    describe('Template Placeholder Elimination', () => {
        const notificationTypes = ['platform:gift', 'platform:follow', 'platform:paypiggy', 'platform:raid', 'platform:envelope'];
        const platforms = ['twitch', 'youtube', 'tiktok'];

        platforms.forEach(platform => {
            notificationTypes.forEach(type => {
                test(`should not expose template placeholders in ${type} notifications on ${platform}`, () => {
                    const userData = { username: 'testuser' };
                    const eventData = getTestDataForType(type, platform);

                    const result = createNotificationData(type, platform, userData, eventData);

                    expect(result.displayMessage).not.toMatch(/\{[^}]*\}/);
                    expect(result.ttsMessage).not.toMatch(/\{[^}]*\}/);
                    expect(result.displayMessage).toContain('testuser');
                    expect(result.displayMessage.length).toBeGreaterThan(5);
                    expect(result.displayMessage).not.toContain('undefined');
                    expect(result.displayMessage).not.toContain('null');
                    expect(result.displayMessage).not.toContain('NaN');
                }, TEST_TIMEOUTS.FAST);
            });
        });
    });

    describe('Content Quality Validation', () => {
        test('should produce professional display messages', () => {
            const testCases = [
                {
                    type: 'platform:gift',
                    userData: { username: 'testuser' },
                    eventData: { giftCount: 1, giftType: 'bits', amount: 100, currency: 'bits' },
                    expectedPatterns: [/testuser/, /sent/, /bits/i]
                },
                {
                    type: 'platform:follow', 
                    userData: { username: 'newfollower' },
                    eventData: {},
                    expectedPatterns: [/newfollower/, /follow/i]
                },
                {
                    type: 'platform:paypiggy',
                    userData: { username: 'subscriber' },
                    eventData: { tier: '1000' },
                    expectedPatterns: [/subscriber/, /(subscribed|member)/i]
                }
            ];

            testCases.forEach(testCase => {
                const result = createNotificationData(
                    testCase.type,
                    'twitch',
                    testCase.userData,
                    testCase.eventData
                );

                expect(result.displayMessage).not.toMatch(/\{.*\}/);
                testCase.expectedPatterns.forEach(pattern => {
                    expect(result.displayMessage).toMatch(pattern);
                });
                expect(result.displayMessage).not.toMatch(/^\s|\s$/);
                expect(result.displayMessage).not.toMatch(/\s{2,}/);
            });
        }, TEST_TIMEOUTS.FAST);

        test('should keep gift notifications user-facing and artifact-free', () => {
            const userData = { username: 'TestUser', userId: '12345' };
            const eventData = { giftType: 'Rose', giftCount: 5, amount: 5, currency: 'coins' };

            const notificationData = createNotificationData('platform:gift', 'tiktok', userData, eventData);
            const messageText = notificationData.displayMessage || notificationData.message || '';

            expect(notificationData).toBeDefined();
            expect(messageText).toContain('TestUser');
            expect(messageText.length).toBeGreaterThan(0);
            expectNoTechnicalArtifacts(messageText);
        }, TEST_TIMEOUTS.FAST);

        test('should keep follow notifications free of deprecated markers', () => {
            const followData = { username: 'NewFollower', userId: '123' };
            const followNotification = createNotificationData('platform:follow', 'twitch', followData);
            const messageText = followNotification.displayMessage || followNotification.message || '';

            expect(followNotification).toBeDefined();
            expect(messageText.length).toBeGreaterThan(0);
            expectNoTechnicalArtifacts(messageText);
            expect(messageText).not.toContain('DEPRECATED');
            expect(messageText).not.toContain('BRIDGE');
        }, TEST_TIMEOUTS.FAST);

        test('should handle special characters in usernames gracefully', () => {
            const specialUsernames = [
                'user_with_underscores',
                'user-with-dashes', 
                'user123',
                'UPPERCASE_USER',
                'MixedCase_User-123'
            ];

            specialUsernames.forEach(username => {
                const result = createNotificationData('platform:follow', 'twitch', 
                    { username }, 
                    {}
                );

                expect(result.displayMessage).not.toMatch(/\{.*\}/);
                expect(result.displayMessage).toContain(username);
                expect(result.displayMessage).toMatch(/follow/i);
            });
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Internationalization Support', () => {
        test('should handle international usernames without exposing placeholders', () => {
            const internationalUsernames = [
                '中文用户',
                'ユーザー',
                'пользователь',
                'usuario_español',
                'émoji_user_🎮'
            ];

            internationalUsernames.forEach(username => {
                const result = createNotificationData('platform:gift', 'twitch',
                    { username },
                    { giftCount: 1, giftType: 'bits', amount: 1, currency: 'bits' }
                );

                expect(result.displayMessage).not.toMatch(/\{.*\}/);
                expect(result.ttsMessage).not.toMatch(/\{.*\}/);
                expect(result.displayMessage).toContain(username);
            });
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Edge Case Content Validation', () => {
        test('should reject missing or zero values in gift notifications', () => {
            const edgeCases = [
                { giftCount: 0, giftType: 'bits', amount: 0, currency: 'bits' },
                { giftCount: null, giftType: 'bits', amount: 1, currency: 'bits' },
                { giftCount: undefined, giftType: 'bits', amount: 1, currency: 'bits' }
            ];

            edgeCases.forEach(eventData => {
                const NotificationBuilder = require('../../../src/utils/notification-builder');
                    expect(() => NotificationBuilder.build({
                        platform: 'twitch',
                        type: 'platform:gift',
                        username: 'testuser',
                        ...eventData
                    })).toThrow();
            });
        }, TEST_TIMEOUTS.FAST);

        test('should handle very large numbers gracefully', () => {
            const result = createNotificationData('platform:gift', 'twitch',
                { username: 'bigspender' },
                { giftCount: 1, giftType: 'bits', amount: 999999, currency: 'bits' }
            );

            expect(result.displayMessage).not.toMatch(/\{.*\}/);
            expect(result.displayMessage).toContain('bigspender');
            expect(result.displayMessage).toMatch(/999,?999/);
            expect(result.displayMessage).toMatch(/bits/i);
        }, TEST_TIMEOUTS.FAST);
    });

    function getTestDataForType(type, platform) {
        switch (type) {
            case 'platform:gift':
                if (platform === 'youtube') {
                    return { giftCount: 1, giftType: 'Super Chat', amount: 5, currency: 'USD' };
                }
                if (platform === 'twitch') {
                    return { giftCount: 1, giftType: 'bits', amount: 100, currency: 'bits' };
                }
                return { giftCount: 1, giftType: 'Rose', amount: 2, currency: 'coins' };
            case 'platform:follow':
                return {};
            case 'platform:paypiggy':
                return { tier: '1000' };
            case 'platform:raid':
                return { viewerCount: 42 };
            case 'platform:envelope':
                return { coins: 42 };
            default:
                return {};
        }
    }
});
