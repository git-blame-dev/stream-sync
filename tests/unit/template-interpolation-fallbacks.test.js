
// Initialize test logging FIRST
const { initializeTestLogging } = require('../helpers/test-setup');
initializeTestLogging();
const { 
    setupAutomatedCleanup 
} = require('../helpers/mock-lifecycle');

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Template Interpolation Fallbacks', () => {
    let interpolateTemplate;
    let createNotificationData;
    
    beforeEach(() => {
        // Import functions from notification-strings and test helpers
        const notificationStrings = require('../../src/utils/notification-strings');
        const testUtils = require('../helpers/notification-test-utils');
        interpolateTemplate = notificationStrings.interpolateTemplate;
        createNotificationData = testUtils.createNotificationData;
    });

    describe('when template data is missing required fields', () => {
        describe('and username is missing', () => {
            it('should throw when required template values are missing', () => {
                // Arrange - Template with missing username data
                const template = '{username} sent {giftType}';
                const incompleteData = {
                    giftType: 'Rose'
                    // username is missing!
                };

                // Act
                const build = () => interpolateTemplate(template, incompleteData);

                // Assert - Missing template data should throw
                expect(build).toThrow('Missing template value');
            });
        });

        describe('and gift type is missing', () => {
            it('should throw when required template values are missing', () => {
                // Arrange
                const template = '{username} sent {giftType}';
                const incompleteData = {
                    username: 'TestUser'
                    // giftType is missing!
                };

                // Act
                const build = () => interpolateTemplate(template, incompleteData);

                // Assert - Missing template data should throw
                expect(build).toThrow('Missing template value');
            });
        });

        describe('and amount/currency fields are missing', () => {
            it('should throw when required template values are missing', () => {
                // Arrange - SuperChat template with missing amount data
                const template = '{username} sent {formattedAmount}: {message}';
                const incompleteData = {
                    username: 'SuperChatUser',
                    message: 'Great stream!'
                    // formattedAmount is missing!
                };

                // Act
                const build = () => interpolateTemplate(template, incompleteData);

                // Assert - Missing template data should throw
                expect(build).toThrow('Missing template value');
            });
        });

        describe('and all fields are missing', () => {
            it('should throw when required template values are missing', () => {
                // Arrange - Template with no matching data
                const template = '{username} sent {giftType} x {giftCount}';
                const emptyData = {};

                // Act
                const build = () => interpolateTemplate(template, emptyData);

                // Assert - Missing template data should throw
                expect(build).toThrow('Missing template value');
            });
        });
    });

    describe('when createNotificationData has missing fields', () => {
        describe('and YouTube SuperChat data is incomplete', () => {
            it('should throw when required gift fields are missing', () => {
                // Arrange - Incomplete YouTube SuperChat data  
                const incompleteUserData = {
                    username: 'FallbackUser',
                    userId: 'UC123456789'
                };
                const incompleteEventData = {
                    type: 'platform:gift',
                    giftType: 'Super Chat',
                    giftCount: 1,
                    message: 'Love your content!'
                    // amount and currency are missing!
                };

                // Act
                const build = () => createNotificationData(
                    'platform:gift', 
                    'youtube', 
                    incompleteUserData, 
                    incompleteEventData, 
                    null
                );

                // Assert - Missing gift data should throw
                expect(build).toThrow();
            });
        });

        describe('and Twitch gift subscription data is incomplete', () => {
            it('should throw when required giftpaypiggy fields are missing', () => {
                // Arrange - Incomplete Twitch gift sub data
                const incompleteUserData = {
                    username: 'TestGifter'
                    // other fields missing
                };
                const incompleteEventData = {
                    type: 'platform:giftpaypiggy'
                    // tier, total, giftCount all missing!
                };

                // Act
                const build = () => createNotificationData(
                    'platform:giftpaypiggy', 
                    'twitch', 
                    incompleteUserData, 
                    incompleteEventData, 
                    null
                );

                // Assert - Missing giftpaypiggy data should throw
                expect(build).toThrow();
            });
        });

        describe('and TikTok gift data is incomplete', () => {
            it('should throw when required gift fields are missing', () => {
                // Arrange - Incomplete TikTok gift data
                const incompleteUserData = {
                    username: 'TikTokUser'
                };
                const incompleteEventData = {
                    type: 'platform:gift'
                    // giftType, giftCount, amount/currency all missing!
                };

                // Act
                const build = () => createNotificationData(
                    'platform:gift', 
                    'tiktok', 
                    incompleteUserData, 
                    incompleteEventData, 
                    null
                );

                // Assert - Missing gift data should throw
                expect(build).toThrow();
            });
        });
    });
});
