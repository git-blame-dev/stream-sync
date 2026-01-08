
const { 
    initializeTestLogging,
    TEST_TIMEOUTS 
} = require('../../helpers/test-setup');

const { 
    setupAutomatedCleanup 
} = require('../../helpers/mock-lifecycle');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

describe('User-Facing Content Validation', () => {
    let createNotificationData;

    beforeEach(() => {
        jest.resetModules();
        
        // Re-initialize logging after module reset (shared reset pattern)
        const { initializeTestLogging } = require('../../helpers/test-setup');
        initializeTestLogging();
        
        const testUtils = require('../../helpers/notification-test-utils');
        createNotificationData = testUtils.createNotificationData;
    });

    describe('Template Placeholder Elimination', () => {
        const notificationTypes = ['gift', 'follow', 'paypiggy', 'raid', 'envelope'];
        const platforms = ['twitch', 'youtube', 'tiktok'];

        platforms.forEach(platform => {
            notificationTypes.forEach(type => {
                test(`should not expose template placeholders in ${type} notifications on ${platform}`, () => {
                    const userData = { username: 'testuser' };
                    const eventData = getTestDataForType(type, platform);

                    const result = createNotificationData(type, platform, userData, eventData);

                    expect(result.displayMessage).not.toMatch(/\{[^}]*\}/);
                    expect(result.ttsMessage).not.toMatch(/\{[^}]*\}/);
                    
                    // Must contain actual readable content
                    expect(result.displayMessage).toContain('testuser');
                    expect(result.displayMessage.length).toBeGreaterThan(5);
                    
                    // Should not contain technical artifacts
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
                    type: 'gift',
                    userData: { username: 'testuser' },
                    eventData: { giftCount: 1, giftType: 'bits', amount: 100, currency: 'bits' },
                    expectedPatterns: [/testuser/, /sent/, /bits/i]
                },
                {
                    type: 'follow', 
                    userData: { username: 'newfollower' },
                    eventData: {},
                    expectedPatterns: [/newfollower/, /follow/i]
                },
                {
                    type: 'paypiggy',
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

                // No template artifacts
                expect(result.displayMessage).not.toMatch(/\{.*\}/);
                
                // Contains expected content patterns
                testCase.expectedPatterns.forEach(pattern => {
                    expect(result.displayMessage).toMatch(pattern);
                });
                
                // Professional formatting
                expect(result.displayMessage).not.toMatch(/^\s|\s$/); // No leading/trailing whitespace
                expect(result.displayMessage).not.toMatch(/\s{2,}/); // No multiple spaces
            });
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
                const result = createNotificationData('follow', 'twitch', 
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
                '中文用户', // Chinese
                'ユーザー', // Japanese  
                'пользователь', // Russian
                'usuario_español', // Spanish with underscore
                'émoji_user_🎮' // With emoji
            ];

            internationalUsernames.forEach(username => {
                const result = createNotificationData('gift', 'twitch',
                    { username },
                    { giftCount: 1, giftType: 'bits', amount: 1, currency: 'bits' }
                );

                // No template placeholders regardless of username complexity
                expect(result.displayMessage).not.toMatch(/\{.*\}/);
                expect(result.ttsMessage).not.toMatch(/\{.*\}/);
                
                // Should contain the username (may be sanitized for TTS)
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
                    type: 'gift',
                    username: 'testuser',
                    ...eventData
                })).toThrow();
            });
        }, TEST_TIMEOUTS.FAST);

        test('should handle very large numbers gracefully', () => {
            const result = createNotificationData('gift', 'twitch',
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
            case 'gift':
                if (platform === 'youtube') {
                    return { giftCount: 1, giftType: 'Super Chat', amount: 5, currency: 'USD' };
                }
                if (platform === 'twitch') {
                    return { giftCount: 1, giftType: 'bits', amount: 100, currency: 'bits' };
                }
                return { giftCount: 1, giftType: 'Rose', amount: 2, currency: 'coins' };
            case 'follow':
                return {};
            case 'paypiggy':
                return { tier: '1000' };
            case 'raid':
                return { viewerCount: 42 };
            case 'envelope':
                return { coins: 42 };
            default:
                return {};
        }
    }
});
