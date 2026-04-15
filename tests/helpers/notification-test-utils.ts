import { NotificationBuilder } from '../../src/utils/notification-builder';
import { interpolateTemplate } from '../../src/utils/notification-template-interpolator';

import { initializeTestLogging } from './test-setup';

initializeTestLogging();

function createNotificationData(type, platform, userData, eventData = {}, vfxConfig = null) {
    if (!type || typeof type !== 'string' || !type.trim()) {
        throw new Error('type is required for notification test data');
    }

    if (!platform || typeof platform !== 'string' || !platform.trim()) {
        throw new Error('platform is required for notification test data');
    }

    if (!userData || typeof userData.username !== 'string' || !userData.username.trim()) {
        throw new Error('username is required for notification test data');
    }

    const username = userData.username.trim();
    const userId = userData.userId;
    const normalizedEventData = { ...eventData };

    const result = NotificationBuilder.build({
        type,
        platform,
        username,
        userId,
        ...normalizedEventData
    });

    if (!result) {
        throw new Error(`NotificationBuilder returned null for type ${type} (payload rejected)`);
    }

    result.vfxConfig = vfxConfig;

    return result;
}

function generateLogMessage(type, data) {
    if (!type || typeof type !== 'string' || !type.trim()) {
        throw new Error('type is required for notification log message');
    }

    if (!data || typeof data.platform !== 'string' || !data.platform.trim()) {
        throw new Error('platform is required for notification log message');
    }

    if (!data || typeof data.username !== 'string' || !data.username.trim()) {
        throw new Error('username is required for notification log message');
    }

    const result = NotificationBuilder.build({
        type,
        platform: data.platform,
        username: data.username,
        userId: data.userId,
        ...data
    });

    return result.logMessage;
}

function generateNotificationString(data, variant) {
    if (!data || typeof data.type !== 'string' || !data.type.trim()) {
        throw new Error('type is required for notification string');
    }

    if (!data || typeof data.platform !== 'string' || !data.platform.trim()) {
        throw new Error('platform is required for notification string');
    }

    if (!data || typeof data.username !== 'string' || !data.username.trim()) {
        throw new Error('username is required for notification string');
    }

    const result = NotificationBuilder.build({
        type: data.type,
        platform: data.platform,
        username: data.username,
        userId: data.userId,
        ...data
    });

    switch (variant) {
        case 'display':
            return result.displayMessage;
        case 'tts':
            return result.ttsMessage;
        case 'log':
            return result.logMessage;
        default:
            return result.displayMessage;
    }
}

const testNotificationGeneration = (type, userData, eventData, expectedPatterns) => {
    const notification = createNotificationData(type, 'tiktok', userData, eventData);
    
    expect(notification).toHaveProperty('displayMessage');
    expect(notification).toHaveProperty('ttsMessage');
    expect(notification).toHaveProperty('logMessage');
    expect(notification.type).toBe(type);
    expect(notification.platform).toBe('tiktok');
    
    if (expectedPatterns.display) {
        expect(notification.displayMessage).toMatch(expectedPatterns.display);
    }
    if (expectedPatterns.tts) {
        expect(notification.ttsMessage).toMatch(expectedPatterns.tts);
    }
    if (expectedPatterns.log) {
        expect(notification.logMessage).toMatch(expectedPatterns.log);
    }
    
    return notification;
};

const testGiftNotification = (giftData, expectations) => {
    return testNotificationGeneration('platform:gift', 
        { username: 'TestUser' }, 
        giftData, 
        expectations
    );
};

const testCommandNotification = (command, expectedCommandName, username = 'TestUser') => {
    const commandData = createNotificationData('command', 'tiktok', 
        { username }, 
        { command, commandName: expectedCommandName }
    );
    
    expect(commandData.displayMessage).toBe(`${username} used command ${command}`);
    expect(commandData.ttsMessage).toBe(`${username} used command ${expectedCommandName}`);
    expect(commandData.logMessage).toBe(`Command ${command} triggered by ${username}`);
    
    return commandData;
};

const testFollowNotification = (username = 'TestUser') => {
    return testNotificationGeneration('platform:follow',
        { username },
        {},
        {
            display: new RegExp(`${username} just followed`),
            tts: new RegExp(`${username} just followed`),
            log: new RegExp(`New follower: ${username}`)
        }
    );
};

const testSubscriptionNotification = (userData, subData, expectedType = 'new') => {
    const notification = testNotificationGeneration('platform:paypiggy', userData, subData, {});
    
    switch (expectedType) {
        case 'new':
            expect(notification.displayMessage).toMatch(/just subscribed/);
            break;
        case 'resub':
            expect(notification.displayMessage).toMatch(/renewed subscription/);
            break;
        case 'gift':
            expect(notification.displayMessage).toMatch(/gifted/);
            break;
    }
    
    return notification;
};

const testTemplateInterpolation = (template, data, expected) => {
    const result = interpolateTemplate(template, data);
    expect(result).toBe(expected);
    return result;
};

const createNotificationTestSuite = (notificationType, testCases) => {
    describe(`${notificationType.charAt(0).toUpperCase() + notificationType.slice(1)} Notifications`, () => {
        testCases.forEach(testCase => {
            test(testCase.description, () => {
                const result = testNotificationGeneration(
                    notificationType,
                    testCase.userData || { username: 'TestUser' },
                    testCase.eventData || {},
                    testCase.expectedPatterns || {}
                );
                
                if (testCase.additionalAssertions) {
                    testCase.additionalAssertions(result);
                }
            });
        });
    });
};

const testUsernameSanitization = (rawUsername, expectedDisplay, expectedTTS) => {
    const notification = createNotificationData('platform:follow', 'tiktok', 
        { username: rawUsername },
        {}
    );
    
    expect(notification.displayMessage).toContain(expectedDisplay);
    expect(notification.ttsMessage).toContain(expectedTTS);
    
    return notification;
};

export {
    testNotificationGeneration,
    testGiftNotification,
    testCommandNotification,
    testFollowNotification,
    testSubscriptionNotification,
    testTemplateInterpolation,
    createNotificationTestSuite,
    testUsernameSanitization,
    createNotificationData,
    generateLogMessage,
    generateNotificationString,
    interpolateTemplate
};
