const { describe, test, expect } = require('bun:test');
const NotificationBuilder = require('../../src/utils/notification-builder');
const { generateLogMessage, createNotificationData } = require('../helpers/notification-test-utils');

describe('Greeting Notification Console Output', () => {
    test('generates console log text for greeting notifications using NotificationBuilder output', () => {
        const greetingData = NotificationBuilder.build({
            type: 'greeting',
            platform: 'twitch',
            username: 'UserF'
        });

        const logMessage = generateLogMessage('greeting', greetingData);

        expect(logMessage).toBe('Greeting: UserF');
    });

    test('uses builder-provided username to ensure log output never emits "undefined"', () => {
        const greetingData = createNotificationData('greeting', 'twitch', { username: 'FirstTimeChatter' });

        expect(greetingData.username).toBe('FirstTimeChatter');

        const logMessage = generateLogMessage('greeting', greetingData);
        expect(logMessage).toBe('Greeting: FirstTimeChatter');
    });
});
