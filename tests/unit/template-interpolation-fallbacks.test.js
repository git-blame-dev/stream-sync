const { initializeTestLogging } = require('../helpers/test-setup');
initializeTestLogging();
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Template Interpolation Fallbacks', () => {
    let interpolateTemplate;
    let createNotificationData;

    beforeEach(() => {
        const notificationStrings = require('../../src/utils/notification-strings');
        const testUtils = require('../helpers/notification-test-utils');
        interpolateTemplate = notificationStrings.interpolateTemplate;
        createNotificationData = testUtils.createNotificationData;
    });

    describe('when template data is missing required fields', () => {
        describe('and username is missing', () => {
            it('should throw when required template values are missing', () => {
                const template = '{username} sent {giftType}';
                const incompleteData = {
                    giftType: 'Rose'
                };

                const build = () => interpolateTemplate(template, incompleteData);

                expect(build).toThrow('Missing template value');
            });
        });

        describe('and gift type is missing', () => {
            it('should throw when required template values are missing', () => {
                const template = '{username} sent {giftType}';
                const incompleteData = {
                    username: 'TestUser'
                };

                const build = () => interpolateTemplate(template, incompleteData);

                expect(build).toThrow('Missing template value');
            });
        });

        describe('and amount/currency fields are missing', () => {
            it('should throw when required template values are missing', () => {
                const template = '{username} sent {formattedAmount}: {message}';
                const incompleteData = {
                    username: 'SuperChatUser',
                    message: 'Great stream!'
                };

                const build = () => interpolateTemplate(template, incompleteData);

                expect(build).toThrow('Missing template value');
            });
        });

        describe('and all fields are missing', () => {
            it('should throw when required template values are missing', () => {
                const template = '{username} sent {giftType} x {giftCount}';
                const emptyData = {};

                const build = () => interpolateTemplate(template, emptyData);

                expect(build).toThrow('Missing template value');
            });
        });
    });

    describe('when createNotificationData has missing fields', () => {
        describe('and YouTube SuperChat data is incomplete', () => {
            it('should throw when required gift fields are missing', () => {
                const incompleteUserData = {
                    username: 'FallbackUser',
                    userId: 'UC123456789'
                };
                const incompleteEventData = {
                    type: 'platform:gift',
                    giftType: 'Super Chat',
                    giftCount: 1,
                    message: 'Love your content!'
                };

                const build = () => createNotificationData(
                    'platform:gift',
                    'youtube',
                    incompleteUserData,
                    incompleteEventData,
                    null
                );

                expect(build).toThrow();
            });
        });

        describe('and Twitch gift subscription data is incomplete', () => {
            it('should throw when required giftpaypiggy fields are missing', () => {
                const incompleteUserData = {
                    username: 'TestGifter'
                };
                const incompleteEventData = {
                    type: 'platform:giftpaypiggy'
                };

                const build = () => createNotificationData(
                    'platform:giftpaypiggy',
                    'twitch',
                    incompleteUserData,
                    incompleteEventData,
                    null
                );

                expect(build).toThrow();
            });
        });

        describe('and TikTok gift data is incomplete', () => {
            it('should throw when required gift fields are missing', () => {
                const incompleteUserData = {
                    username: 'TikTokUser'
                };
                const incompleteEventData = {
                    type: 'platform:gift'
                };

                const build = () => createNotificationData(
                    'platform:gift',
                    'tiktok',
                    incompleteUserData,
                    incompleteEventData,
                    null
                );

                expect(build).toThrow();
            });
        });
    });
});
