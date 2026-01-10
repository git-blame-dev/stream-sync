
// ================================================================================================
// NOTIFICATION ASSERTION HELPERS
// ================================================================================================

const testClock = require('./test-clock');

const expectValidNotification = (notification, expectedType, expectedPlatform) => {
    // Required fields for all notifications
    const requiredFields = [
        'id', 'type', 'platform', 'username', 'displayMessage',
        'ttsMessage', 'logMessage', 'processedAt', 'timestamp'
    ];
    
    // Check for missing required fields
    requiredFields.forEach(field => {
        if (!notification.hasOwnProperty(field)) {
            throw new Error(`Missing required notification field: ${field}`);
        }
        
        if (notification[field] === null || notification[field] === undefined) {
            throw new Error(`Notification field '${field}' cannot be null or undefined`);
        }
    });
    
    // Validate notification type
    if (notification.type !== expectedType) {
        throw new Error(
            `Notification type mismatch. Expected: ${expectedType}, Got: ${notification.type}`
        );
    }
    
    // Validate platform
    if (notification.platform !== expectedPlatform) {
        throw new Error(
            `Notification platform mismatch. Expected: ${expectedPlatform}, Got: ${notification.platform}`
        );
    }
    
    if (typeof notification.username !== 'string' || !notification.username.trim()) {
        throw new Error('Notification must have a valid username');
    }
    
    // Validate timestamp formats
    if (typeof notification.processedAt !== 'number') {
        throw new Error('processedAt must be a numeric timestamp');
    }
    
    if (isNaN(Date.parse(notification.timestamp))) {
        throw new Error('timestamp must be a valid ISO date string');
    }
    
    // Platform-specific validations
    validatePlatformSpecificNotification(notification, expectedType, expectedPlatform);
    
    // Validate message content is non-empty
    if (!notification.displayMessage.trim()) {
        throw new Error('displayMessage cannot be empty');
    }
    
    if (!notification.ttsMessage.trim()) {
        throw new Error('ttsMessage cannot be empty');
    }
};

const validatePlatformSpecificNotification = (notification, type, platform) => {
    if (type === 'gift') {
        if (!notification.hasOwnProperty('giftType')) {
            throw new Error('Gift notifications must have giftType field');
        }
        if (!notification.hasOwnProperty('giftCount')) {
            throw new Error('Gift notifications must have giftCount field');
        }
        if (!notification.hasOwnProperty('amount')) {
            throw new Error('Gift notifications must have amount field');
        }
        if (!notification.hasOwnProperty('currency')) {
            throw new Error('Gift notifications must have currency field');
        }
        if (typeof notification.giftType !== 'string' || !notification.giftType.trim()) {
            throw new Error('Gift type must be a non-empty string');
        }
        const giftCount = Number(notification.giftCount);
        if (!Number.isFinite(giftCount) || giftCount < 0) {
            throw new Error('Gift count must be a non-negative number');
        }
        const amount = Number(notification.amount);
        if (!Number.isFinite(amount) || amount < 0) {
            throw new Error('Gift amount must be a non-negative number');
        }
        if (typeof notification.currency !== 'string' || !notification.currency.trim()) {
            throw new Error('Gift currency must be a non-empty string');
        }
    }

    switch (platform) {
        case 'youtube':
            if (type === 'gift') {
                if (!notification.hasOwnProperty('giftType')) {
                    throw new Error('YouTube gifts must have giftType field');
                }
                if (!notification.hasOwnProperty('amount')) {
                    throw new Error('YouTube gifts must have amount field');
                }
                if (!notification.hasOwnProperty('currency')) {
                    throw new Error('YouTube gifts must have currency field');
                }
            }
            break;
            
        case 'twitch':
            if (type === 'paypiggy' || type === 'giftpaypiggy') {
                if (notification.hasOwnProperty('tier') && !['1000', '2000', '3000'].includes(notification.tier)) {
                    throw new Error('Twitch paypiggy tier must be 1000, 2000, or 3000');
                }
            }
            if (type === 'raid') {
                if (!notification.hasOwnProperty('viewerCount')) {
                    throw new Error('Twitch raid must have viewerCount field');
                }
                if (typeof notification.viewerCount !== 'number' || notification.viewerCount <= 0) {
                    throw new Error('Twitch raid viewerCount must be a positive number');
                }
            }
            break;
            
        case 'tiktok':
            if (type === 'gift') {
                if (!notification.hasOwnProperty('giftType')) {
                    throw new Error('TikTok gift must have giftType field');
                }
                if (!notification.hasOwnProperty('giftCount')) {
                    throw new Error('TikTok gift must have giftCount field');
                }
                if (typeof notification.giftCount !== 'number' || notification.giftCount < 0) {
                    throw new Error('TikTok gift count must be a non-negative number');
                }
            }
            break;
    }
};

const expectNotificationContent = (notification, patterns) => {
    Object.keys(patterns).forEach(field => {
        if (!notification.hasOwnProperty(field)) {
            throw new Error(`Notification missing expected content field: ${field}`);
        }
        
        const pattern = patterns[field];
        const content = notification[field];
        
        if (!pattern.test(content)) {
            throw new Error(
                `Notification content pattern mismatch for ${field}. ` +
                `Expected pattern: ${pattern}, Got: "${content}"`
            );
        }
    });
};

const expectNotificationTiming = (notification, expectedTiming) => {
    const now = testClock.now();
    const processedAt = notification.processedAt;
    const createdAt = notification.createdAt || processedAt;
    
    // Check processing delay
    if (expectedTiming.maxProcessingDelay) {
        const processingDelay = processedAt - createdAt;
        if (processingDelay > expectedTiming.maxProcessingDelay) {
            throw new Error(
                `Notification processing delay exceeded maximum. ` +
                `Expected: <=${expectedTiming.maxProcessingDelay}ms, Got: ${processingDelay}ms`
            );
        }
    }
    
    // Check timestamp accuracy
    if (expectedTiming.timestampTolerance) {
        const timestampMs = new Date(notification.timestamp).getTime();
        const timeDiff = Math.abs(timestampMs - processedAt);
        if (timeDiff > expectedTiming.timestampTolerance) {
            throw new Error(
                `Notification timestamp differs too much from processedAt. ` +
                `Expected difference: <=${expectedTiming.timestampTolerance}ms, Got: ${timeDiff}ms`
            );
        }
    }
    
    // Check if notification is not too old
    if (expectedTiming.maxAge) {
        const age = now - processedAt;
        if (age > expectedTiming.maxAge) {
            throw new Error(
                `Notification is too old. Maximum age: ${expectedTiming.maxAge}ms, ` +
                `Actual age: ${age}ms`
            );
        }
    }
};

const expectNotificationSequence = (notifications, expectedOrder) => {
    if (!Array.isArray(notifications) || notifications.length < 2) {
        return; // Cannot validate sequence with less than 2 items
    }
    
    switch (expectedOrder) {
        case 'priority_desc':
            for (let i = 1; i < notifications.length; i++) {
                const prev = notifications[i - 1].priority || 0;
                const curr = notifications[i].priority || 0;
                if (prev < curr) {
                    throw new Error(
                        `Notification sequence not in priority descending order at index ${i}. ` +
                        `Previous priority: ${prev}, Current priority: ${curr}`
                    );
                }
            }
            break;
            
        case 'timestamp_asc':
            for (let i = 1; i < notifications.length; i++) {
                const prev = notifications[i - 1].processedAt;
                const curr = notifications[i].processedAt;
                if (prev > curr) {
                    throw new Error(
                        `Notification sequence not in timestamp ascending order at index ${i}. ` +
                        `Previous timestamp: ${prev}, Current timestamp: ${curr}`
                    );
                }
            }
            break;
            
        case 'timestamp_desc':
            for (let i = 1; i < notifications.length; i++) {
                const prev = notifications[i - 1].processedAt;
                const curr = notifications[i].processedAt;
                if (prev < curr) {
                    throw new Error(
                        `Notification sequence not in timestamp descending order at index ${i}. ` +
                        `Previous timestamp: ${prev}, Current timestamp: ${curr}`
                    );
                }
            }
            break;
            
        default:
            throw new Error(`Unknown expected order: ${expectedOrder}`);
    }
};

// ================================================================================================
// PLATFORM-SPECIFIC ASSERTION HELPERS
// ================================================================================================

const expectYouTubeEventProcessing = (eventData, expectedOutcome) => {
    // Validate event structure
    if (!eventData.item) {
        throw new Error('YouTube event must have item property');
    }
    
    // Check event type matches expected notification type
    const eventType = eventData.item.type;
    const expectedTypes = {
        'membership': 'LiveChatMembershipItem',
        'chat': 'LiveChatTextMessage'
    };

    if (expectedOutcome.notificationType === 'gift') {
        const giftTypes = ['LiveChatPaidMessage', 'LiveChatPaidSticker'];
        if (!giftTypes.includes(eventType)) {
            throw new Error(
                `YouTube event type mismatch for gift. ` +
                `Expected: ${giftTypes.join(' or ')}, Got: ${eventType}`
            );
        }
    } else if (expectedOutcome.notificationType && expectedTypes[expectedOutcome.notificationType]) {
        const expectedEventType = expectedTypes[expectedOutcome.notificationType];
        if (eventType !== expectedEventType) {
            throw new Error(
                `YouTube event type mismatch for ${expectedOutcome.notificationType}. ` +
                `Expected: ${expectedEventType}, Got: ${eventType}`
            );
        }
    }
    
    // Validate monetary events have proper amount formatting
    if (eventType === 'LiveChatPaidMessage' || eventType === 'LiveChatPaidSticker') {
        if (!eventData.item.purchase_amount) {
            throw new Error('YouTube paid event must have purchase_amount field');
        }
        
        if (!/^[\$€£¥]?\d+\.\d{2}$/.test(eventData.item.purchase_amount)) {
            throw new Error(
                `YouTube purchase amount has invalid format: ${eventData.item.purchase_amount}`
            );
        }
    }
    
    // Validate author details
    if (!eventData.item.authorDetails) {
        throw new Error('YouTube event must have authorDetails');
    }
    
    const requiredAuthorFields = ['channelId', 'displayName'];
    requiredAuthorFields.forEach(field => {
        if (!eventData.item.authorDetails.hasOwnProperty(field)) {
            throw new Error(`YouTube event authorDetails missing field: ${field}`);
        }
    });
};

const expectTwitchEventSubHandling = (eventData, expectedCallbacks) => {
    // Validate EventSub structure
    if (!eventData.subscription) {
        throw new Error('Twitch EventSub event must have subscription property');
    }
    
    if (!eventData.event) {
        throw new Error('Twitch EventSub event must have event property');
    }
    
    if (!eventData.metadata) {
        throw new Error('Twitch EventSub event must have metadata property');
    }
    
    // Validate subscription structure
    const requiredSubFields = ['id', 'type', 'version', 'status', 'condition'];
    requiredSubFields.forEach(field => {
        if (!eventData.subscription.hasOwnProperty(field)) {
            throw new Error(`Twitch EventSub subscription missing field: ${field}`);
        }
    });
    
    // Validate metadata structure
    const requiredMetaFields = ['message_id', 'message_type', 'message_timestamp'];
    requiredMetaFields.forEach(field => {
        if (!eventData.metadata.hasOwnProperty(field)) {
            throw new Error(`Twitch EventSub metadata missing field: ${field}`);
        }
    });
    
    // Validate message type
    if (eventData.metadata.message_type !== 'notification') {
        throw new Error(
            `Twitch EventSub message_type should be 'notification', got: ${eventData.metadata.message_type}`
        );
    }
    
    // Validate event data based on subscription type
    const subType = eventData.subscription.type;
    validateTwitchEventSubEventData(eventData.event, subType);
    
    // Note: expectedCallbacks validation would typically be done against actual callback execution
    // This is a placeholder for that validation logic
    if (expectedCallbacks && !Array.isArray(expectedCallbacks)) {
        throw new Error('expectedCallbacks must be an array');
    }
};

const validateTwitchEventSubEventData = (eventData, subscriptionType) => {
    const commonFields = ['user_id', 'user_login', 'user_name', 'broadcaster_user_id', 'broadcaster_user_login', 'broadcaster_user_name'];
    
    switch (subscriptionType) {
        case 'channel.follow':
            const followFields = [...commonFields, 'followed_at'];
            followFields.forEach(field => {
                if (!eventData.hasOwnProperty(field)) {
                    throw new Error(`Twitch follow event missing field: ${field}`);
                }
            });
            break;
            
        case 'channel.subscribe':
            const subFields = [...commonFields, 'tier', 'is_gift'];
            subFields.forEach(field => {
                if (!eventData.hasOwnProperty(field)) {
                    throw new Error(`Twitch subscription event missing field: ${field}`);
                }
            });
            break;
            
        case 'channel.raid':
            const raidFields = ['from_broadcaster_user_id', 'from_broadcaster_user_login', 'from_broadcaster_user_name', 
                               'to_broadcaster_user_id', 'to_broadcaster_user_login', 'to_broadcaster_user_name', 'viewers'];
            raidFields.forEach(field => {
                if (!eventData.hasOwnProperty(field)) {
                    throw new Error(`Twitch raid event missing field: ${field}`);
                }
            });
            break;
    }
};

const expectTikTokGiftAggregation = (giftEvents, expectedAggregation) => {
    if (!Array.isArray(giftEvents)) {
        throw new Error('giftEvents must be an array');
    }
    
    if (giftEvents.length === 0) {
        if (expectedAggregation.totalGifts > 0) {
            throw new Error('Expected gifts but received empty array');
        }
        return;
    }
    
    // Calculate actual aggregation
    const actualTotal = giftEvents.reduce((sum, event) => {
        if (!event.giftCount || typeof event.giftCount !== 'number') {
            throw new Error('Each gift event must have a numeric giftCount');
        }
        return sum + event.giftCount;
    }, 0);
    
    // Validate total
    if (expectedAggregation.totalGifts !== actualTotal) {
        throw new Error(
            `Gift aggregation total mismatch. Expected: ${expectedAggregation.totalGifts}, ` +
            `Got: ${actualTotal}`
        );
    }
    
    // Validate gift type consistency
    if (expectedAggregation.giftType) {
        const giftTypes = [...new Set(giftEvents.map((event) => {
            if (!event.giftType) {
                throw new Error('Gift aggregation events require giftType');
            }
            return event.giftType;
        }))];
        if (giftTypes.length > 1) {
            if (expectedAggregation.shouldAggregate) {
                throw new Error(
                    `Expected single gift type aggregation but found multiple types: ${giftTypes.join(', ')}`
                );
            }
        } else if (giftTypes[0] !== expectedAggregation.giftType) {
            throw new Error(
                `Gift type mismatch. Expected: ${expectedAggregation.giftType}, Got: ${giftTypes[0]}`
            );
        }
    }
    
    // Validate aggregation decision
    if (expectedAggregation.hasOwnProperty('shouldAggregate')) {
        const timeWindow = 5000; // 5 seconds
        const timestamps = giftEvents.map(e => e.timestamp || testClock.now());
        const timeSpan = Math.max(...timestamps) - Math.min(...timestamps);
        const actualShouldAggregate = timeSpan <= timeWindow && giftEvents.length > 1;
        
        if (expectedAggregation.shouldAggregate !== actualShouldAggregate) {
            throw new Error(
                `Gift aggregation decision mismatch. Expected shouldAggregate: ${expectedAggregation.shouldAggregate}, ` +
                `Got: ${actualShouldAggregate} (timeSpan: ${timeSpan}ms, count: ${giftEvents.length})`
            );
        }
    }
};

const expectOBSIntegration = (obsCommands, expectedSceneChanges) => {
    if (!Array.isArray(obsCommands)) {
        throw new Error('obsCommands must be an array');
    }
    
    // Count command types
    const commandCounts = {
        textUpdates: 0,
        effectTriggers: 0,
        sceneChanges: 0,
        filterChanges: 0
    };
    
    obsCommands.forEach((command, index) => {
        if (!command.type) {
            throw new Error(`OBS command at index ${index} missing type field`);
        }
        
        switch (command.type) {
            case 'setTextSource':
                commandCounts.textUpdates++;
                if (!command.sourceName || !command.hasOwnProperty('text')) {
                    throw new Error(`OBS setTextSource command missing sourceName or text field`);
                }
                break;
                
            case 'triggerMediaSource':
                commandCounts.effectTriggers++;
                if (!command.sourceName) {
                    throw new Error(`OBS triggerMediaSource command missing sourceName field`);
                }
                break;
                
            case 'setCurrentScene':
                commandCounts.sceneChanges++;
                if (!command.sceneName) {
                    throw new Error(`OBS setCurrentScene command missing sceneName field`);
                }
                break;
                
            case 'setFilterEnabled':
                commandCounts.filterChanges++;
                if (!command.sourceName || !command.filterName || typeof command.enabled !== 'boolean') {
                    throw new Error(`OBS setFilterEnabled command missing required fields`);
                }
                break;
                
            default:
                throw new Error(`Unknown OBS command type: ${command.type}`);
        }
    });
    
    // Validate counts against expectations
    Object.keys(expectedSceneChanges).forEach(countType => {
        if (commandCounts.hasOwnProperty(countType)) {
            const expected = expectedSceneChanges[countType];
            const actual = commandCounts[countType];
            if (expected !== actual) {
                throw new Error(
                    `OBS ${countType} count mismatch. Expected: ${expected}, Got: ${actual}`
                );
            }
        }
    });
};

// ================================================================================================
// MOCK INTERACTION ASSERTION HELPERS
// ================================================================================================

const expectOnlyMethodCalled = (mockObject, methodName, expectedArgs) => {
    if (!mockObject._mockType) {
        throw new Error('Object is not a factory-created mock');
    }
    
    const mockMethod = mockObject[methodName];
    if (!jest.isMockFunction(mockMethod)) {
        throw new Error(`${methodName} is not a mock function`);
    }
    
    // Check if method was called
    if (mockMethod.mock.calls.length === 0) {
        throw new Error(`Expected ${methodName} to be called but it was not called`);
    }
    
    // Check arguments if provided
    if (expectedArgs) {
        const actualArgs = mockMethod.mock.calls[0];
        if (JSON.stringify(actualArgs) !== JSON.stringify(expectedArgs)) {
            throw new Error(
                `${methodName} called with wrong arguments. ` +
                `Expected: ${JSON.stringify(expectedArgs)}, Got: ${JSON.stringify(actualArgs)}`
            );
        }
    }
    
    // Check that no other methods were called
    const validMethods = mockObject._validMethods || [];
    const calledMethods = validMethods.filter(method => {
        return jest.isMockFunction(mockObject[method]) && mockObject[method].mock.calls.length > 0;
    });
    
    if (calledMethods.length > 1 || (calledMethods.length === 1 && calledMethods[0] !== methodName)) {
        throw new Error(
            `Unexpected method calls detected. Expected only ${methodName}, ` +
            `but these methods were called: ${calledMethods.join(', ')}`
        );
    }
};

const expectMethodCallSequence = (mockObject, expectedSequence) => {
    if (!mockObject._mockType) {
        throw new Error('Object is not a factory-created mock');
    }
    
    // Collect all method calls with timestamps
    const allCalls = [];
    const validMethods = mockObject._validMethods || [];
    
    validMethods.forEach(methodName => {
        const mockMethod = mockObject[methodName];
        if (jest.isMockFunction(mockMethod)) {
            mockMethod.mock.calls.forEach((args, callIndex) => {
                allCalls.push({
                    method: methodName,
                    callIndex: callIndex,
                    // Use invocationCallOrder for timing
                    order: mockMethod.mock.invocationCallOrder[callIndex] || allCalls.length
                });
            });
        }
    });
    
    // Sort by call order
    allCalls.sort((a, b) => a.order - b.order);
    
    // Extract method sequence
    const actualSequence = allCalls.map(call => call.method);
    
    // Validate sequence
    if (actualSequence.length !== expectedSequence.length) {
        throw new Error(
            `Method call sequence length mismatch. Expected: ${expectedSequence.length}, ` +
            `Got: ${actualSequence.length}`
        );
    }
    
    for (let i = 0; i < expectedSequence.length; i++) {
        if (actualSequence[i] !== expectedSequence[i]) {
            throw new Error(
                `Method call sequence mismatch at position ${i}. ` +
                `Expected: ${expectedSequence[i]}, Got: ${actualSequence[i]}`
            );
        }
    }
};

const expectNoUnexpectedCalls = (mockObject, allowedMethods) => {
    if (!mockObject._mockType) {
        throw new Error('Object is not a factory-created mock');
    }
    
    const validMethods = mockObject._validMethods || [];
    const calledMethods = validMethods.filter(method => {
        return jest.isMockFunction(mockObject[method]) && mockObject[method].mock.calls.length > 0;
    });
    
    const unexpectedMethods = calledMethods.filter(method => !allowedMethods.includes(method));
    
    if (unexpectedMethods.length > 0) {
        throw new Error(
            `Unexpected methods were called: ${unexpectedMethods.join(', ')}. ` +
            `Only these methods are allowed: ${allowedMethods.join(', ')}`
        );
    }
};

const expectMockCallPattern = (mockObject, pattern) => {
    if (!mockObject._mockType) {
        throw new Error('Object is not a factory-created mock');
    }
    
    Object.keys(pattern).forEach(methodName => {
        const mockMethod = mockObject[methodName];
        if (!jest.isMockFunction(mockMethod)) {
            throw new Error(`${methodName} is not a mock function`);
        }
        
        const expectedPattern = pattern[methodName];
        const actualCalls = mockMethod.mock.calls.length;
        
        if (typeof expectedPattern === 'number') {
            if (actualCalls !== expectedPattern) {
                throw new Error(
                    `${methodName} call count mismatch. Expected: ${expectedPattern}, Got: ${actualCalls}`
                );
            }
        } else if (expectedPattern.min !== undefined || expectedPattern.max !== undefined) {
            if (expectedPattern.min !== undefined && actualCalls < expectedPattern.min) {
                throw new Error(
                    `${methodName} called too few times. Minimum: ${expectedPattern.min}, Got: ${actualCalls}`
                );
            }
            if (expectedPattern.max !== undefined && actualCalls > expectedPattern.max) {
                throw new Error(
                    `${methodName} called too many times. Maximum: ${expectedPattern.max}, Got: ${actualCalls}`
                );
            }
        }
    });
};

// ================================================================================================
// DATA STRUCTURE VALIDATION HELPERS
// ================================================================================================

const expectPlatformEventStructure = (event, platform, eventType) => {
    switch (platform) {
        case 'youtube':
            if (!event.item) {
                throw new Error('YouTube event must have item property');
            }
            if (!event.item.type) {
                throw new Error('YouTube event item must have type property');
            }
            if (!event.item.authorDetails) {
                throw new Error('YouTube event item must have authorDetails property');
            }
            break;
            
        case 'tiktok':
            if (eventType === 'gift') {
                if (!event.gift) {
                    throw new Error('TikTok gift event must have gift property');
                }
                if (!event.user || !event.user.userId || !event.user.uniqueId) {
                    throw new Error('TikTok gift event must have nested userId and uniqueId properties');
                }
                if (typeof event.giftCount !== 'number') {
                    throw new Error('TikTok gift event must have numeric giftCount property');
                }
            }
            break;
            
        case 'twitch':
            if (eventType === 'follow' || eventType === 'subscribe' || eventType === 'raid') {
                if (!event.subscription) {
                    throw new Error('Twitch EventSub event must have subscription property');
                }
                if (!event.event) {
                    throw new Error('Twitch EventSub event must have event property');
                }
                if (!event.metadata) {
                    throw new Error('Twitch EventSub event must have metadata property');
                }
            }
            break;
            
        default:
            throw new Error(`Unknown platform: ${platform}`);
    }
};

const expectInternationalContentPreservation = (originalContent, processedContent) => {
    if (originalContent !== processedContent) {
        // Check if it's just whitespace normalization
        if (originalContent.trim() === processedContent.trim()) {
            return; // Acceptable whitespace normalization
        }
        
        // Check if Unicode characters were preserved
        const originalUnicodeCount = (originalContent.match(/[\u{80}-\u{10FFFF}]/gu) || []).length;
        const processedUnicodeCount = (processedContent.match(/[\u{80}-\u{10FFFF}]/gu) || []).length;
        
        if (originalUnicodeCount !== processedUnicodeCount) {
            throw new Error(
                `International content was corrupted during processing. ` +
                `Original Unicode chars: ${originalUnicodeCount}, Processed: ${processedUnicodeCount}`
            );
        }
        
        // If content differs but Unicode is preserved, check for acceptable transformations
        const lengthDiff = Math.abs(originalContent.length - processedContent.length);
        if (lengthDiff > originalContent.length * 0.1) { // More than 10% length change
            throw new Error(
                `International content was significantly altered during processing. ` +
                `Original: "${originalContent}", Processed: "${processedContent}"`
            );
        }
    }
};

const expectValidUserData = (userData) => {
    if (!userData || typeof userData !== 'object') {
        throw new Error('Invalid user data: must be an object');
    }
    
    const requiredFields = ['username'];
    requiredFields.forEach(field => {
        if (!userData.hasOwnProperty(field)) {
            throw new Error(`Invalid user data: missing required field '${field}'`);
        }
        
        if (!userData[field] || typeof userData[field] !== 'string') {
            throw new Error(`Invalid user data: field '${field}' must be a non-empty string`);
        }
    });
    
    // Optional but commonly expected fields
    if (userData.userId && typeof userData.userId !== 'string') {
        throw new Error('Invalid user data: userId must be a string if provided');
    }
    
    if (userData.platform && !['youtube', 'twitch', 'tiktok'].includes(userData.platform)) {
        throw new Error(`Invalid user data: unknown platform '${userData.platform}'`);
    }
};

const expectValidGiftData = (giftData) => {
    if (!giftData || typeof giftData !== 'object') {
        throw new Error('Invalid gift data: must be an object');
    }
    
    const requiredFields = ['giftType', 'giftCount', 'username', 'amount', 'currency'];
    requiredFields.forEach(field => {
        if (!giftData.hasOwnProperty(field)) {
            throw new Error(`Invalid gift data: missing required field '${field}'`);
        }
    });
    
    if (typeof giftData.giftType !== 'string' || !giftData.giftType.trim()) {
        throw new Error('Invalid gift data: giftType must be a non-empty string');
    }
    
    if (typeof giftData.giftCount !== 'number' || giftData.giftCount < 0) {
        throw new Error('Invalid gift data: giftCount must be a non-negative number');
    }
    
    if (typeof giftData.username !== 'string' || !giftData.username.trim()) {
        throw new Error('Invalid gift data: username must be a non-empty string');
    }

    if (typeof giftData.amount !== 'number' || giftData.amount < 0) {
        throw new Error('Invalid gift data: amount must be a non-negative number');
    }

    if (typeof giftData.currency !== 'string' || !giftData.currency.trim()) {
        throw new Error('Invalid gift data: currency must be a non-empty string');
    }
};

const expectValidStreamData = (streamData) => {
    if (!streamData || typeof streamData !== 'object') {
        throw new Error('Invalid stream data: must be an object');
    }
    
    const requiredFields = ['streamId', 'title', 'viewerCount', 'isLive', 'platform'];
    requiredFields.forEach(field => {
        if (!streamData.hasOwnProperty(field)) {
            throw new Error(`Invalid stream data: missing required field '${field}'`);
        }
    });
    
    if (typeof streamData.streamId !== 'string' || !streamData.streamId.trim()) {
        throw new Error('Invalid stream data: streamId must be a non-empty string');
    }
    
    if (typeof streamData.title !== 'string') {
        throw new Error('Invalid stream data: title must be a string');
    }
    
    if (typeof streamData.viewerCount !== 'number' || streamData.viewerCount < 0) {
        throw new Error('Invalid stream data: viewerCount must be a non-negative number');
    }
    
    if (typeof streamData.isLive !== 'boolean') {
        throw new Error('Invalid stream data: isLive must be a boolean');
    }
    
    if (!['youtube', 'twitch', 'tiktok'].includes(streamData.platform)) {
        throw new Error(`Invalid stream data: unknown platform '${streamData.platform}'`);
    }
};

// ================================================================================================
// CONTENT QUALITY VALIDATION HELPERS
// ================================================================================================

// ================================================================================================
// PHASE 5B: INTERNATIONAL CONTENT VALIDATION HELPERS
// ================================================================================================

const expectInternationalContentSupport = (content, testData) => {
    if (typeof content !== 'string') {
        throw new Error('Content must be a string');
    }
    
    if (!testData || typeof testData !== 'object') {
        throw new Error('Test data must be provided for international content validation');
    }
    
    // Unicode preservation validation
    if (testData.originalUsername) {
        if (!content.includes(testData.originalUsername)) {
            throw new Error(
                `International username not preserved. Expected "${testData.originalUsername}" in "${content}"`
            );
        }
    }
    
    // Emoji preservation validation
    if (testData.containsEmoji || testData.originalUsername && /[\u{1F600}-\u{1F64F}]|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{1F700}-\u{1F77F}|\u{1F780}-\u{1F7FF}|\u{1F800}-\u{1F8FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}/u.test(testData.originalUsername)) {
        const emojiPattern = /[\u{1F600}-\u{1F64F}]|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{1F700}-\u{1F77F}|\u{1F780}-\u{1F7FF}|\u{1F800}-\u{1F8FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}/u;
        if (!emojiPattern.test(content)) {
            throw new Error(
                `Emoji characters not preserved in processed content: "${content}"`
            );
        }
    }
    
    // Currency symbol handling validation
    if (testData.currency && testData.currency.symbol) {
        const currencySymbol = testData.currency.symbol;
        if (!content.includes(currencySymbol)) {
            throw new Error(
                `Currency symbol "${currencySymbol}" not found in content: "${content}"`
            );
        }
    }
    
    // RTL (right-to-left) character preservation
    if (testData.language === 'arabic' || testData.language === 'hebrew') {
        // Check for RTL characters (Arabic, Hebrew ranges)
        const rtlPattern = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F]/;
        if (testData.originalUsername && rtlPattern.test(testData.originalUsername)) {
            if (!rtlPattern.test(content)) {
                throw new Error(
                    `RTL characters not preserved for ${testData.language} content: "${content}"`
                );
            }
        }
    }
    
    // Chinese/Japanese/Korean character preservation
    if (testData.language === 'chinese' || testData.language === 'japanese' || testData.language === 'korean') {
        const cjkPattern = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/;
        if (testData.originalUsername && cjkPattern.test(testData.originalUsername)) {
            if (!cjkPattern.test(content)) {
                throw new Error(
                    `CJK characters not preserved for ${testData.language} content: "${content}"`
                );
            }
        }
    }
    
    // Validate no technical artifacts in international content
    expectNoTechnicalArtifacts(content);
};

const expectUserFriendlyErrorMessage = (errorMessage, options = {}) => {
    if (typeof errorMessage !== 'string') {
        throw new Error('Error message must be a string');
    }
    
    // Should not contain technical details
    expectNoTechnicalArtifacts(errorMessage);
    
    // Should be actionable and clear (minimum length check)
    const minLength = options.minLength || 10;
    if (errorMessage.trim().length < minLength) {
        throw new Error(
            `Error message too short. Minimum: ${minLength} characters, Got: ${errorMessage.trim().length}`
        );
    }
    
    // Should not contain error codes
    if (/\d{3,}/.test(errorMessage) && !options.allowErrorCodes) {
        throw new Error(`Error message contains error codes: "${errorMessage}"`);
    }
    
    // Should have proper capitalization
    if (!/^[A-Z]/.test(errorMessage.trim())) {
        throw new Error(`Error message should start with capital letter: "${errorMessage}"`);
    }
    
    // Should not contain technical jargon
    const technicalTerms = [
        'API', 'HTTP', 'JSON', 'XML', 'SQL', 'REST', 'SOAP',
        'OAuth', 'JWT', 'SSL', 'TLS', 'WebSocket', 'TCP', 'UDP',
        'middleware', 'callback', 'endpoint', 'payload'
    ];
    
    if (!options.allowTechnicalTerms) {
        technicalTerms.forEach(term => {
            if (errorMessage.toLowerCase().includes(term.toLowerCase())) {
                throw new Error(
                    `Error message contains technical term "${term}": "${errorMessage}"`
                );
            }
        });
    }
    
    // Should provide guidance or next steps
    const guidanceIndicators = [
        'please', 'try', 'check', 'make sure', 'ensure', 'verify',
        'contact', 'visit', 'go to', 'click', 'select'
    ];
    
    if (options.requireGuidance) {
        const hasGuidance = guidanceIndicators.some(indicator => 
            errorMessage.toLowerCase().includes(indicator)
        );
        
        if (!hasGuidance) {
            throw new Error(
                `Error message should provide guidance or next steps: "${errorMessage}"`
            );
        }
    }
};

const createInternationalTestData = () => {
    return {
        emoji: {
            username: "🎮GamerKing",
            language: "emoji",
            containsEmoji: true,
            testMessage: "Thanks for the gift! 🎉✨"
        },
        arabic: {
            username: "محمد_أحمد",
            language: "arabic",
            originalUsername: "محمد_أحمد",
            testMessage: "شكرا للهدية الرائعة!"
        },
        chinese: {
            username: "李小明",
            language: "chinese", 
            originalUsername: "李小明",
            testMessage: "谢谢你的礼物！"
        },
        spanish: {
            username: "Example_Usuario",
            language: "spanish",
            originalUsername: "Example_Usuario", 
            testMessage: "¡Gracias por el regalo!"
        },
        cyrillic: {
            username: "Владимир",
            language: "cyrillic",
            originalUsername: "Владимир",
            testMessage: "Спасибо за подарок!"
        },
        japanese: {
            username: "田中太郎",
            language: "japanese",
            originalUsername: "田中太郎",
            testMessage: "ギフトをありがとう！"
        },
        korean: {
            username: "김철수",
            language: "korean", 
            originalUsername: "김철수",
            testMessage: "선물 고마워요!"
        },
        mixed: {
            username: "User_🌟_李明",
            language: "mixed",
            originalUsername: "User_🌟_李明",
            containsEmoji: true,
            testMessage: "Great stream! 很棒的直播! 🎉"
        }
    };
};

const validateUserFacingString = (userVisibleString, requirements = {}) => {
    if (typeof userVisibleString !== 'string') {
        throw new Error('User-visible content must be a string');
    }
    
    // Check for technical artifacts first
    expectNoTechnicalArtifacts(userVisibleString, requirements);
    
    // Check minimum content length
    const minLength = requirements.minLength || 5;
    if (userVisibleString.trim().length < minLength) {
        throw new Error(
            `User-visible content too short. Minimum: ${minLength} characters, ` +
            `Got: ${userVisibleString.trim().length} ("${userVisibleString}")`
        );
    }
    
    // Check for proper whitespace formatting
    if (userVisibleString !== userVisibleString.trim()) {
        throw new Error(
            `User-visible content has leading/trailing whitespace: "${userVisibleString}"`
        );
    }
    
    // Check for multiple consecutive spaces
    if (/\s{2,}/.test(userVisibleString)) {
        throw new Error(
            `User-visible content has multiple consecutive spaces: "${userVisibleString}"`
        );
    }
    
    // Check for empty parentheses/brackets
    if (/\(\s*\)|\[\s*\]/.test(userVisibleString)) {
        throw new Error(
            `User-visible content has empty parentheses/brackets: "${userVisibleString}"`
        );
    }
    
    // Validate expected content pattern if provided
    if (requirements.pattern) {
        if (!requirements.pattern.test(userVisibleString)) {
            throw new Error(
                `User-visible content doesn't match expected pattern. ` +
                `Pattern: ${requirements.pattern}, Content: "${userVisibleString}"`
            );
        }
    }
    
    // Check for specific content if required
    if (requirements.mustContain) {
        const mustContain = Array.isArray(requirements.mustContain) ? 
            requirements.mustContain : [requirements.mustContain];
        
        mustContain.forEach(required => {
            if (!userVisibleString.includes(required)) {
                throw new Error(
                    `User-visible content missing required text "${required}": "${userVisibleString}"`
                );
            }
        });
    }
    
    // Check for forbidden content
    if (requirements.mustNotContain) {
        const mustNotContain = Array.isArray(requirements.mustNotContain) ? 
            requirements.mustNotContain : [requirements.mustNotContain];
        
        mustNotContain.forEach(forbidden => {
            if (userVisibleString.includes(forbidden)) {
                throw new Error(
                    `User-visible content contains forbidden text "${forbidden}": "${userVisibleString}"`
                );
            }
        });
    }
    
    // Validate international content preservation
    if (requirements.originalContent) {
        expectInternationalContentPreservation(requirements.originalContent, userVisibleString);
    }
};

const expectSuccessfulTemplateInterpolation = (templateString, interpolatedString, templateData) => {
    if (typeof templateString !== 'string' || typeof interpolatedString !== 'string') {
        throw new Error('Template and interpolated strings must be strings');
    }
    
    // Check that result is different from template (unless no placeholders)
    const hasPlaceholders = /\{.*\}/.test(templateString);
    if (hasPlaceholders && templateString === interpolatedString) {
        throw new Error(
            `Template interpolation failed - result identical to template: "${templateString}"`
        );
    }
    
    // Check that no placeholders remain
    expectNoTechnicalArtifacts(interpolatedString);
    
    // Verify expected data was used
    if (templateData && typeof templateData === 'object') {
        Object.keys(templateData).forEach(key => {
            const value = templateData[key];
            if (value !== null && value !== undefined && typeof value !== 'object') {
                const stringValue = String(value);
                // Only check for inclusion if the value is meaningful
                if (stringValue.length > 0 && stringValue !== '0') {
                    if (!interpolatedString.includes(stringValue)) {
                        throw new Error(
                            `Template data "${key}: ${value}" not found in interpolated result: "${interpolatedString}"`
                        );
                    }
                }
            }
        });
    }
};

const expectContentReadabilityForAudience = (content, audience) => {
    if (typeof content !== 'string') {
        throw new Error('Content must be a string');
    }
    
    const validAudiences = ['user', 'admin', 'developer'];
    if (!validAudiences.includes(audience)) {
        throw new Error(`Invalid audience. Must be one of: ${validAudiences.join(', ')}`);
    }
    
    switch (audience) {
        case 'user':
            // Check for file paths or code references first
            if (/src\/|\.js|\.json|\.ini/.test(content)) {
                throw new Error(
                    `User-facing content contains file path references: "${content}"`
                );
            }
            
            // Users should not see technical jargon
            const technicalTerms = [
                'API', 'WebSocket', 'HTTP', 'JSON', 'SSL', 'TLS', 'OAuth',
                'callback', 'endpoint', 'buffer', 'parse', 'serialize',
                'middleware', 'handler', 'factory', 'singleton', 'Promise',
                'async', 'await', 'timeout', 'config', 'init', 'bootstrap'
            ];
            
            technicalTerms.forEach(term => {
                if (content.toLowerCase().includes(term.toLowerCase())) {
                    throw new Error(
                        `User-facing content contains technical term "${term}": "${content}"`
                    );
                }
            });
            break;
            
        case 'admin':
            // Admins can see some technical terms but not code details
            if (/function|class|const |let |var /.test(content)) {
                throw new Error(
                    `Admin-facing content contains code syntax: "${content}"`
                );
            }
            break;
            
        case 'developer':
            // Developers can see technical content
            // Just check for basic formatting
            if (content.length > 500) {
                throw new Error(
                    `Developer content too verbose (>500 chars): "${content.substring(0, 100)}..."`
                );
            }
            break;
    }
};

const expectCrossPlatformContentConsistency = (platformContents, options = {}) => {
    const platforms = Object.keys(platformContents);
    if (platforms.length < 2) {
        throw new Error('Need at least 2 platforms to check consistency');
    }
    
    // Check each platform's content for technical artifacts
    platforms.forEach(platform => {
        const content = platformContents[platform];
        expectNoTechnicalArtifacts(content, options);
    });
    
    // Check for consistent information across platforms
    if (!options.allowPlatformSpecificContent) {
        // Extract key information (usernames, amounts, etc.)
        const contentInfo = platforms.map(platform => {
            const content = platformContents[platform];
            return {
                platform,
                content,
                // Extract numbers (amounts, counts)
                numbers: (content.match(/\d+(?:\.\d+)?/g) || []).map(Number),
                // Extract quoted strings (usernames, messages)
                quotedStrings: content.match(/"([^"]*)"/g) || [],
                // Extract currencies
                currencies: content.match(/[$€£¥₹]/g) || []
            };
        });
        
        // Compare key information
        const firstInfo = contentInfo[0];
        contentInfo.slice(1).forEach(info => {
            // Check numbers are consistent
            if (JSON.stringify(firstInfo.numbers.sort()) !== JSON.stringify(info.numbers.sort())) {
                throw new Error(
                    `Inconsistent numbers across platforms. ` +
                    `${firstInfo.platform}: [${firstInfo.numbers.join(', ')}], ` +
                    `${info.platform}: [${info.numbers.join(', ')}]`
                );
            }
            
            // Check currencies are consistent
            if (JSON.stringify(firstInfo.currencies.sort()) !== JSON.stringify(info.currencies.sort())) {
                throw new Error(
                    `Inconsistent currencies across platforms. ` +
                    `${firstInfo.platform}: [${firstInfo.currencies.join(', ')}], ` +
                    `${info.platform}: [${info.currencies.join(', ')}]`
                );
            }
        });
    }
};

// ================================================================================================
// PHASE 4A: ENHANCED DOMAIN-SPECIFIC ASSERTIONS
// ================================================================================================

const expectValidGiftNotification = (notification, expectedData = {}) => {
    if (!notification || typeof notification !== 'object') {
        throw new Error('Gift notification must be an object');
    }
    
    // First validate as general notification
    expectValidNotification(notification, 'gift', expectedData.platform || notification.platform);
    
    // Gift-specific validations
    const requiredGiftFields = ['amount', 'currency'];
    requiredGiftFields.forEach(field => {
        if (!notification.hasOwnProperty(field)) {
            throw new Error(`Missing required field: ${field}`);
        }
    });
    
    // Validate amount
    if (typeof notification.amount !== 'number' || notification.amount <= 0) {
        throw new Error('Gift amount must be positive');
    }
    
    if (expectedData.minAmount && notification.amount < expectedData.minAmount) {
        throw new Error(`Gift amount ${notification.amount} is below minimum ${expectedData.minAmount}`);
    }
    
    // Validate currency
    if (typeof notification.currency !== 'string' || !notification.currency.trim()) {
        throw new Error('Gift currency must be a non-empty string');
    }
    
    if (expectedData.allowedCurrencies && !expectedData.allowedCurrencies.includes(notification.currency)) {
        throw new Error(`Invalid currency: ${notification.currency}`);
    }
    
    if (expectedData.requiredCurrency && notification.currency !== expectedData.requiredCurrency) {
        throw new Error(`Expected currency ${expectedData.requiredCurrency}, got ${notification.currency}`);
    }
    
    // Validate gift-specific content
    if (!notification.displayMessage.includes(notification.amount.toString())) {
        throw new Error('Gift notification display message must include amount');
    }
    
    if (!notification.displayMessage.includes(notification.currency)) {
        throw new Error('Gift notification display message must include currency');
    }
    
    // Validate no technical artifacts in gift content
    expectNoTechnicalArtifacts(notification.displayMessage);
    expectNoTechnicalArtifacts(notification.ttsMessage);
};

const expectValidPlatformBehavior = (platform, behaviorType, expectations = {}) => {
    if (!platform || typeof platform !== 'object') {
        throw new Error('Platform must be an object');
    }
    
    // Check required methods
    if (expectations.requiredMethods) {
        expectations.requiredMethods.forEach(method => {
            if (!platform.hasOwnProperty(method)) {
                throw new Error(`Platform missing required method: ${method}`);
            }
            if (typeof platform[method] !== 'function') {
                throw new Error(`Platform method ${method} must be a function`);
            }
        });
    }
    
    // Validate behavior-specific expectations
    switch (behaviorType) {
        case 'message_processing':
            if (expectations.shouldProcessAsync && !platform.processMessage.mock) {
                // For real implementations, we can't easily test async nature
                break;
            }
            if (expectations.shouldReturnBoolean && platform.processMessage.mock) {
                // Check if mock is configured to return boolean
                const mockReturn = platform.processMessage.getMockImplementation();
                if (mockReturn && typeof mockReturn() !== 'boolean' && !mockReturn().then) {
                    throw new Error('Platform processMessage should return boolean or Promise<boolean>');
                }
            }
            break;
            
        case 'notification_handling':
            if (!platform.handleNotification) {
                throw new Error('Platform missing required method: handleNotification');
            }
            break;
            
        case 'error_handling':
            if (expectations.shouldHandleErrors) {
                // Test error handling by trying to trigger an error
                try {
                    const result = platform.processMessage();
                    // If processMessage is supposed to throw and doesn't, that's a problem
                    if (expectations.expectedErrorTypes && !result) {
                        throw new Error('Platform should handle errors gracefully');
                    }
                } catch (error) {
                    // If we expect error handling but get an unhandled error, that's a problem
                    if (expectations.expectedErrorTypes && !expectations.expectedErrorTypes.some(type => error.message.includes(type))) {
                        throw new Error('Platform should handle errors gracefully');
                    }
                }
            }
            break;
    }
    
    // Validate platform metadata if present
    if (platform._mockType && expectations.expectedMockType) {
        if (platform._mockType !== expectations.expectedMockType) {
            throw new Error(`Expected mock type ${expectations.expectedMockType}, got ${platform._mockType}`);
        }
    }
};

const expectNoTechnicalArtifacts = (userVisibleString, options = {}) => {
    if (typeof userVisibleString !== 'string') {
        throw new Error('User-visible content must be a string');
    }
    
    const violations = [];
    
    // PHASE 5B: Enhanced JSON pattern detection
    if (/\{.*".*".*\}/.test(userVisibleString)) {
        violations.push('Contains JSON structure');
    }
    
    // PHASE 5B: Enhanced debug marker detection  
    if (/\[(DEBUG|ERROR|LOG|INFO|WARN|TRACE)\]/.test(userVisibleString)) {
        violations.push('Contains debug markers');
    }
    
    // PHASE 5B: Enhanced file path detection
    if (/(?:src|tests|node_modules|\.js|\.json|\.ini|\.md|\.ts|\.tsx)\//.test(userVisibleString)) {
        violations.push('Contains file paths');
    }
    
    // PHASE 5B: Enhanced error code detection
    if (/Error:\s*\d+|Code:\s*\d+|HTTP\s*\d{3}/.test(userVisibleString)) {
        violations.push('Contains error codes');
    }
    
    // PHASE 5B: Enhanced technical values detection
    const technicalArtifacts = ['undefined', 'null', 'NaN', '[object Object]', 'TypeError', 'ReferenceError', 'SyntaxError'];
    technicalArtifacts.forEach(artifact => {
        if (userVisibleString.includes(artifact)) {
            violations.push(`Contains technical artifact "${artifact}"`);
        }
    });
    
    // PHASE 5B: Test artifacts detection
    if (/mockObject|testData|fixture|stub|spy/.test(userVisibleString)) {
        violations.push('Contains test artifacts');
    }
    
    // PHASE 5B: Template placeholder detection (previous and current patterns)
    if (/\{[^}]*\}|\$\{[^}]*\}|%[A-Za-z_][A-Za-z0-9_]*%/.test(userVisibleString)) {
        violations.push('Contains template placeholders');
    }
    
    // Stack trace detection
    if (userVisibleString.includes('at ') && userVisibleString.includes('.js:')) {
        violations.push('Contains stack trace information');
    }
    
    // Check for debug prefixes if not allowed
    if (!options.allowDebugPrefixes) {
        const debugPrefixes = ['DEBUG:', 'ERROR:', 'WARN:', 'INFO:', 'TRACE:', 'LOG:'];
        debugPrefixes.forEach(prefix => {
            if (userVisibleString.startsWith(prefix)) {
                violations.push(`Contains debug prefix "${prefix}"`);
            }
        });
    }
    
    // PHASE 5B: API endpoint detection
    if (/\/api\/|\/v\d+\/|localhost:\d+|127\.0\.0\.1/.test(userVisibleString)) {
        violations.push('Contains API endpoints or localhost references');
    }
    
    // PHASE 5B: Database/SQL artifacts (but exclude common words like "from")
    if (/\b(SELECT|INSERT|UPDATE|DELETE)\s+\w+/i.test(userVisibleString) || /\bWHERE\s+\w+\s*=/i.test(userVisibleString)) {
        violations.push('Contains SQL statements');
    }
    
    // PHASE 5B: Configuration keys detection
    if (/[A-Z_]{3,}=|config\.|process\.env\./.test(userVisibleString)) {
        violations.push('Contains configuration references');
    }
    
    // Report all violations at once for better debugging
    if (violations.length > 0) {
        throw new Error(`Technical artifacts detected: ${violations.join(', ')} in "${userVisibleString}"`);
    }
};

const expectProperCurrencyFormatting = (amount, currency, platform) => {
    if (typeof amount !== 'number' || amount < 0) {
        throw new Error('Currency amount must be a non-negative number');
    }
    
    if (typeof currency !== 'string' || !currency.trim()) {
        throw new Error('Currency must be a non-empty string');
    }
    
    if (typeof platform !== 'string' || !platform.trim()) {
        throw new Error('Platform must be a non-empty string');
    }
    
    // Platform-specific currency rules
    switch (platform.toLowerCase()) {
        case 'youtube':
            // YouTube supports decimal currencies
            validateYouTubeCurrencyFormat(amount, currency);
            break;
            
        case 'tiktok':
            // TikTok typically doesn't use fractional currencies for gifts
            if (amount % 1 !== 0) {
                throw new Error('TikTok platform does not support fractional currency amounts');
            }
            break;
            
        case 'twitch':
            // Twitch supports decimal currencies for donations/bits
            validateTwitchCurrencyFormat(amount, currency);
            break;
            
        default:
            // General currency validation
            validateGeneralCurrencyFormat(amount, currency);
    }
};

const validateYouTubeCurrencyFormat = (amount, currency) => {
    const currencyRules = {
        'USD': { decimals: 2, symbol: '$' },
        'EUR': { decimals: 2, symbol: '€' },
        'GBP': { decimals: 2, symbol: '£' },
        'JPY': { decimals: 0, symbol: '¥' },
        'CNY': { decimals: 2, symbol: '¥' },
        'KRW': { decimals: 0, symbol: '₩' }
    };
    
    const rule = currencyRules[currency.toUpperCase()];
    if (!rule) {
        throw new Error(`Unsupported currency: ${currency}`);
    }
    
    if (rule.decimals === 0 && amount % 1 !== 0) {
        throw new Error(`${currency} currency should not have decimal places`);
    }
    
    if (rule.decimals > 0) {
        const decimalString = amount.toString().split('.')[1] || '';
        const decimalPlaces = decimalString.length;
        // Allow reasonable decimal precision (0, 1, or 2 decimal places for most currencies)
        if (decimalPlaces > rule.decimals) {
            throw new Error(`${currency} currency cannot have more than ${rule.decimals} decimal places`);
        }
    }
};

const validateTwitchCurrencyFormat = (amount, currency) => {
    // Twitch follows similar rules to YouTube for most currencies
    validateYouTubeCurrencyFormat(amount, currency);
};

const validateGeneralCurrencyFormat = (amount, currency) => {
    if (amount < 0) {
        throw new Error('Currency amount cannot be negative');
    }
    
    const validCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'KRW', 'BRL', 'CAD', 'AUD'];
    if (!validCurrencies.includes(currency.toUpperCase())) {
        throw new Error(`Invalid currency format: ${currency}`);
    }
    
    // Check for reasonable decimal precision (max 4 decimal places)
    const decimalPlaces = (amount.toString().split('.')[1] || '').length;
    if (decimalPlaces > 4) {
        throw new Error('Currency amount has too many decimal places');
    }
};

// ================================================================================================
// EXPORTS
// ================================================================================================

// ================================================================================================
// Authentication consistency assertions
// ================================================================================================

const expectConsistentValidation = (validationResults) => {
    if (!Array.isArray(validationResults) || validationResults.length < 2) {
        throw new Error('expectConsistentValidation requires at least 2 validation results to compare');
    }
    
    const firstResult = validationResults[0];
    const requiredFields = ['isValid', 'validationSource'];
    
    // Check that all results have required fields
    validationResults.forEach((result, index) => {
        requiredFields.forEach(field => {
            if (!result.hasOwnProperty(field)) {
                throw new Error(`Validation result ${index} missing required field: ${field}`);
            }
        });
    });
    
    // Check that all results have consistent validation outcomes
    for (let i = 1; i < validationResults.length; i++) {
        const currentResult = validationResults[i];
        
        if (firstResult.isValid !== currentResult.isValid) {
            throw new Error(
                `Inconsistent validation results: result 0 isValid=${firstResult.isValid}, ` +
                `result ${i} isValid=${currentResult.isValid}`
            );
        }
        
        if (firstResult.validationSource !== currentResult.validationSource) {
            throw new Error(
                `Inconsistent validation source: result 0 source=${firstResult.validationSource}, ` +
                `result ${i} source=${currentResult.validationSource}`
            );
        }
    }
    
    // Validate that centralized validation is being used
    validationResults.forEach((result, index) => {
        if (result.validationSource !== 'centralized_validator') {
            throw new Error(
                `Result ${index} does not use centralized validation. ` +
                `Expected: 'centralized_validator', Got: '${result.validationSource}'`
            );
        }
    });
};

const expectUnifiedBehavior = (options) => {
    const { scenario, results, expectedOutcome } = options;
    
    if (!scenario || !results || !expectedOutcome) {
        throw new Error('expectUnifiedBehavior requires scenario, results, and expectedOutcome');
    }
    
    if (!Array.isArray(results) || results.length < 2) {
        throw new Error('expectUnifiedBehavior requires at least 2 results to compare');
    }
    
    // Validate that all results indicate unified behavior
    results.forEach((result, index) => {
        if (!result.hasOwnProperty('validationSource')) {
            throw new Error(`Result ${index} missing validationSource field`);
        }
        
        if (result.validationSource !== 'centralized_validator') {
            throw new Error(
                `Result ${index} in scenario '${scenario}' does not use centralized validation. ` +
                `Expected: 'centralized_validator', Got: '${result.validationSource}'`
            );
        }
    });
    
    // Check that all results have consistent structure for the scenario
    const firstResult = results[0];
    const expectedFields = Object.keys(firstResult);
    
    for (let i = 1; i < results.length; i++) {
        const currentResult = results[i];
        
        expectedFields.forEach(field => {
            if (!currentResult.hasOwnProperty(field)) {
                throw new Error(
                    `Inconsistent behavior in scenario '${scenario}': ` +
                    `result ${i} missing field '${field}' that exists in result 0`
                );
            }
        });
    }
    
    // Scenario-specific validation
    switch (scenario) {
        case 'token_validation':
        case 'standard-validation':
            results.forEach((result, index) => {
                if (!result.hasOwnProperty('isValid')) {
                    throw new Error(`Result ${index} missing isValid field for token validation scenario`);
                }
            });
            break;
            
        case 'token_expiration_detection':
            results.forEach((result, index) => {
                if (!result.hasOwnProperty('isExpired')) {
                    throw new Error(`Result ${index} missing isExpired field for expiration detection scenario`);
                }
            });
            break;
            
        case 'token_format_validation':
            results.forEach((result, index) => {
                if (!result.hasOwnProperty('format')) {
                    throw new Error(`Result ${index} missing format field for format validation scenario`);
                }
            });
            break;
            
        case 'single_source_of_truth':
        case 'centralized_validation':
            results.forEach((result, index) => {
                if (!result.hasOwnProperty('validationSteps')) {
                    throw new Error(`Result ${index} missing validationSteps field for centralized validation scenario`);
                }
                
                if (!Array.isArray(result.validationSteps)) {
                    throw new Error(`Result ${index} validationSteps must be an array`);
                }
            });
            break;
    }
};

const expectConsistentConfigBehavior = (configResults) => {
    if (!Array.isArray(configResults) || configResults.length < 2) {
        throw new Error('expectConsistentConfigBehavior requires at least 2 config results to compare');
    }
    
    configResults.forEach((result, index) => {
        // Check if result has validation field (wrapped) or implementationType directly
        let targetValidation;
        if (result.hasOwnProperty('validation')) {
            targetValidation = result.validation;
        } else if (result.hasOwnProperty('implementationType')) {
            targetValidation = result;
        } else {
            throw new Error(`Config result ${index} missing validation or implementationType field`);
        }
        
        if (!targetValidation.hasOwnProperty('implementationType')) {
            throw new Error(`Validation result ${index} missing implementationType field`);
        }
        
        if (targetValidation.implementationType !== 'delegated_to_central') {
            throw new Error(
                `Result ${index} does not use centralized configuration. ` +
                `Expected: 'delegated_to_central', Got: '${targetValidation.implementationType}'`
            );
        }
    });
};

const expectUnifiedErrorHandling = (errorResults) => {
    if (!Array.isArray(errorResults) || errorResults.length < 2) {
        throw new Error('expectUnifiedErrorHandling requires at least 2 error results to compare');
    }
    
    const firstResult = errorResults[0];
    const requiredFields = ['implementationType'];
    
    // Check that all results have required fields
    errorResults.forEach((result, index) => {
        requiredFields.forEach(field => {
            if (!result.hasOwnProperty(field)) {
                throw new Error(`Error result ${index} missing required field: ${field}`);
            }
        });
    });
    
    // Check that all results indicate unified error handling
    errorResults.forEach((result, index) => {
        if (result.implementationType !== 'delegated_to_central') {
            throw new Error(
                `Result ${index} does not use centralized error handling. ` +
                `Expected: 'delegated_to_central', Got: '${result.implementationType}'`
            );
        }
    });
};

// ================================================================================================
// HTTP REQUEST PATTERNS CONSISTENCY ASSERTIONS
// ================================================================================================

const expectConsistentHttpBehavior = (httpBehaviors) => {
    if (!Array.isArray(httpBehaviors) || httpBehaviors.length < 2) {
        throw new Error('expectConsistentHttpBehavior requires at least 2 HTTP behavior objects to compare');
    }
    
    const firstBehavior = httpBehaviors[0];
    
    // Validate all behaviors are objects
    httpBehaviors.forEach((behavior, index) => {
        if (!behavior || typeof behavior !== 'object') {
            throw new Error(`HTTP behavior at index ${index} must be a valid object`);
        }
    });
    
    // Check for consistent header structure
    if (firstBehavior.standardHeaders) {
        httpBehaviors.forEach((behavior, index) => {
            if (!behavior.standardHeaders) {
                throw new Error(`HTTP behavior at index ${index} missing standardHeaders`);
            }
            
            // Validate header consistency
            const firstHeaders = Object.keys(firstBehavior.standardHeaders).sort();
            const currentHeaders = Object.keys(behavior.standardHeaders).sort();
            
            if (JSON.stringify(firstHeaders) !== JSON.stringify(currentHeaders)) {
                throw new Error(`HTTP header structure inconsistent at index ${index}. Expected: ${firstHeaders.join(', ')}, Got: ${currentHeaders.join(', ')}`);
            }
        });
    }
    
    // Check for consistent timeout patterns
    if (firstBehavior.requestTimeout !== undefined) {
        httpBehaviors.forEach((behavior, index) => {
            if (behavior.requestTimeout !== firstBehavior.requestTimeout) {
                throw new Error(`HTTP timeout inconsistent at index ${index}. Expected: ${firstBehavior.requestTimeout}, Got: ${behavior.requestTimeout}`);
            }
        });
    }
    
    // Check for consistent retry patterns
    if (firstBehavior.maxRetries !== undefined) {
        httpBehaviors.forEach((behavior, index) => {
            if (behavior.maxRetries !== firstBehavior.maxRetries) {
                throw new Error(`HTTP retry count inconsistent at index ${index}. Expected: ${firstBehavior.maxRetries}, Got: ${behavior.maxRetries}`);
            }
        });
    }
    
    // Check for consistent response handling
    if (firstBehavior.category !== undefined) {
        httpBehaviors.forEach((behavior, index) => {
            if (behavior.category !== firstBehavior.category) {
                throw new Error(`HTTP response category inconsistent at index ${index}. Expected: ${firstBehavior.category}, Got: ${behavior.category}`);
            }
        });
    }
    
    // Check for consistent error handling
    if (firstBehavior.userMessage !== undefined) {
        httpBehaviors.forEach((behavior, index) => {
            if (behavior.userMessage !== firstBehavior.userMessage) {
                throw new Error(`HTTP error message inconsistent at index ${index}. Expected: "${firstBehavior.userMessage}", Got: "${behavior.userMessage}"`);
            }
        });
    }
};

const expectUnifiedRequestPatterns = (requestPatterns) => {
    if (!Array.isArray(requestPatterns) || requestPatterns.length < 2) {
        throw new Error('expectUnifiedRequestPatterns requires at least 2 request pattern objects to compare');
    }
    
    const firstPattern = requestPatterns[0];
    
    // Validate all patterns are objects
    requestPatterns.forEach((pattern, index) => {
        if (!pattern || typeof pattern !== 'object') {
            throw new Error(`Request pattern at index ${index} must be a valid object`);
        }
    });
    
    // Check for unified timeout configuration
    if (firstPattern.requestTimeout !== undefined || firstPattern.retryTimeout !== undefined) {
        requestPatterns.forEach((pattern, index) => {
            if (pattern.requestTimeout !== firstPattern.requestTimeout) {
                throw new Error(`Request timeout pattern inconsistent at index ${index}. Expected: ${firstPattern.requestTimeout}, Got: ${pattern.requestTimeout}`);
            }
            
            if (pattern.retryTimeout !== firstPattern.retryTimeout) {
                throw new Error(`Retry timeout pattern inconsistent at index ${index}. Expected: ${firstPattern.retryTimeout}, Got: ${pattern.retryTimeout}`);
            }
        });
    }
    
    // Check for unified retry configuration
    if (firstPattern.maxRetries !== undefined || firstPattern.backoffMultiplier !== undefined) {
        requestPatterns.forEach((pattern, index) => {
            if (pattern.maxRetries !== firstPattern.maxRetries) {
                throw new Error(`Retry pattern inconsistent at index ${index}. Expected maxRetries: ${firstPattern.maxRetries}, Got: ${pattern.maxRetries}`);
            }
            
            if (pattern.backoffMultiplier !== firstPattern.backoffMultiplier) {
                throw new Error(`Backoff pattern inconsistent at index ${index}. Expected backoffMultiplier: ${firstPattern.backoffMultiplier}, Got: ${pattern.backoffMultiplier}`);
            }
        });
    }
    
    // Check for unified lifecycle actions
    if (firstPattern.actions && Array.isArray(firstPattern.actions)) {
        requestPatterns.forEach((pattern, index) => {
            if (!pattern.actions || !Array.isArray(pattern.actions)) {
                throw new Error(`Lifecycle actions missing at index ${index}`);
            }
            
            if (JSON.stringify(pattern.actions.sort()) !== JSON.stringify(firstPattern.actions.sort())) {
                throw new Error(`Lifecycle actions inconsistent at index ${index}. Expected: [${firstPattern.actions.join(', ')}], Got: [${pattern.actions.join(', ')}]`);
            }
        });
    }
    
    // Check for unified priority/queuing patterns
    if (firstPattern.priority !== undefined || firstPattern.queuePosition !== undefined) {
        requestPatterns.forEach((pattern, index) => {
            if (pattern.priority !== firstPattern.priority) {
                throw new Error(`Priority pattern inconsistent at index ${index}. Expected: ${firstPattern.priority}, Got: ${pattern.priority}`);
            }
            
            if (pattern.queuePosition !== firstPattern.queuePosition) {
                throw new Error(`Queue position pattern inconsistent at index ${index}. Expected: ${firstPattern.queuePosition}, Got: ${pattern.queuePosition}`);
            }
        });
    }
    
    // Check for unified parsing patterns
    if (firstPattern.parsedFields && Array.isArray(firstPattern.parsedFields)) {
        requestPatterns.forEach((pattern, index) => {
            if (!pattern.parsedFields || !Array.isArray(pattern.parsedFields)) {
                throw new Error(`Parsed fields missing at index ${index}`);
            }
            
            if (JSON.stringify(pattern.parsedFields.sort()) !== JSON.stringify(firstPattern.parsedFields.sort())) {
                throw new Error(`Parsed fields inconsistent at index ${index}. Expected: [${firstPattern.parsedFields.join(', ')}], Got: [${pattern.parsedFields.join(', ')}]`);
            }
        });
    }
    
    // Check for unified request building patterns
    if (firstPattern.builderSource !== undefined) {
        requestPatterns.forEach((pattern, index) => {
            if (pattern.builderSource !== firstPattern.builderSource) {
                throw new Error(`Request builder source inconsistent at index ${index}. Expected: ${firstPattern.builderSource}, Got: ${pattern.builderSource}`);
            }
        });
    }
    
    // Check for unified centralization patterns
    if (firstPattern.operationSource !== undefined) {
        requestPatterns.forEach((pattern, index) => {
            if (pattern.operationSource !== firstPattern.operationSource) {
                throw new Error(`Operation source inconsistent at index ${index}. Expected: ${firstPattern.operationSource}, Got: ${pattern.operationSource}`);
            }
        });
    }
};

module.exports = {
    // Notification assertions
    expectValidNotification,
    expectNotificationContent,
    expectNotificationTiming,
    expectNotificationSequence,
    
    // Platform-specific assertions
    expectYouTubeEventProcessing,
    expectTwitchEventSubHandling,
    expectTikTokGiftAggregation,
    expectOBSIntegration,
    
    // Mock interaction assertions
    expectOnlyMethodCalled,
    expectMethodCallSequence,
    expectNoUnexpectedCalls,
    expectMockCallPattern,
    
    // Data structure assertions
    expectPlatformEventStructure,
    expectInternationalContentPreservation,
    expectValidUserData,
    expectValidGiftData,
    expectValidStreamData,
    
    // Content quality assertions
    expectNoTechnicalArtifacts,
    validateUserFacingString,
    expectSuccessfulTemplateInterpolation,
    expectContentReadabilityForAudience,
    expectCrossPlatformContentConsistency,
    
    // Enhanced domain-specific assertions
    expectValidGiftNotification,
    expectValidPlatformBehavior,
    expectProperCurrencyFormatting,
    
    // International content and error message quality
    expectInternationalContentSupport,
    expectUserFriendlyErrorMessage,
    createInternationalTestData,
    
    // Authentication consistency assertions
    expectConsistentValidation,
    expectUnifiedBehavior,
    
    // HTTP Request Patterns Consistency Assertions
    expectConsistentHttpBehavior,
    expectUnifiedRequestPatterns,
    
    // Configuration Management Consistency Assertions
    expectConsistentConfigBehavior,
    expectUnifiedErrorHandling
};
