
import { isMockFunction, type TestMockFn } from './bun-mock-utils';
import testClock from './test-clock';

type UnknownRecord = Record<string, unknown>;
type NotificationType = string;
type PlatformName = 'youtube' | 'twitch' | 'tiktok';
type NotificationOrder = 'priority_desc' | 'timestamp_asc' | 'timestamp_desc';
type Audience = 'user' | 'admin' | 'developer';

type NotificationTimingExpectations = {
    maxProcessingDelay?: number;
    timestampTolerance?: number;
    maxAge?: number;
};

type YouTubeExpectedOutcome = {
    notificationType?: string;
};

type GiftAggregationExpectations = {
    totalGifts: number;
    giftType?: string;
    shouldAggregate?: boolean;
};

type ObsCommandCounts = {
    textUpdates: number;
    effectTriggers: number;
    sceneChanges: number;
    filterChanges: number;
};

type MockFactoryObject = UnknownRecord & {
    _mockType?: unknown;
    _validMethods?: unknown;
};

type MockCallPattern = Record<string, number | { min?: number; max?: number }>;
type PlatformEventType = 'gift' | 'follow' | 'subscribe' | 'raid' | undefined;

type InternationalTestData = UnknownRecord & {
    originalUsername?: string;
    containsEmoji?: boolean;
    currency?: { symbol?: string };
    language?: string;
};

type UserFriendlyErrorOptions = {
    minLength?: number;
    allowErrorCodes?: boolean;
    allowTechnicalTerms?: boolean;
    requireGuidance?: boolean;
};

type UserFacingStringRequirements = {
    minLength?: number;
    pattern?: RegExp;
    mustContain?: string | string[];
    mustNotContain?: string | string[];
    originalContent?: string;
    allowDebugPrefixes?: boolean;
};

type CrossPlatformContentOptions = {
    allowPlatformSpecificContent?: boolean;
    allowDebugPrefixes?: boolean;
};

type GiftNotificationExpectations = {
    platform?: string;
    minAmount?: number;
    allowedCurrencies?: string[];
    requiredCurrency?: string;
};

type PlatformBehaviorExpectations = {
    requiredMethods?: string[];
    shouldProcessAsync?: boolean;
    shouldReturnBoolean?: boolean;
    shouldHandleErrors?: boolean;
    expectedErrorTypes?: string[];
    expectedMockType?: string;
};

type ValidationResult = UnknownRecord & {
    isValid?: unknown;
    validationSource?: unknown;
};

type UnifiedBehaviorOptions = {
    scenario: string;
    results: unknown[];
    expectedOutcome: unknown;
};

type HttpBehavior = UnknownRecord & {
    standardHeaders?: Record<string, unknown>;
    requestTimeout?: unknown;
    maxRetries?: unknown;
    category?: unknown;
    userMessage?: unknown;
};

type RequestPattern = UnknownRecord & {
    requestTimeout?: unknown;
    retryTimeout?: unknown;
    maxRetries?: unknown;
    backoffMultiplier?: unknown;
    actions?: string[];
    priority?: unknown;
    queuePosition?: unknown;
    parsedFields?: string[];
    builderSource?: unknown;
    operationSource?: unknown;
};

type OrderedMockCall = {
    method: string;
    callIndex: number;
    order: number;
};

const isRecord = (value: unknown): value is UnknownRecord => {
    return typeof value === 'object' && value !== null;
};

const hasOwn = (value: UnknownRecord, key: string): boolean => {
    return Object.prototype.hasOwnProperty.call(value, key);
};

const getErrorMessage = (error: unknown): string => {
    return error instanceof Error ? error.message : String(error);
};

const getStringArray = (value: unknown): string[] => {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
};

const requireRecord = (value: unknown, name: string): UnknownRecord => {
    if (!isRecord(value)) {
        throw new Error(`${name} must be an object`);
    }

    return value;
};

const expectValidNotification = (notification: unknown, expectedType: string, expectedPlatform: string): void => {
    const notificationRecord = requireRecord(notification, 'Notification');
    const requiredFields = [
        'id', 'type', 'platform', 'username', 'displayMessage',
        'ttsMessage', 'logMessage', 'processedAt', 'timestamp'
    ];
    
    requiredFields.forEach(field => {
        if (!hasOwn(notificationRecord, field)) {
            throw new Error(`Missing required notification field: ${field}`);
        }
        
        if (notificationRecord[field] === null || notificationRecord[field] === undefined) {
            throw new Error(`Notification field '${field}' cannot be null or undefined`);
        }
    });
    
    if (notificationRecord.type !== expectedType) {
        throw new Error(
            `Notification type mismatch. Expected: ${expectedType}, Got: ${notificationRecord.type}`
        );
    }
    
    if (notificationRecord.platform !== expectedPlatform) {
        throw new Error(
            `Notification platform mismatch. Expected: ${expectedPlatform}, Got: ${notificationRecord.platform}`
        );
    }
    
    if (typeof notificationRecord.username !== 'string' || !notificationRecord.username.trim()) {
        throw new Error('Notification must have a valid username');
    }
    
    if (typeof notificationRecord.processedAt !== 'number') {
        throw new Error('processedAt must be a numeric timestamp');
    }
    
    if (typeof notificationRecord.timestamp !== 'string' || isNaN(Date.parse(notificationRecord.timestamp))) {
        throw new Error('timestamp must be a valid ISO date string');
    }
    
    validatePlatformSpecificNotification(notificationRecord, expectedType, expectedPlatform);
    
    if (typeof notificationRecord.displayMessage !== 'string' || !notificationRecord.displayMessage.trim()) {
        throw new Error('displayMessage cannot be empty');
    }
    
    if (typeof notificationRecord.ttsMessage !== 'string' || !notificationRecord.ttsMessage.trim()) {
        throw new Error('ttsMessage cannot be empty');
    }
};

const validatePlatformSpecificNotification = (notification: UnknownRecord, type: NotificationType, platform: string): void => {
    if (type === 'platform:gift') {
        if (!hasOwn(notification, 'giftType')) {
            throw new Error('Gift notifications must have giftType field');
        }
        if (!hasOwn(notification, 'giftCount')) {
            throw new Error('Gift notifications must have giftCount field');
        }
        if (!hasOwn(notification, 'amount')) {
            throw new Error('Gift notifications must have amount field');
        }
        if (!hasOwn(notification, 'currency')) {
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
            if (type === 'platform:gift') {
                if (!hasOwn(notification, 'giftType')) {
                    throw new Error('YouTube gifts must have giftType field');
                }
                if (!hasOwn(notification, 'amount')) {
                    throw new Error('YouTube gifts must have amount field');
                }
                if (!hasOwn(notification, 'currency')) {
                    throw new Error('YouTube gifts must have currency field');
                }
            }
            break;
            
        case 'twitch':
            if (type === 'platform:paypiggy' || type === 'platform:giftpaypiggy') {
                if (hasOwn(notification, 'tier') && !['1000', '2000', '3000'].includes(String(notification.tier))) {
                    throw new Error('Twitch paypiggy tier must be 1000, 2000, or 3000');
                }
            }
            if (type === 'platform:raid') {
                if (!hasOwn(notification, 'viewerCount')) {
                    throw new Error('Twitch raid must have viewerCount field');
                }
                if (typeof notification.viewerCount !== 'number' || notification.viewerCount <= 0) {
                    throw new Error('Twitch raid viewerCount must be a positive number');
                }
            }
            break;
            
        case 'tiktok':
            if (type === 'platform:gift') {
                if (!hasOwn(notification, 'giftType')) {
                    throw new Error('TikTok gift must have giftType field');
                }
                if (!hasOwn(notification, 'giftCount')) {
                    throw new Error('TikTok gift must have giftCount field');
                }
                if (typeof notification.giftCount !== 'number' || notification.giftCount < 0) {
                    throw new Error('TikTok gift count must be a non-negative number');
                }
            }
            break;
    }
};

const expectNotificationContent = (notification: unknown, patterns: Record<string, RegExp>): void => {
    const notificationRecord = requireRecord(notification, 'Notification');
    Object.keys(patterns).forEach(field => {
        if (!hasOwn(notificationRecord, field)) {
            throw new Error(`Notification missing expected content field: ${field}`);
        }
        
        const pattern = patterns[field];
        const content = notificationRecord[field];
        if (!pattern) {
            throw new Error(`Notification missing expected content pattern for ${field}`);
        }
        
        if (!pattern.test(String(content))) {
            throw new Error(
                `Notification content pattern mismatch for ${field}. ` +
                `Expected pattern: ${pattern}, Got: "${content}"`
            );
        }
    });
};

const expectNotificationTiming = (notification: unknown, expectedTiming: NotificationTimingExpectations): void => {
    const notificationRecord = requireRecord(notification, 'Notification');
    const now = testClock.now();
    const processedAt = notificationRecord.processedAt;
    const createdAt = typeof notificationRecord.createdAt === 'number' ? notificationRecord.createdAt : processedAt;
    if (typeof processedAt !== 'number' || typeof createdAt !== 'number') {
        throw new Error('Notification timing requires numeric processedAt and createdAt values');
    }
    
    if (expectedTiming.maxProcessingDelay) {
        const processingDelay = processedAt - createdAt;
        if (processingDelay > expectedTiming.maxProcessingDelay) {
            throw new Error(
                `Notification processing delay exceeded maximum. ` +
                `Expected: <=${expectedTiming.maxProcessingDelay}ms, Got: ${processingDelay}ms`
            );
        }
    }
    
    if (expectedTiming.timestampTolerance) {
        const timestampMs = new Date(String(notificationRecord.timestamp)).getTime();
        const timeDiff = Math.abs(timestampMs - processedAt);
        if (timeDiff > expectedTiming.timestampTolerance) {
            throw new Error(
                `Notification timestamp differs too much from processedAt. ` +
                `Expected difference: <=${expectedTiming.timestampTolerance}ms, Got: ${timeDiff}ms`
            );
        }
    }
    
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

const expectNotificationSequence = (notifications: unknown[], expectedOrder: NotificationOrder | string): void => {
    if (!Array.isArray(notifications) || notifications.length < 2) {
        return;
    }
    const notificationRecords = notifications.map((notification, index) => requireRecord(notification, `Notification ${index}`));
    
    switch (expectedOrder) {
        case 'priority_desc':
            for (let i = 1; i < notificationRecords.length; i++) {
                const previousNotification = notificationRecords[i - 1];
                const currentNotification = notificationRecords[i];
                const prev = typeof previousNotification?.priority === 'number' ? previousNotification.priority : 0;
                const curr = typeof currentNotification?.priority === 'number' ? currentNotification.priority : 0;
                if (prev < curr) {
                    throw new Error(
                        `Notification sequence not in priority descending order at index ${i}. ` +
                        `Previous priority: ${prev}, Current priority: ${curr}`
                    );
                }
            }
            break;
            
        case 'timestamp_asc':
            for (let i = 1; i < notificationRecords.length; i++) {
                const prev = notificationRecords[i - 1]?.processedAt;
                const curr = notificationRecords[i]?.processedAt;
                if (typeof prev !== 'number' || typeof curr !== 'number') {
                    throw new Error('Notification sequence requires numeric processedAt values');
                }
                if (prev > curr) {
                    throw new Error(
                        `Notification sequence not in timestamp ascending order at index ${i}. ` +
                        `Previous timestamp: ${prev}, Current timestamp: ${curr}`
                    );
                }
            }
            break;
            
        case 'timestamp_desc':
            for (let i = 1; i < notificationRecords.length; i++) {
                const prev = notificationRecords[i - 1]?.processedAt;
                const curr = notificationRecords[i]?.processedAt;
                if (typeof prev !== 'number' || typeof curr !== 'number') {
                    throw new Error('Notification sequence requires numeric processedAt values');
                }
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

const expectYouTubeEventProcessing = (eventData: unknown, expectedOutcome: YouTubeExpectedOutcome): void => {
    const eventRecord = requireRecord(eventData, 'YouTube event');
    const item = isRecord(eventRecord.item) ? eventRecord.item : null;
    if (!item) {
        throw new Error('YouTube event must have item property');
    }
    
    const eventType = String(item.type);
    const expectedTypes: Record<string, string> = {
        'membership': 'LiveChatMembershipItem',
        'chat': 'LiveChatTextMessage'
    };

    if (expectedOutcome.notificationType === 'platform:gift') {
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
    
    if (eventType === 'LiveChatPaidMessage' || eventType === 'LiveChatPaidSticker') {
        if (!item.purchase_amount) {
            throw new Error('YouTube paid event must have purchase_amount field');
        }
        
        if (!/^[\$€£¥]?\d+\.\d{2}$/.test(String(item.purchase_amount))) {
            throw new Error(
                `YouTube purchase amount has invalid format: ${item.purchase_amount}`
            );
        }
    }
    
    const authorDetails = isRecord(item.authorDetails) ? item.authorDetails : null;
    if (!authorDetails) {
        throw new Error('YouTube event must have authorDetails');
    }
    
    const requiredAuthorFields = ['channelId', 'displayName'];
    requiredAuthorFields.forEach(field => {
        if (!hasOwn(authorDetails, field)) {
            throw new Error(`YouTube event authorDetails missing field: ${field}`);
        }
    });
};

const expectTwitchEventSubHandling = (eventData: unknown, expectedCallbacks?: unknown): void => {
    const eventRecord = requireRecord(eventData, 'Twitch EventSub event');
    const subscription = isRecord(eventRecord.subscription) ? eventRecord.subscription : null;
    const event = isRecord(eventRecord.event) ? eventRecord.event : null;
    const metadata = isRecord(eventRecord.metadata) ? eventRecord.metadata : null;

    if (!subscription) {
        throw new Error('Twitch EventSub event must have subscription property');
    }
    
    if (!event) {
        throw new Error('Twitch EventSub event must have event property');
    }
    
    if (!metadata) {
        throw new Error('Twitch EventSub event must have metadata property');
    }
    
    const requiredSubFields = ['id', 'type', 'version', 'status', 'condition'];
    requiredSubFields.forEach(field => {
        if (!hasOwn(subscription, field)) {
            throw new Error(`Twitch EventSub subscription missing field: ${field}`);
        }
    });
    
    const requiredMetaFields = ['message_id', 'message_type', 'message_timestamp'];
    requiredMetaFields.forEach(field => {
        if (!hasOwn(metadata, field)) {
            throw new Error(`Twitch EventSub metadata missing field: ${field}`);
        }
    });
    
    if (metadata.message_type !== 'notification') {
        throw new Error(
            `Twitch EventSub message_type should be 'notification', got: ${metadata.message_type}`
        );
    }
    
    const subType = String(subscription.type);
    validateTwitchEventSubEventData(event, subType);
    
    if (expectedCallbacks && !Array.isArray(expectedCallbacks)) {
        throw new Error('expectedCallbacks must be an array');
    }
};

const validateTwitchEventSubEventData = (eventData: UnknownRecord, subscriptionType: string): void => {
    const commonFields = ['user_id', 'user_login', 'user_name', 'broadcaster_user_id', 'broadcaster_user_login', 'broadcaster_user_name'];
    
    switch (subscriptionType) {
        case 'channel.follow':
            const followFields = [...commonFields, 'followed_at'];
            followFields.forEach(field => {
                if (!hasOwn(eventData, field)) {
                    throw new Error(`Twitch follow event missing field: ${field}`);
                }
            });
            break;
            
        case 'channel.subscribe':
            const subFields = [...commonFields, 'tier', 'is_gift'];
            subFields.forEach(field => {
                if (!hasOwn(eventData, field)) {
                    throw new Error(`Twitch subscription event missing field: ${field}`);
                }
            });
            break;
            
        case 'channel.raid':
            const raidFields = ['from_broadcaster_user_id', 'from_broadcaster_user_login', 'from_broadcaster_user_name', 
                               'to_broadcaster_user_id', 'to_broadcaster_user_login', 'to_broadcaster_user_name', 'viewers'];
            raidFields.forEach(field => {
                if (!hasOwn(eventData, field)) {
                    throw new Error(`Twitch raid event missing field: ${field}`);
                }
            });
            break;
    }
};

const expectTikTokGiftAggregation = (giftEvents: unknown[], expectedAggregation: GiftAggregationExpectations): void => {
    if (!Array.isArray(giftEvents)) {
        throw new Error('giftEvents must be an array');
    }
    const giftEventRecords = giftEvents.map((event, index) => requireRecord(event, `Gift event ${index}`));
    
    if (giftEventRecords.length === 0) {
        if (expectedAggregation.totalGifts > 0) {
            throw new Error('Expected gifts but received empty array');
        }
        return;
    }
    
    const actualTotal = giftEventRecords.reduce((sum, event) => {
        if (!event.giftCount || typeof event.giftCount !== 'number') {
            throw new Error('Each gift event must have a numeric giftCount');
        }
        return sum + event.giftCount;
    }, 0);
    
    if (expectedAggregation.totalGifts !== actualTotal) {
        throw new Error(
            `Gift aggregation total mismatch. Expected: ${expectedAggregation.totalGifts}, ` +
            `Got: ${actualTotal}`
        );
    }
    
    if (expectedAggregation.giftType) {
        const giftTypes = [...new Set(giftEventRecords.map((event) => {
            if (!event.giftType) {
                throw new Error('Gift aggregation events require giftType');
            }
            return String(event.giftType);
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
    
    if (expectedAggregation.hasOwnProperty('shouldAggregate')) {
        const timeWindow = 5000;
        const timestamps = giftEventRecords.map(e => typeof e.timestamp === 'number' ? e.timestamp : testClock.now());
        const timeSpan = Math.max(...timestamps) - Math.min(...timestamps);
        const actualShouldAggregate = timeSpan <= timeWindow && giftEventRecords.length > 1;
        
        if (expectedAggregation.shouldAggregate !== actualShouldAggregate) {
            throw new Error(
                `Gift aggregation decision mismatch. Expected shouldAggregate: ${expectedAggregation.shouldAggregate}, ` +
                `Got: ${actualShouldAggregate} (timeSpan: ${timeSpan}ms, count: ${giftEventRecords.length})`
            );
        }
    }
};

const expectOBSIntegration = (obsCommands: unknown[], expectedSceneChanges: Partial<ObsCommandCounts>): void => {
    if (!Array.isArray(obsCommands)) {
        throw new Error('obsCommands must be an array');
    }
    const commandRecords = obsCommands.map((command, index) => requireRecord(command, `OBS command ${index}`));
    
    const commandCounts = {
        textUpdates: 0,
        effectTriggers: 0,
        sceneChanges: 0,
        filterChanges: 0
    };
    
    commandRecords.forEach((command, index) => {
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
    
    Object.keys(expectedSceneChanges).forEach(countType => {
        if (hasOwn(commandCounts, countType)) {
            const key = countType as keyof ObsCommandCounts;
            const expected = expectedSceneChanges[key];
            const actual = commandCounts[key];
            if (expected !== actual) {
                throw new Error(
                    `OBS ${countType} count mismatch. Expected: ${expected}, Got: ${actual}`
                );
            }
        }
    });
};

const expectOnlyMethodCalled = (mockObject: unknown, methodName: string, expectedArgs?: unknown[]): void => {
    const mockRecord = requireRecord(mockObject, 'Mock object') as MockFactoryObject;
    if (!mockRecord._mockType) {
        throw new Error('Object is not a factory-created mock');
    }
    
    const mockMethod = mockRecord[methodName];
    if (!isMockFunction(mockMethod)) {
        throw new Error(`${methodName} is not a mock function`);
    }
    
    if (mockMethod.mock.calls.length === 0) {
        throw new Error(`Expected ${methodName} to be called but it was not called`);
    }
    
    if (expectedArgs) {
        const actualArgs = mockMethod.mock.calls[0];
        if (JSON.stringify(actualArgs) !== JSON.stringify(expectedArgs)) {
            throw new Error(
                `${methodName} called with wrong arguments. ` +
                `Expected: ${JSON.stringify(expectedArgs)}, Got: ${JSON.stringify(actualArgs)}`
            );
        }
    }
    
    const validMethods = getStringArray(mockRecord._validMethods);
    const calledMethods = validMethods.filter(method => {
        const candidate = mockRecord[method];
        return isMockFunction(candidate) && candidate.mock.calls.length > 0;
    });
    
    if (calledMethods.length > 1 || (calledMethods.length === 1 && calledMethods[0] !== methodName)) {
        throw new Error(
            `Unexpected method calls detected. Expected only ${methodName}, ` +
            `but these methods were called: ${calledMethods.join(', ')}`
        );
    }
};

const expectMethodCallSequence = (mockObject: unknown, expectedSequence: string[]): void => {
    const mockRecord = requireRecord(mockObject, 'Mock object') as MockFactoryObject;
    if (!mockRecord._mockType) {
        throw new Error('Object is not a factory-created mock');
    }
    
    const allCalls: OrderedMockCall[] = [];
    const validMethods = getStringArray(mockRecord._validMethods);
    
    validMethods.forEach(methodName => {
        const mockMethod = mockRecord[methodName];
        if (isMockFunction(mockMethod)) {
            mockMethod.mock.calls.forEach((_args, callIndex) => {
                allCalls.push({
                    method: methodName,
                    callIndex: callIndex,
                    order: mockMethod.mock.invocationCallOrder?.[callIndex] ?? allCalls.length
                });
            });
        }
    });
    
    allCalls.sort((a, b) => a.order - b.order);
    
    const actualSequence = allCalls.map(call => call.method);
    
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

const expectNoUnexpectedCalls = (mockObject: unknown, allowedMethods: string[]): void => {
    const mockRecord = requireRecord(mockObject, 'Mock object') as MockFactoryObject;
    if (!mockRecord._mockType) {
        throw new Error('Object is not a factory-created mock');
    }
    
    const validMethods = getStringArray(mockRecord._validMethods);
    const calledMethods = validMethods.filter(method => {
        const candidate = mockRecord[method];
        return isMockFunction(candidate) && candidate.mock.calls.length > 0;
    });
    
    const unexpectedMethods = calledMethods.filter(method => !allowedMethods.includes(method));
    
    if (unexpectedMethods.length > 0) {
        throw new Error(
            `Unexpected methods were called: ${unexpectedMethods.join(', ')}. ` +
            `Only these methods are allowed: ${allowedMethods.join(', ')}`
        );
    }
};

const expectMockCallPattern = (mockObject: unknown, pattern: MockCallPattern): void => {
    const mockRecord = requireRecord(mockObject, 'Mock object') as MockFactoryObject;
    if (!mockRecord._mockType) {
        throw new Error('Object is not a factory-created mock');
    }
    
    Object.keys(pattern).forEach(methodName => {
        const mockMethod = mockRecord[methodName];
        if (!isMockFunction(mockMethod)) {
            throw new Error(`${methodName} is not a mock function`);
        }
        
        const expectedPattern = pattern[methodName];
        if (expectedPattern === undefined) {
            throw new Error(`${methodName} missing expected call pattern`);
        }
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

const expectPlatformEventStructure = (event: unknown, platform: PlatformName | string, eventType: PlatformEventType): void => {
    const eventRecord = requireRecord(event, 'Platform event');
    switch (platform) {
        case 'youtube':
            const youtubeItem = isRecord(eventRecord.item) ? eventRecord.item : null;
            if (!youtubeItem) {
                throw new Error('YouTube event must have item property');
            }
            if (!youtubeItem.type) {
                throw new Error('YouTube event item must have type property');
            }
            if (!youtubeItem.authorDetails) {
                throw new Error('YouTube event item must have authorDetails property');
            }
            break;
            
        case 'tiktok':
            if (eventType === 'gift') {
                if (!eventRecord.gift) {
                    throw new Error('TikTok gift event must have gift property');
                }
                const user = isRecord(eventRecord.user) ? eventRecord.user : null;
                if (!user || !user.userId || !user.uniqueId) {
                    throw new Error('TikTok gift event must have nested userId and uniqueId properties');
                }
                if (typeof eventRecord.giftCount !== 'number') {
                    throw new Error('TikTok gift event must have numeric giftCount property');
                }
            }
            break;
            
        case 'twitch':
            if (eventType === 'follow' || eventType === 'subscribe' || eventType === 'raid') {
                if (!eventRecord.subscription) {
                    throw new Error('Twitch EventSub event must have subscription property');
                }
                if (!eventRecord.event) {
                    throw new Error('Twitch EventSub event must have event property');
                }
                if (!eventRecord.metadata) {
                    throw new Error('Twitch EventSub event must have metadata property');
                }
            }
            break;
            
        default:
            throw new Error(`Unknown platform: ${platform}`);
    }
};

const expectInternationalContentPreservation = (originalContent: string, processedContent: string): void => {
    if (originalContent !== processedContent) {
        if (originalContent.trim() === processedContent.trim()) {
            return;
        }
        
        const originalUnicodeCount = (originalContent.match(/[\u{80}-\u{10FFFF}]/gu) || []).length;
        const processedUnicodeCount = (processedContent.match(/[\u{80}-\u{10FFFF}]/gu) || []).length;
        
        if (originalUnicodeCount !== processedUnicodeCount) {
            throw new Error(
                `International content was corrupted during processing. ` +
                `Original Unicode chars: ${originalUnicodeCount}, Processed: ${processedUnicodeCount}`
            );
        }
        
        const lengthDiff = Math.abs(originalContent.length - processedContent.length);
        if (lengthDiff > originalContent.length * 0.1) { // More than 10% length change
            throw new Error(
                `International content was significantly altered during processing. ` +
                `Original: "${originalContent}", Processed: "${processedContent}"`
            );
        }
    }
};

const expectValidUserData = (userData: unknown): void => {
    if (!userData || typeof userData !== 'object') {
        throw new Error('Invalid user data: must be an object');
    }
    const userRecord = userData as UnknownRecord;
    
    const requiredFields = ['username'];
    requiredFields.forEach(field => {
        if (!hasOwn(userRecord, field)) {
            throw new Error(`Invalid user data: missing required field '${field}'`);
        }
        
        if (!userRecord[field] || typeof userRecord[field] !== 'string') {
            throw new Error(`Invalid user data: field '${field}' must be a non-empty string`);
        }
    });
    
    if (userRecord.userId && typeof userRecord.userId !== 'string') {
        throw new Error('Invalid user data: userId must be a string if provided');
    }
    
    if (userRecord.platform && !['youtube', 'twitch', 'tiktok'].includes(String(userRecord.platform))) {
        throw new Error(`Invalid user data: unknown platform '${userRecord.platform}'`);
    }
};

const expectValidGiftData = (giftData: unknown): void => {
    if (!giftData || typeof giftData !== 'object') {
        throw new Error('Invalid gift data: must be an object');
    }
    const giftRecord = giftData as UnknownRecord;
    
    const requiredFields = ['giftType', 'giftCount', 'username', 'amount', 'currency'];
    requiredFields.forEach(field => {
        if (!hasOwn(giftRecord, field)) {
            throw new Error(`Invalid gift data: missing required field '${field}'`);
        }
    });
    
    if (typeof giftRecord.giftType !== 'string' || !giftRecord.giftType.trim()) {
        throw new Error('Invalid gift data: giftType must be a non-empty string');
    }
    
    if (typeof giftRecord.giftCount !== 'number' || giftRecord.giftCount < 0) {
        throw new Error('Invalid gift data: giftCount must be a non-negative number');
    }
    
    if (typeof giftRecord.username !== 'string' || !giftRecord.username.trim()) {
        throw new Error('Invalid gift data: username must be a non-empty string');
    }

    if (typeof giftRecord.amount !== 'number' || giftRecord.amount < 0) {
        throw new Error('Invalid gift data: amount must be a non-negative number');
    }

    if (typeof giftRecord.currency !== 'string' || !giftRecord.currency.trim()) {
        throw new Error('Invalid gift data: currency must be a non-empty string');
    }
};

const expectValidStreamData = (streamData: unknown): void => {
    if (!streamData || typeof streamData !== 'object') {
        throw new Error('Invalid stream data: must be an object');
    }
    const streamRecord = streamData as UnknownRecord;
    
    const requiredFields = ['streamId', 'title', 'viewerCount', 'isLive', 'platform'];
    requiredFields.forEach(field => {
        if (!hasOwn(streamRecord, field)) {
            throw new Error(`Invalid stream data: missing required field '${field}'`);
        }
    });
    
    if (typeof streamRecord.streamId !== 'string' || !streamRecord.streamId.trim()) {
        throw new Error('Invalid stream data: streamId must be a non-empty string');
    }
    
    if (typeof streamRecord.title !== 'string') {
        throw new Error('Invalid stream data: title must be a string');
    }
    
    if (typeof streamRecord.viewerCount !== 'number' || streamRecord.viewerCount < 0) {
        throw new Error('Invalid stream data: viewerCount must be a non-negative number');
    }
    
    if (typeof streamRecord.isLive !== 'boolean') {
        throw new Error('Invalid stream data: isLive must be a boolean');
    }
    
    if (!['youtube', 'twitch', 'tiktok'].includes(String(streamRecord.platform))) {
        throw new Error(`Invalid stream data: unknown platform '${streamRecord.platform}'`);
    }
};

const expectInternationalContentSupport = (content: unknown, testData: unknown): void => {
    if (typeof content !== 'string') {
        throw new Error('Content must be a string');
    }
    
    if (!testData || typeof testData !== 'object') {
        throw new Error('Test data must be provided for international content validation');
    }
    const data = testData as InternationalTestData;
    
    if (data.originalUsername) {
        if (!content.includes(data.originalUsername)) {
            throw new Error(
                `International username not preserved. Expected "${data.originalUsername}" in "${content}"`
            );
        }
    }
    
    if (data.containsEmoji || data.originalUsername && /[\u{1F600}-\u{1F64F}]|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{1F700}-\u{1F77F}|\u{1F780}-\u{1F7FF}|\u{1F800}-\u{1F8FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}/u.test(data.originalUsername)) {
        const emojiPattern = /[\u{1F600}-\u{1F64F}]|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{1F700}-\u{1F77F}|\u{1F780}-\u{1F7FF}|\u{1F800}-\u{1F8FF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}/u;
        if (!emojiPattern.test(content)) {
            throw new Error(
                `Emoji characters not preserved in processed content: "${content}"`
            );
        }
    }
    
    if (data.currency && data.currency.symbol) {
        const currencySymbol = data.currency.symbol;
        if (!content.includes(currencySymbol)) {
            throw new Error(
                `Currency symbol "${currencySymbol}" not found in content: "${content}"`
            );
        }
    }
    
    if (data.language === 'arabic' || data.language === 'hebrew') {
        const rtlPattern = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F]/;
        if (data.originalUsername && rtlPattern.test(data.originalUsername)) {
            if (!rtlPattern.test(content)) {
                throw new Error(
                    `RTL characters not preserved for ${data.language} content: "${content}"`
                );
            }
        }
    }
    
    if (data.language === 'chinese' || data.language === 'japanese' || data.language === 'korean') {
        const cjkPattern = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/;
        if (data.originalUsername && cjkPattern.test(data.originalUsername)) {
            if (!cjkPattern.test(content)) {
                throw new Error(
                    `CJK characters not preserved for ${data.language} content: "${content}"`
                );
            }
        }
    }
    
    expectNoTechnicalArtifacts(content);
};

const expectUserFriendlyErrorMessage = (errorMessage: unknown, options: UserFriendlyErrorOptions = {}): void => {
    if (typeof errorMessage !== 'string') {
        throw new Error('Error message must be a string');
    }
    
    expectNoTechnicalArtifacts(errorMessage);
    
    const minLength = options.minLength || 10;
    if (errorMessage.trim().length < minLength) {
        throw new Error(
            `Error message too short. Minimum: ${minLength} characters, Got: ${errorMessage.trim().length}`
        );
    }
    
    if (/\d{3,}/.test(errorMessage) && !options.allowErrorCodes) {
        throw new Error(`Error message contains error codes: "${errorMessage}"`);
    }
    
    if (!/^[A-Z]/.test(errorMessage.trim())) {
        throw new Error(`Error message should start with capital letter: "${errorMessage}"`);
    }
    
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

const validateUserFacingString = (userVisibleString: unknown, requirements: UserFacingStringRequirements = {}): void => {
    if (typeof userVisibleString !== 'string') {
        throw new Error('User-visible content must be a string');
    }
    
    expectNoTechnicalArtifacts(userVisibleString, requirements);
    
    const minLength = requirements.minLength || 5;
    if (userVisibleString.trim().length < minLength) {
        throw new Error(
            `User-visible content too short. Minimum: ${minLength} characters, ` +
            `Got: ${userVisibleString.trim().length} ("${userVisibleString}")`
        );
    }
    
    if (userVisibleString !== userVisibleString.trim()) {
        throw new Error(
            `User-visible content has leading/trailing whitespace: "${userVisibleString}"`
        );
    }
    
    if (/\s{2,}/.test(userVisibleString)) {
        throw new Error(
            `User-visible content has multiple consecutive spaces: "${userVisibleString}"`
        );
    }
    
    if (/\(\s*\)|\[\s*\]/.test(userVisibleString)) {
        throw new Error(
            `User-visible content has empty parentheses/brackets: "${userVisibleString}"`
        );
    }
    
    if (requirements.pattern) {
        if (!requirements.pattern.test(userVisibleString)) {
            throw new Error(
                `User-visible content doesn't match expected pattern. ` +
                `Pattern: ${requirements.pattern}, Content: "${userVisibleString}"`
            );
        }
    }
    
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
    
    if (requirements.originalContent) {
        expectInternationalContentPreservation(requirements.originalContent, userVisibleString);
    }
};

const expectSuccessfulTemplateInterpolation = (templateString: unknown, interpolatedString: unknown, templateData: unknown): void => {
    if (typeof templateString !== 'string' || typeof interpolatedString !== 'string') {
        throw new Error('Template and interpolated strings must be strings');
    }
    
    const hasPlaceholders = /\{.*\}/.test(templateString);
    if (hasPlaceholders && templateString === interpolatedString) {
        throw new Error(
            `Template interpolation failed - result identical to template: "${templateString}"`
        );
    }
    
    expectNoTechnicalArtifacts(interpolatedString);
    
    if (templateData && typeof templateData === 'object') {
        const templateRecord = templateData as UnknownRecord;
        Object.keys(templateRecord).forEach(key => {
            const value = templateRecord[key];
            if (value !== null && value !== undefined && typeof value !== 'object') {
                const stringValue = String(value);
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

const expectContentReadabilityForAudience = (content: unknown, audience: Audience | string): void => {
    if (typeof content !== 'string') {
        throw new Error('Content must be a string');
    }
    
    const validAudiences = ['user', 'admin', 'developer'];
    if (!validAudiences.includes(audience)) {
        throw new Error(`Invalid audience. Must be one of: ${validAudiences.join(', ')}`);
    }
    
    switch (audience) {
        case 'user':
            if (/src\/|\.js|\.json|\.ini/.test(content)) {
                throw new Error(
                    `User-facing content contains file path references: "${content}"`
                );
            }
            
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
            if (/function|class|const |let |var /.test(content)) {
                throw new Error(
                    `Admin-facing content contains code syntax: "${content}"`
                );
            }
            break;
            
        case 'developer':
            if (content.length > 500) {
                throw new Error(
                    `Developer content too verbose (>500 chars): "${content.substring(0, 100)}..."`
                );
            }
            break;
    }
};

const expectCrossPlatformContentConsistency = (platformContents: Record<string, string>, options: CrossPlatformContentOptions = {}): void => {
    const platforms = Object.keys(platformContents);
    if (platforms.length < 2) {
        throw new Error('Need at least 2 platforms to check consistency');
    }
    
    platforms.forEach(platform => {
        const content = platformContents[platform];
        expectNoTechnicalArtifacts(content, options);
    });
    
    if (!options.allowPlatformSpecificContent) {
        const contentInfo = platforms.map(platform => {
            const content = platformContents[platform];
            return {
                platform,
                content,
                numbers: ((content ?? '').match(/\d+(?:\.\d+)?/g) || []).map(Number),
                quotedStrings: (content ?? '').match(/"([^"]*)"/g) || [],
                currencies: (content ?? '').match(/[$€£¥₹]/g) || []
            };
        });
        
        const firstInfo = contentInfo[0];
        if (!firstInfo) {
            throw new Error('Need at least 2 platforms to check consistency');
        }
        contentInfo.slice(1).forEach(info => {
            if (JSON.stringify(firstInfo.numbers.sort()) !== JSON.stringify(info.numbers.sort())) {
                throw new Error(
                    `Inconsistent numbers across platforms. ` +
                    `${firstInfo.platform}: [${firstInfo.numbers.join(', ')}], ` +
                    `${info.platform}: [${info.numbers.join(', ')}]`
                );
            }
            
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

const expectValidGiftNotification = (notification: unknown, expectedData: GiftNotificationExpectations = {}): void => {
    if (!notification || typeof notification !== 'object') {
        throw new Error('Gift notification must be an object');
    }
    const giftNotification = notification as UnknownRecord;
    
    expectValidNotification(giftNotification, 'platform:gift', expectedData.platform || String(giftNotification.platform));
    
    const requiredGiftFields = ['amount', 'currency'];
    requiredGiftFields.forEach(field => {
        if (!hasOwn(giftNotification, field)) {
            throw new Error(`Missing required field: ${field}`);
        }
    });
    
    if (typeof giftNotification.amount !== 'number' || giftNotification.amount <= 0) {
        throw new Error('Gift amount must be positive');
    }
    
    if (expectedData.minAmount && giftNotification.amount < expectedData.minAmount) {
        throw new Error(`Gift amount ${giftNotification.amount} is below minimum ${expectedData.minAmount}`);
    }
    
    if (typeof giftNotification.currency !== 'string' || !giftNotification.currency.trim()) {
        throw new Error('Gift currency must be a non-empty string');
    }
    
    if (expectedData.allowedCurrencies && !expectedData.allowedCurrencies.includes(giftNotification.currency)) {
        throw new Error(`Invalid currency: ${giftNotification.currency}`);
    }
    
    if (expectedData.requiredCurrency && giftNotification.currency !== expectedData.requiredCurrency) {
        throw new Error(`Expected currency ${expectedData.requiredCurrency}, got ${giftNotification.currency}`);
    }
    
    if (typeof giftNotification.displayMessage !== 'string' || !giftNotification.displayMessage.includes(giftNotification.amount.toString())) {
        throw new Error('Gift notification display message must include amount');
    }
    
    if (!giftNotification.displayMessage.includes(giftNotification.currency)) {
        throw new Error('Gift notification display message must include currency');
    }
    
    expectNoTechnicalArtifacts(giftNotification.displayMessage);
    expectNoTechnicalArtifacts(giftNotification.ttsMessage);
};

const expectValidPlatformBehavior = (platform: unknown, behaviorType: string, expectations: PlatformBehaviorExpectations = {}): void => {
    if (!platform || typeof platform !== 'object') {
        throw new Error('Platform must be an object');
    }
    const platformRecord = platform as UnknownRecord;
    
    if (expectations.requiredMethods) {
        expectations.requiredMethods.forEach(method => {
            if (!hasOwn(platformRecord, method)) {
                throw new Error(`Platform missing required method: ${method}`);
            }
            if (typeof platformRecord[method] !== 'function') {
                throw new Error(`Platform method ${method} must be a function`);
            }
        });
    }
    
    switch (behaviorType) {
        case 'message_processing':
            const processMessage = platformRecord.processMessage;
            if (typeof processMessage !== 'function') {
                throw new Error('Platform missing required method: processMessage');
            }
            if (expectations.shouldProcessAsync && !isMockFunction(processMessage)) {
                break;
            }
            if (expectations.shouldReturnBoolean && isMockFunction(processMessage)) {
                const mockReturn = (processMessage as TestMockFn & { getMockImplementation?: () => (() => unknown) | undefined }).getMockImplementation?.();
                const returned = mockReturn?.();
                if (mockReturn && typeof returned !== 'boolean' && !(isRecord(returned) && typeof returned.then === 'function')) {
                    throw new Error('Platform processMessage should return boolean or Promise<boolean>');
                }
            }
            break;
            
        case 'notification_handling':
            if (!platformRecord.handleNotification) {
                throw new Error('Platform missing required method: handleNotification');
            }
            break;
            
        case 'error_handling':
            if (expectations.shouldHandleErrors) {
                const processMessage = platformRecord.processMessage;
                if (typeof processMessage !== 'function') {
                    throw new Error('Platform missing required method: processMessage');
                }
                try {
                    const result = processMessage();
                    if (expectations.expectedErrorTypes && !result) {
                        throw new Error('Platform should handle errors gracefully');
                    }
                } catch (error) {
                    const errorMessage = getErrorMessage(error);
                    if (expectations.expectedErrorTypes && !expectations.expectedErrorTypes.some(type => errorMessage.includes(type))) {
                        throw new Error('Platform should handle errors gracefully');
                    }
                }
            }
            break;
    }
    
    if (platformRecord._mockType && expectations.expectedMockType) {
        if (platformRecord._mockType !== expectations.expectedMockType) {
            throw new Error(`Expected mock type ${expectations.expectedMockType}, got ${platformRecord._mockType}`);
        }
    }
};

const expectNoTechnicalArtifacts = (userVisibleString: unknown, options: { allowDebugPrefixes?: boolean } = {}): void => {
    if (typeof userVisibleString !== 'string') {
        throw new Error('User-visible content must be a string');
    }
    
    const violations = [];
    
    if (/\{.*".*".*\}/.test(userVisibleString)) {
        violations.push('Contains JSON structure');
    }
    
    if (/\[(DEBUG|ERROR|LOG|INFO|WARN|TRACE)\]/.test(userVisibleString)) {
        violations.push('Contains debug markers');
    }
    
    if (/(?:src|tests|node_modules|\.js|\.json|\.ini|\.md|\.ts|\.tsx)\//.test(userVisibleString)) {
        violations.push('Contains file paths');
    }
    
    if (/Error:\s*\d+|Code:\s*\d+|HTTP\s*\d{3}/.test(userVisibleString)) {
        violations.push('Contains error codes');
    }
    
    const technicalArtifacts = ['undefined', 'null', 'NaN', '[object Object]', 'TypeError', 'ReferenceError', 'SyntaxError'];
    technicalArtifacts.forEach(artifact => {
        if (userVisibleString.includes(artifact)) {
            violations.push(`Contains technical artifact "${artifact}"`);
        }
    });
    
    if (/mockObject|testData|fixture|stub|spy/.test(userVisibleString)) {
        violations.push('Contains test artifacts');
    }
    
    if (/\{[^}]*\}|\$\{[^}]*\}|%[A-Za-z_][A-Za-z0-9_]*%/.test(userVisibleString)) {
        violations.push('Contains template placeholders');
    }
    
    if (userVisibleString.includes('at ') && userVisibleString.includes('.js:')) {
        violations.push('Contains stack trace information');
    }
    
    if (!options.allowDebugPrefixes) {
        const debugPrefixes = ['DEBUG:', 'ERROR:', 'WARN:', 'INFO:', 'TRACE:', 'LOG:'];
        debugPrefixes.forEach(prefix => {
            if (userVisibleString.startsWith(prefix)) {
                violations.push(`Contains debug prefix "${prefix}"`);
            }
        });
    }
    
    if (/\/api\/|\/v\d+\/|localhost:\d+|127\.0\.0\.1/.test(userVisibleString)) {
        violations.push('Contains API endpoints or localhost references');
    }
    
    if (/\b(SELECT|INSERT|UPDATE|DELETE)\s+\w+/i.test(userVisibleString) || /\bWHERE\s+\w+\s*=/i.test(userVisibleString)) {
        violations.push('Contains SQL statements');
    }
    
    if (/[A-Z_]{3,}=|config\.|process\.env\./.test(userVisibleString)) {
        violations.push('Contains configuration references');
    }
    
    if (violations.length > 0) {
        throw new Error(`Technical artifacts detected: ${violations.join(', ')} in "${userVisibleString}"`);
    }
};

const expectProperCurrencyFormatting = (amount: unknown, currency: unknown, platform: unknown): void => {
    if (typeof amount !== 'number' || amount < 0) {
        throw new Error('Currency amount must be a non-negative number');
    }
    
    if (typeof currency !== 'string' || !currency.trim()) {
        throw new Error('Currency must be a non-empty string');
    }
    
    if (typeof platform !== 'string' || !platform.trim()) {
        throw new Error('Platform must be a non-empty string');
    }
    
    switch (platform.toLowerCase()) {
        case 'youtube':
            validateYouTubeCurrencyFormat(amount, currency);
            break;
            
        case 'tiktok':
            if (amount % 1 !== 0) {
                throw new Error('TikTok platform does not support fractional currency amounts');
            }
            break;
            
        case 'twitch':
            validateTwitchCurrencyFormat(amount, currency);
            break;
            
        default:
            validateGeneralCurrencyFormat(amount, currency);
    }
};

const validateYouTubeCurrencyFormat = (amount: number, currency: string): void => {
    const currencyRules: Record<string, { decimals: number; symbol: string }> = {
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
        if (decimalPlaces > rule.decimals) {
            throw new Error(`${currency} currency cannot have more than ${rule.decimals} decimal places`);
        }
    }
};

const validateTwitchCurrencyFormat = (amount: number, currency: string): void => {
    validateYouTubeCurrencyFormat(amount, currency);
};

const validateGeneralCurrencyFormat = (amount: number, currency: string): void => {
    if (amount < 0) {
        throw new Error('Currency amount cannot be negative');
    }
    
    const validCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'KRW', 'BRL', 'CAD', 'AUD'];
    if (!validCurrencies.includes(currency.toUpperCase())) {
        throw new Error(`Invalid currency format: ${currency}`);
    }
    
    const decimalPlaces = (amount.toString().split('.')[1] || '').length;
    if (decimalPlaces > 4) {
        throw new Error('Currency amount has too many decimal places');
    }
};

const expectConsistentValidation = (validationResults: unknown[]): void => {
    if (!Array.isArray(validationResults) || validationResults.length < 2) {
        throw new Error('expectConsistentValidation requires at least 2 validation results to compare');
    }
    const validationRecords = validationResults.map((result, index) => requireRecord(result, `Validation result ${index}`)) as ValidationResult[];
    
    const firstResult = validationRecords[0];
    if (!firstResult) {
        throw new Error('expectConsistentValidation requires at least 2 validation results to compare');
    }
    const requiredFields = ['isValid', 'validationSource'];
    
    validationRecords.forEach((result, index) => {
        requiredFields.forEach(field => {
            if (!hasOwn(result, field)) {
                throw new Error(`Validation result ${index} missing required field: ${field}`);
            }
        });
    });
    
    for (let i = 1; i < validationRecords.length; i++) {
        const currentResult = validationRecords[i];
        if (!currentResult) {
            throw new Error(`Validation result ${i} is missing`);
        }
        
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
    
    validationRecords.forEach((result, index) => {
        if (result.validationSource !== 'centralized_validator') {
            throw new Error(
                `Result ${index} does not use centralized validation. ` +
                `Expected: 'centralized_validator', Got: '${result.validationSource}'`
            );
        }
    });
};

const expectUnifiedBehavior = (options: UnifiedBehaviorOptions): void => {
    const { scenario, results, expectedOutcome } = options;
    
    if (!scenario || !results || !expectedOutcome) {
        throw new Error('expectUnifiedBehavior requires scenario, results, and expectedOutcome');
    }
    
    if (!Array.isArray(results) || results.length < 2) {
        throw new Error('expectUnifiedBehavior requires at least 2 results to compare');
    }
    const resultRecords = results.map((result, index) => requireRecord(result, `Result ${index}`));
    
    resultRecords.forEach((result, index) => {
        if (!hasOwn(result, 'validationSource')) {
            throw new Error(`Result ${index} missing validationSource field`);
        }
        
        if (result.validationSource !== 'centralized_validator') {
            throw new Error(
                `Result ${index} in scenario '${scenario}' does not use centralized validation. ` +
                `Expected: 'centralized_validator', Got: '${result.validationSource}'`
            );
        }
    });
    
    const firstResult = resultRecords[0];
    if (!firstResult) {
        throw new Error('expectUnifiedBehavior requires at least 2 results to compare');
    }
    const expectedFields = Object.keys(firstResult);
    
    for (let i = 1; i < resultRecords.length; i++) {
        const currentResult = resultRecords[i];
        if (!currentResult) {
            throw new Error(`Result ${i} is missing`);
        }
        
        expectedFields.forEach(field => {
            if (!hasOwn(currentResult, field)) {
                throw new Error(
                    `Inconsistent behavior in scenario '${scenario}': ` +
                    `result ${i} missing field '${field}' that exists in result 0`
                );
            }
        });
    }
    
    switch (scenario) {
        case 'token_validation':
        case 'standard-validation':
            resultRecords.forEach((result, index) => {
                if (!hasOwn(result, 'isValid')) {
                    throw new Error(`Result ${index} missing isValid field for token validation scenario`);
                }
            });
            break;
            
        case 'token_expiration_detection':
            resultRecords.forEach((result, index) => {
                if (!hasOwn(result, 'isExpired')) {
                    throw new Error(`Result ${index} missing isExpired field for expiration detection scenario`);
                }
            });
            break;
            
        case 'token_format_validation':
            resultRecords.forEach((result, index) => {
                if (!hasOwn(result, 'format')) {
                    throw new Error(`Result ${index} missing format field for format validation scenario`);
                }
            });
            break;
            
        case 'single_source_of_truth':
        case 'centralized_validation':
            resultRecords.forEach((result, index) => {
                if (!hasOwn(result, 'validationSteps')) {
                    throw new Error(`Result ${index} missing validationSteps field for centralized validation scenario`);
                }
                
                if (!Array.isArray(result.validationSteps)) {
                    throw new Error(`Result ${index} validationSteps must be an array`);
                }
            });
            break;
    }
};

const expectConsistentConfigBehavior = (configResults: unknown[]): void => {
    if (!Array.isArray(configResults) || configResults.length < 2) {
        throw new Error('expectConsistentConfigBehavior requires at least 2 config results to compare');
    }
    const configRecords = configResults.map((result, index) => requireRecord(result, `Config result ${index}`));
    
    configRecords.forEach((result, index) => {
        let targetValidation: UnknownRecord;
        if (hasOwn(result, 'validation') && isRecord(result.validation)) {
            targetValidation = result.validation;
        } else if (hasOwn(result, 'implementationType')) {
            targetValidation = result;
        } else {
            throw new Error(`Config result ${index} missing validation or implementationType field`);
        }
        
        if (!hasOwn(targetValidation, 'implementationType')) {
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

const expectUnifiedErrorHandling = (errorResults: unknown[]): void => {
    if (!Array.isArray(errorResults) || errorResults.length < 2) {
        throw new Error('expectUnifiedErrorHandling requires at least 2 error results to compare');
    }
    const errorRecords = errorResults.map((result, index) => requireRecord(result, `Error result ${index}`));
    
    const requiredFields = ['implementationType'];
    
    errorRecords.forEach((result, index) => {
        requiredFields.forEach(field => {
            if (!hasOwn(result, field)) {
                throw new Error(`Error result ${index} missing required field: ${field}`);
            }
        });
    });
    
    errorRecords.forEach((result, index) => {
        if (result.implementationType !== 'delegated_to_central') {
            throw new Error(
                `Result ${index} does not use centralized error handling. ` +
                `Expected: 'delegated_to_central', Got: '${result.implementationType}'`
            );
        }
    });
};

const expectConsistentHttpBehavior = (httpBehaviors: unknown[]): void => {
    if (!Array.isArray(httpBehaviors) || httpBehaviors.length < 2) {
        throw new Error('expectConsistentHttpBehavior requires at least 2 HTTP behavior objects to compare');
    }
    const behaviorRecords = httpBehaviors.map((behavior, index) => requireRecord(behavior, `HTTP behavior ${index}`)) as HttpBehavior[];
    
    const firstBehavior = behaviorRecords[0];
    if (!firstBehavior) {
        throw new Error('expectConsistentHttpBehavior requires at least 2 HTTP behavior objects to compare');
    }
    
    behaviorRecords.forEach((behavior, index) => {
        if (!behavior || typeof behavior !== 'object') {
            throw new Error(`HTTP behavior at index ${index} must be a valid object`);
        }
    });
    
    if (firstBehavior.standardHeaders) {
        const firstHeadersSource = firstBehavior.standardHeaders;
        behaviorRecords.forEach((behavior, index) => {
            if (!behavior.standardHeaders) {
                throw new Error(`HTTP behavior at index ${index} missing standardHeaders`);
            }
            
            const firstHeaders = Object.keys(firstHeadersSource).sort();
            const currentHeaders = Object.keys(behavior.standardHeaders).sort();
            
            if (JSON.stringify(firstHeaders) !== JSON.stringify(currentHeaders)) {
                throw new Error(`HTTP header structure inconsistent at index ${index}. Expected: ${firstHeaders.join(', ')}, Got: ${currentHeaders.join(', ')}`);
            }
        });
    }
    
    if (firstBehavior.requestTimeout !== undefined) {
        behaviorRecords.forEach((behavior, index) => {
            if (behavior.requestTimeout !== firstBehavior.requestTimeout) {
                throw new Error(`HTTP timeout inconsistent at index ${index}. Expected: ${firstBehavior.requestTimeout}, Got: ${behavior.requestTimeout}`);
            }
        });
    }
    
    if (firstBehavior.maxRetries !== undefined) {
        behaviorRecords.forEach((behavior, index) => {
            if (behavior.maxRetries !== firstBehavior.maxRetries) {
                throw new Error(`HTTP retry count inconsistent at index ${index}. Expected: ${firstBehavior.maxRetries}, Got: ${behavior.maxRetries}`);
            }
        });
    }
    
    if (firstBehavior.category !== undefined) {
        behaviorRecords.forEach((behavior, index) => {
            if (behavior.category !== firstBehavior.category) {
                throw new Error(`HTTP response category inconsistent at index ${index}. Expected: ${firstBehavior.category}, Got: ${behavior.category}`);
            }
        });
    }
    
    if (firstBehavior.userMessage !== undefined) {
        behaviorRecords.forEach((behavior, index) => {
            if (behavior.userMessage !== firstBehavior.userMessage) {
                throw new Error(`HTTP error message inconsistent at index ${index}. Expected: "${firstBehavior.userMessage}", Got: "${behavior.userMessage}"`);
            }
        });
    }
};

const expectUnifiedRequestPatterns = (requestPatterns: unknown[]): void => {
    if (!Array.isArray(requestPatterns) || requestPatterns.length < 2) {
        throw new Error('expectUnifiedRequestPatterns requires at least 2 request pattern objects to compare');
    }
    const requestRecords = requestPatterns.map((pattern, index) => requireRecord(pattern, `Request pattern ${index}`)) as RequestPattern[];
    
    const firstPattern = requestRecords[0];
    if (!firstPattern) {
        throw new Error('expectUnifiedRequestPatterns requires at least 2 request pattern objects to compare');
    }
    
    requestRecords.forEach((pattern, index) => {
        if (!pattern || typeof pattern !== 'object') {
            throw new Error(`Request pattern at index ${index} must be a valid object`);
        }
    });
    
    if (firstPattern.requestTimeout !== undefined || firstPattern.retryTimeout !== undefined) {
        requestRecords.forEach((pattern, index) => {
            if (pattern.requestTimeout !== firstPattern.requestTimeout) {
                throw new Error(`Request timeout pattern inconsistent at index ${index}. Expected: ${firstPattern.requestTimeout}, Got: ${pattern.requestTimeout}`);
            }
            
            if (pattern.retryTimeout !== firstPattern.retryTimeout) {
                throw new Error(`Retry timeout pattern inconsistent at index ${index}. Expected: ${firstPattern.retryTimeout}, Got: ${pattern.retryTimeout}`);
            }
        });
    }
    
    if (firstPattern.maxRetries !== undefined || firstPattern.backoffMultiplier !== undefined) {
        requestRecords.forEach((pattern, index) => {
            if (pattern.maxRetries !== firstPattern.maxRetries) {
                throw new Error(`Retry pattern inconsistent at index ${index}. Expected maxRetries: ${firstPattern.maxRetries}, Got: ${pattern.maxRetries}`);
            }
            
            if (pattern.backoffMultiplier !== firstPattern.backoffMultiplier) {
                throw new Error(`Backoff pattern inconsistent at index ${index}. Expected backoffMultiplier: ${firstPattern.backoffMultiplier}, Got: ${pattern.backoffMultiplier}`);
            }
        });
    }
    
    if (firstPattern.actions && Array.isArray(firstPattern.actions)) {
        const firstActions = firstPattern.actions;
        requestRecords.forEach((pattern, index) => {
            if (!pattern.actions || !Array.isArray(pattern.actions)) {
                throw new Error(`Lifecycle actions missing at index ${index}`);
            }
            
            if (JSON.stringify([...pattern.actions].sort()) !== JSON.stringify([...firstActions].sort())) {
                throw new Error(`Lifecycle actions inconsistent at index ${index}. Expected: [${firstActions.join(', ')}], Got: [${pattern.actions.join(', ')}]`);
            }
        });
    }
    
    if (firstPattern.priority !== undefined || firstPattern.queuePosition !== undefined) {
        requestRecords.forEach((pattern, index) => {
            if (pattern.priority !== firstPattern.priority) {
                throw new Error(`Priority pattern inconsistent at index ${index}. Expected: ${firstPattern.priority}, Got: ${pattern.priority}`);
            }
            
            if (pattern.queuePosition !== firstPattern.queuePosition) {
                throw new Error(`Queue position pattern inconsistent at index ${index}. Expected: ${firstPattern.queuePosition}, Got: ${pattern.queuePosition}`);
            }
        });
    }
    
    if (firstPattern.parsedFields && Array.isArray(firstPattern.parsedFields)) {
        const firstParsedFields = firstPattern.parsedFields;
        requestRecords.forEach((pattern, index) => {
            if (!pattern.parsedFields || !Array.isArray(pattern.parsedFields)) {
                throw new Error(`Parsed fields missing at index ${index}`);
            }
            
            if (JSON.stringify([...pattern.parsedFields].sort()) !== JSON.stringify([...firstParsedFields].sort())) {
                throw new Error(`Parsed fields inconsistent at index ${index}. Expected: [${firstParsedFields.join(', ')}], Got: [${pattern.parsedFields.join(', ')}]`);
            }
        });
    }
    
    if (firstPattern.builderSource !== undefined) {
        requestRecords.forEach((pattern, index) => {
            if (pattern.builderSource !== firstPattern.builderSource) {
                throw new Error(`Request builder source inconsistent at index ${index}. Expected: ${firstPattern.builderSource}, Got: ${pattern.builderSource}`);
            }
        });
    }
    
    if (firstPattern.operationSource !== undefined) {
        requestRecords.forEach((pattern, index) => {
            if (pattern.operationSource !== firstPattern.operationSource) {
                throw new Error(`Operation source inconsistent at index ${index}. Expected: ${firstPattern.operationSource}, Got: ${pattern.operationSource}`);
            }
        });
    }
};

export {
    expectValidNotification,
    expectNotificationContent,
    expectNotificationTiming,
    expectNotificationSequence,
    
    expectYouTubeEventProcessing,
    expectTwitchEventSubHandling,
    expectTikTokGiftAggregation,
    expectOBSIntegration,
    
    expectOnlyMethodCalled,
    expectMethodCallSequence,
    expectNoUnexpectedCalls,
    expectMockCallPattern,
    
    expectPlatformEventStructure,
    expectInternationalContentPreservation,
    expectValidUserData,
    expectValidGiftData,
    expectValidStreamData,
    
    expectNoTechnicalArtifacts,
    validateUserFacingString,
    expectSuccessfulTemplateInterpolation,
    expectContentReadabilityForAudience,
    expectCrossPlatformContentConsistency,
    
    expectValidGiftNotification,
    expectValidPlatformBehavior,
    expectProperCurrencyFormatting,
    
    expectInternationalContentSupport,
    expectUserFriendlyErrorMessage,
    createInternationalTestData,
    
    expectConsistentValidation,
    expectUnifiedBehavior,
    
    expectConsistentHttpBehavior,
    expectUnifiedRequestPatterns,
    
    expectConsistentConfigBehavior,
    expectUnifiedErrorHandling
};
