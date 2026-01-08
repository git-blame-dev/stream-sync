
const { initializeTestLogging } = require('./test-setup');

// Initialize logging for notification tests
initializeTestLogging();

const {
    formatCoins,
    formatGiftCount,
    formatViewerCount,
    formatMonths,
    interpolateTemplate,
    NOTIFICATION_TEMPLATES
} = require('../../src/utils/notification-strings');

const NotificationBuilder = require('../../src/utils/notification-builder');

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
    
    // Standard validation
    expect(notification).toHaveProperty('displayMessage');
    expect(notification).toHaveProperty('ttsMessage');
    expect(notification).toHaveProperty('logMessage');
    expect(notification.type).toBe(type);
    expect(notification.platform).toBe('tiktok');
    
    // Pattern validation
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
    return testNotificationGeneration('gift', 
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
    return testNotificationGeneration('follow',
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
    const notification = testNotificationGeneration('paypiggy', userData, subData, {});
    
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

const testFormattingFunctions = () => {
    describe('Formatting Functions', () => {
        test('formatCoins handles singular/plural correctly', () => {
            expect(formatCoins(0)).toBe('0 coins');
            expect(formatCoins(1)).toBe('1 coin');
            expect(formatCoins(5)).toBe('5 coins');
            expect(formatCoins(100)).toBe('100 coins');
        });

        test('formatGiftCount handles singular/plural correctly', () => {
            expect(formatGiftCount(1, 'Rose')).toBe('1 rose');
            expect(formatGiftCount(5, 'Rose')).toBe('5 roses');
            expect(formatGiftCount(1, 'Heart')).toBe('1 heart');
            expect(formatGiftCount(3, 'Heart')).toBe('3 hearts');
        });

        test('formatViewerCount handles singular/plural correctly', () => {
            expect(formatViewerCount(0)).toBe('0 viewers');
            expect(formatViewerCount(1)).toBe('1 viewer');
            expect(formatViewerCount(42)).toBe('42 viewers');
        });

        test('formatMonths handles singular/plural correctly', () => {
            expect(formatMonths(0)).toBe('0 months');
            expect(formatMonths(1)).toBe('1 month');
            expect(formatMonths(6)).toBe('6 months');
        });
    });
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
                
                // Run any additional assertions
                if (testCase.additionalAssertions) {
                    testCase.additionalAssertions(result);
                }
            });
        });
    });
};

const validateNotificationTemplates = () => {
    const requiredTypes = ['gift', 'follow', 'paypiggy', 'raid', 'envelope', 'greeting', 'farewell', 'command', 'redemption'];

    requiredTypes.forEach(type => {
        expect(NOTIFICATION_TEMPLATES).toHaveProperty(type);
        expect(NOTIFICATION_TEMPLATES[type]).toHaveProperty('display');
        expect(NOTIFICATION_TEMPLATES[type]).toHaveProperty('tts');
        expect(NOTIFICATION_TEMPLATES[type]).toHaveProperty('log');
    });
};

const testUsernameSanitization = (rawUsername, expectedDisplay, expectedTTS) => {
    const notification = createNotificationData('follow', 'tiktok', 
        { username: rawUsername },
        {}
    );
    
    expect(notification.displayMessage).toContain(expectedDisplay);
    expect(notification.ttsMessage).toContain(expectedTTS);
    
    return notification;
};

module.exports = {
    // Core testing functions
    testNotificationGeneration,
    testGiftNotification,
    testCommandNotification,
    testFollowNotification,
    testSubscriptionNotification,
    
    // Formatting tests
    testFormattingFunctions,
    testTemplateInterpolation,
    
    // Test suite generators
    createNotificationTestSuite,
    
    // Validation helpers
    validateNotificationTemplates,
    testUsernameSanitization,
    
    // Direct access to utilities
    createNotificationData,
    generateLogMessage,
    generateNotificationString,
    formatCoins,
    formatGiftCount,
    formatViewerCount,
    formatMonths,
    interpolateTemplate,
    NOTIFICATION_TEMPLATES
};
