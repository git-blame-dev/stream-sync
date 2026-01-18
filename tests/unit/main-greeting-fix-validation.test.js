const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const NotificationBuilder = require('../../src/utils/notification-builder');

describe('Main.js Greeting Username Extraction Fix', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let extractUsernameFromNotificationData;
    let logNotificationToConsole;
    let mockLogger;

    beforeEach(() => {
        mockLogger = {
            console: createMockFn(),
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };

        const runtimeContext = {
            logger: mockLogger,

            extractUsernameFromNotificationData: function(data) {
                if (!data || typeof data.username !== 'string') {
                    return null;
                }

                const username = data.username.trim();
                return username ? username : null;
            },

            logNotificationToConsole: function(type, platform, data) {
                const username = this.extractUsernameFromNotificationData(data);
                if (!username) {
                    return;
                }

                let msg = '';
                switch (type) {
                    case 'follow':
                        msg = `[${platform}] New follow: ${username}`;
                        break;
                    case 'subscription':
                        msg = `[${platform}] New subscription: ${username}`;
                        break;
                    case 'membership':
                        msg = `[${platform}] New membership: ${username}`;
                        break;
                    case 'raid':
                        msg = `[${platform}] Raid from ${username} with ${data.viewerCount ?? 0} viewers!`;
                        break;
                    case 'gift':
                        msg = `[${platform}] Gift from ${username}: ${data.giftCount || 1}x ${data.giftType || 'gift'} (${data.amount ?? 0} ${data.currency || 'coins'})`;
                        break;
                    case 'redemption':
                        msg = `[${platform}] Redemption by ${username}: ${data.rewardTitle || 'Unknown Reward'} (${data.rewardCost || 0} points)`;
                        break;
                    case 'greeting':
                        msg = `[${platform}] Greeting: ${username}`;
                        break;
                    case 'farewell':
                        msg = `[${platform}] Farewell: ${username}`;
                        break;
                    default:
                        msg = `[${platform}] Notification (${type}): ${username}`;
                }
                if (this.logger && this.logger.console) {
                    this.logger.console(msg, 'notification');
                }
            }
        };

        extractUsernameFromNotificationData = runtimeContext.extractUsernameFromNotificationData.bind(runtimeContext);
        logNotificationToConsole = runtimeContext.logNotificationToConsole.bind(runtimeContext);
    });

    test('should extract username from notification data', () => {
        const greetingData = NotificationBuilder.build({
            type: 'greeting',
            platform: 'twitch',
            username: 'TestUser'
        });

        expect(greetingData).toMatchObject({
            type: 'greeting',
            platform: 'twitch',
            username: 'TestUser'
        });

        const extractedUsername = extractUsernameFromNotificationData(greetingData);

        expect(extractedUsername).toBe('TestUser');
    });

    test('should properly log greeting notification with correct username', () => {
        const greetingData = NotificationBuilder.build({
            type: 'greeting',
            platform: 'twitch',
            username: 'TestUser'
        });

        logNotificationToConsole('greeting', 'twitch', greetingData);

        expect(mockLogger.console).toHaveBeenCalledWith(
            '[twitch] Greeting: TestUser',
            'notification'
        );
    });

    test('returns null when username is missing', () => {
        expect(extractUsernameFromNotificationData({ displayName: 'AltName' })).toBeNull();
        expect(extractUsernameFromNotificationData({ name: 'AltName' })).toBeNull();
    });

    test('returns null for invalid data', () => {
        expect(extractUsernameFromNotificationData(null)).toBeNull();
        expect(extractUsernameFromNotificationData(undefined)).toBeNull();
        expect(extractUsernameFromNotificationData({})).toBeNull();
        expect(extractUsernameFromNotificationData({ user: {} })).toBeNull();
    });

    test('should fix all notification types using the same username extraction pattern', () => {
        const notificationData = NotificationBuilder.build({
            type: 'platform:follow',
            platform: 'twitch',
            username: 'TestFollower'
        });

        const notificationTypes = ['platform:follow', 'platform:paypiggy', 'platform:raid', 'platform:gift', 'redemption', 'farewell'];

        notificationTypes.forEach(type => {
            mockLogger.console.mockClear();
            logNotificationToConsole(type, 'twitch', notificationData);

            const loggedMessage = mockLogger.console.mock.calls[0][0];
            expect(loggedMessage).toContain('TestFollower');
            expect(loggedMessage).not.toContain('undefined');
        });
    });
});
