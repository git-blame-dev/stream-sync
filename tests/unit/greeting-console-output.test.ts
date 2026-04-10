import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

type NotificationPayload = Record<string, unknown> & {
    type?: string;
    platform?: string;
    username?: string;
};

type NotificationRecord = NotificationPayload & {
    username: string;
};

const NotificationBuilder = nodeRequire('../../src/utils/notification-builder.js') as {
    build: (input: NotificationPayload) => NotificationRecord | null;
};
const { generateLogMessage, createNotificationData } = nodeRequire('../helpers/notification-test-utils') as {
    generateLogMessage: (type: string, data: NotificationRecord) => string;
    createNotificationData: (
        type: string,
        platform: string,
        userData: Record<string, unknown>,
        eventData?: Record<string, unknown>
    ) => NotificationRecord;
};

describe('Greeting Notification Console Output', () => {
    test('generates console log text for greeting notifications using NotificationBuilder output', () => {
        const greetingData = NotificationBuilder.build({
            type: 'greeting',
            platform: 'twitch',
            username: 'UserF'
        });

        if (!greetingData) {
            throw new Error('Expected greeting notification payload');
        }

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
