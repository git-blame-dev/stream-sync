const { describe, it, expect, beforeEach, afterEach } = require('bun:test');

const testClock = require('./test-clock');
const { createMockFn } = require('./bun-mock-utils');
const {
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
} = require('./assertion-helpers');

const createGiftNotification = (overrides = {}) => {
    const now = testClock.now();
    return {
        id: 'test-id',
        type: 'platform:gift',
        platform: 'tiktok',
        username: 'test-user',
        displayMessage: 'test-user sent 10 coins',
        ttsMessage: 'test user sent 10 coins',
        logMessage: 'gift received',
        processedAt: now,
        timestamp: new Date(now).toISOString(),
        giftType: 'Rose',
        giftCount: 1,
        amount: 10,
        currency: 'coins',
        ...overrides
    };
};

const createFactoryMock = () => {
    const primary = createMockFn();
    const secondary = createMockFn();
    return {
        _mockType: 'test-mock',
        _validMethods: ['primary', 'secondary'],
        primary,
        secondary
    };
};

describe('assertion-helpers behavior', () => {
    beforeEach(() => {
        testClock.reset();
    });

    afterEach(() => {
        testClock.useRealTime();
    });

    it('validates notification contracts and platform-specific gift fields', () => {
        const valid = createGiftNotification();
        expect(() => expectValidNotification(valid, 'platform:gift', 'tiktok')).not.toThrow();

        expect(() => expectValidNotification({ ...valid, type: 'platform:follow' }, 'platform:gift', 'tiktok'))
            .toThrow('Notification type mismatch');
        expect(() => expectValidNotification({ ...valid, platform: 'youtube' }, 'platform:gift', 'tiktok'))
            .toThrow('Notification platform mismatch');
        expect(() => expectValidNotification({ ...valid, username: '' }, 'platform:gift', 'tiktok'))
            .toThrow('valid username');
        expect(() => expectValidNotification({ ...valid, processedAt: 'bad' }, 'platform:gift', 'tiktok'))
            .toThrow('processedAt must be a numeric timestamp');
        expect(() => expectValidNotification({ ...valid, timestamp: 'not-a-date' }, 'platform:gift', 'tiktok'))
            .toThrow('timestamp must be a valid ISO date string');
        expect(() => expectValidNotification({ ...valid, displayMessage: '   ' }, 'platform:gift', 'tiktok'))
            .toThrow('displayMessage cannot be empty');
        expect(() => expectValidNotification({ ...valid, ttsMessage: '   ' }, 'platform:gift', 'tiktok'))
            .toThrow('ttsMessage cannot be empty');
        expect(() => expectValidNotification({ ...valid, giftType: '' }, 'platform:gift', 'tiktok'))
            .toThrow('Gift type must be a non-empty string');
        expect(() => expectValidNotification({ ...valid, giftCount: -1 }, 'platform:gift', 'tiktok'))
            .toThrow('Gift count must be a non-negative number');
        expect(() => expectValidNotification({ ...valid, amount: -1 }, 'platform:gift', 'tiktok'))
            .toThrow('Gift amount must be a non-negative number');

        const twitchRaid = {
            id: 'test-id',
            type: 'platform:raid',
            platform: 'twitch',
            username: 'test-user',
            displayMessage: 'test-user raided with 30 viewers',
            ttsMessage: 'test user raided with 30 viewers',
            logMessage: 'raid received',
            processedAt: testClock.now(),
            timestamp: new Date(testClock.now()).toISOString(),
            viewerCount: 30
        };
        expect(() => expectValidNotification(twitchRaid, 'platform:raid', 'twitch')).not.toThrow();
    });

    it('validates notification content patterns, timing windows, and ordering', () => {
        const notification = createGiftNotification();
        expect(() => expectNotificationContent(notification, { displayMessage: /test-user/, ttsMessage: /coins/ })).not.toThrow();
        expect(() => expectNotificationContent(notification, { missingField: /x/ })).toThrow('missing expected content field');
        expect(() => expectNotificationContent(notification, { displayMessage: /not-found/ })).toThrow('pattern mismatch');

        const createdAt = testClock.now();
        const timed = createGiftNotification({ createdAt, processedAt: createdAt + 50 });
        expect(() => expectNotificationTiming(timed, { maxProcessingDelay: 100, timestampTolerance: 1000, maxAge: 2000 })).not.toThrow();
        expect(() => expectNotificationTiming({ ...timed, processedAt: createdAt + 500 }, { maxProcessingDelay: 100 })).toThrow('delay exceeded');
        expect(() => expectNotificationTiming({ ...timed, timestamp: new Date(createdAt + 2000).toISOString() }, { timestampTolerance: 100 }))
            .toThrow('timestamp differs too much');

        const ordered = [
            createGiftNotification({ priority: 3, processedAt: 1 }),
            createGiftNotification({ priority: 2, processedAt: 2 }),
            createGiftNotification({ priority: 1, processedAt: 3 })
        ];
        expect(() => expectNotificationSequence(ordered, 'priority_desc')).not.toThrow();
        expect(() => expectNotificationSequence([ordered[1], ordered[0]], 'priority_desc')).toThrow('priority descending');
        expect(() => expectNotificationSequence(ordered, 'timestamp_asc')).not.toThrow();
        expect(() => expectNotificationSequence([ordered[2], ordered[1]], 'timestamp_asc')).toThrow('timestamp ascending');
        expect(() => expectNotificationSequence(ordered, 'timestamp_desc')).toThrow('timestamp descending');
        expect(() => expectNotificationSequence(ordered, 'unknown')).toThrow('Unknown expected order');
    });

    it('validates platform event assertions for youtube, twitch, tiktok, and obs', () => {
        const youtubePaid = {
            item: {
                type: 'LiveChatPaidMessage',
                purchase_amount: '$10.00',
                authorDetails: { channelId: 'test-channel', displayName: 'test-user' }
            }
        };
        expect(() => expectYouTubeEventProcessing(youtubePaid, { notificationType: 'platform:gift' })).not.toThrow();
        expect(() => expectYouTubeEventProcessing({ item: { type: 'LiveChatPaidMessage', purchase_amount: 'invalid', authorDetails: { channelId: 'a', displayName: 'b' } } }, { notificationType: 'platform:gift' }))
            .toThrow('invalid format');

        const twitchEvent = {
            subscription: { id: 'sub-id', type: 'channel.follow', version: '1', status: 'enabled', condition: {} },
            event: {
                user_id: 'u1', user_login: 'test-user', user_name: 'test-user',
                broadcaster_user_id: 'b1', broadcaster_user_login: 'test-broadcaster', broadcaster_user_name: 'test-broadcaster',
                followed_at: '2024-01-01T00:00:00.000Z'
            },
            metadata: { message_id: 'm1', message_type: 'notification', message_timestamp: '2024-01-01T00:00:00.000Z' }
        };
        expect(() => expectTwitchEventSubHandling(twitchEvent, ['onFollow'])).not.toThrow();
        expect(() => expectTwitchEventSubHandling({ ...twitchEvent, metadata: { ...twitchEvent.metadata, message_type: 'session_welcome' } }, []))
            .toThrow('message_type should be');
        expect(() => expectTwitchEventSubHandling(twitchEvent, 'bad')).toThrow('expectedCallbacks must be an array');

        const giftEvents = [
            { giftType: 'Rose', giftCount: 2, timestamp: 1000 },
            { giftType: 'Rose', giftCount: 3, timestamp: 2000 }
        ];
        expect(() => expectTikTokGiftAggregation(giftEvents, { totalGifts: 5, giftType: 'Rose', shouldAggregate: true })).not.toThrow();
        expect(() => expectTikTokGiftAggregation(giftEvents, { totalGifts: 4 })).toThrow('total mismatch');
        expect(() => expectTikTokGiftAggregation([{ giftType: 'Rose', giftCount: 2, timestamp: 1000 }, { giftType: 'Diamond', giftCount: 1, timestamp: 2000 }], { totalGifts: 3, giftType: 'Rose', shouldAggregate: true }))
            .toThrow('multiple types');

        const obsCommands = [
            { type: 'setTextSource', sourceName: 'source', text: 'hello' },
            { type: 'triggerMediaSource', sourceName: 'gift-vfx' },
            { type: 'setCurrentScene', sceneName: 'Main' },
            { type: 'setFilterEnabled', sourceName: 'source', filterName: 'blur', enabled: true }
        ];
        expect(() => expectOBSIntegration(obsCommands, { textUpdates: 1, effectTriggers: 1, sceneChanges: 1, filterChanges: 1 })).not.toThrow();
        expect(() => expectOBSIntegration([{ type: 'unknown' }], {})).toThrow('Unknown OBS command type');

        expect(() => expectPlatformEventStructure({ item: { type: 'x', authorDetails: {} } }, 'youtube')).not.toThrow();
        expect(() => expectPlatformEventStructure({ gift: {}, user: { userId: 'id', uniqueId: 'uid' }, giftCount: 1 }, 'tiktok', 'gift')).not.toThrow();
        expect(() => expectPlatformEventStructure(twitchEvent, 'twitch', 'follow')).not.toThrow();
        expect(() => expectPlatformEventStructure({}, 'unknown')).toThrow('Unknown platform');
    });

    it('validates mock interaction helper contracts', () => {
        const factoryMock = createFactoryMock();
        factoryMock.primary('one');

        expect(() => expectOnlyMethodCalled(factoryMock, 'primary', ['one'])).not.toThrow();
        expect(() => expectOnlyMethodCalled(factoryMock, 'primary', ['wrong'])).toThrow('wrong arguments');

        factoryMock.secondary('two');
        expect(() => expectOnlyMethodCalled(factoryMock, 'primary')).toThrow('Unexpected method calls');

        const sequenced = createFactoryMock();
        sequenced.primary('a');
        sequenced.secondary('b');
        expect(() => expectMethodCallSequence(sequenced, ['primary', 'secondary'])).not.toThrow();
        expect(() => expectMethodCallSequence(sequenced, ['secondary', 'primary'])).toThrow('sequence mismatch');

        expect(() => expectNoUnexpectedCalls(sequenced, ['primary'])).toThrow('Unexpected methods were called');
        expect(() => expectNoUnexpectedCalls(sequenced, ['primary', 'secondary'])).not.toThrow();

        expect(() => expectMockCallPattern(sequenced, { primary: 1, secondary: { min: 1, max: 2 } })).not.toThrow();
        expect(() => expectMockCallPattern(sequenced, { primary: 2 })).toThrow('call count mismatch');
    });

    it('validates data structure and content integrity helpers', () => {
        expect(() => expectInternationalContentPreservation('  hola  ', 'hola')).not.toThrow();
        expect(() => expectInternationalContentPreservation('hello', 'different-long-output-value')).toThrow('significantly altered');

        expect(() => expectValidUserData({ username: 'test-user', userId: 'u1', platform: 'youtube' })).not.toThrow();
        expect(() => expectValidUserData({ username: '' })).toThrow('non-empty string');
        expect(() => expectValidUserData({ username: 'test-user', platform: 'unknown' })).toThrow('unknown platform');

        expect(() => expectValidGiftData({ giftType: 'Rose', giftCount: 1, username: 'test-user', amount: 10, currency: 'coins' })).not.toThrow();
        expect(() => expectValidGiftData({ giftType: 'Rose', giftCount: -1, username: 'test-user', amount: 10, currency: 'coins' })).toThrow('giftCount must be a non-negative number');

        expect(() => expectValidStreamData({ streamId: 's1', title: 'Test Stream', viewerCount: 42, isLive: true, platform: 'twitch' })).not.toThrow();
        expect(() => expectValidStreamData({ streamId: 's1', title: 'x', viewerCount: -1, isLive: true, platform: 'twitch' })).toThrow('viewerCount must be a non-negative number');

        expect(() => expectNoTechnicalArtifacts('test user sent 10 coins')).not.toThrow();
        expect(() => expectNoTechnicalArtifacts('DEBUG: stack trace at file.js:10')).toThrow('Technical artifacts detected');

        expect(() => validateUserFacingString('Thanks test-user for 10 coins', { minLength: 5, mustContain: 'test-user' })).not.toThrow();
        expect(() => validateUserFacingString('  hello world  ')).toThrow('leading/trailing whitespace');
        expect(() => validateUserFacingString('short', { minLength: 10 })).toThrow('too short');

        expect(() => expectSuccessfulTemplateInterpolation('Hello {username}', 'Hello test-user', { username: 'test-user' })).not.toThrow();
        expect(() => expectSuccessfulTemplateInterpolation('Hello {username}', 'Hello {username}', { username: 'test-user' })).toThrow('interpolation failed');

        expect(() => expectContentReadabilityForAudience('Your gift was displayed successfully', 'user')).not.toThrow();
        expect(() => expectContentReadabilityForAudience('This uses API middleware', 'user')).toThrow('technical term');
        expect(() => expectContentReadabilityForAudience('const x = 1;', 'admin')).toThrow('code syntax');
        expect(() => expectContentReadabilityForAudience('a'.repeat(501), 'developer')).toThrow('too verbose');

        expect(() => expectCrossPlatformContentConsistency(
            {
                youtube: 'test-user sent $10.00',
                twitch: 'test-user sent $10.00'
            },
            { allowPlatformSpecificContent: false }
        )).not.toThrow();
        expect(() => expectCrossPlatformContentConsistency(
            {
                youtube: 'test-user sent $10.00',
                twitch: 'test-user sent $11.00'
            },
            { allowPlatformSpecificContent: false }
        )).toThrow('Inconsistent numbers');
    });

    it('validates gift, platform behavior, and currency formatting helpers', () => {
        const validGift = createGiftNotification({ amount: 5, currency: 'USD', displayMessage: 'test-user sent 5 USD', ttsMessage: 'test-user sent 5 USD' });
        expect(() => expectValidGiftNotification(validGift, { platform: 'tiktok', minAmount: 1, allowedCurrencies: ['USD', 'coins'] })).not.toThrow();
        expect(() => expectValidGiftNotification({ ...validGift, amount: 0 }, { platform: 'tiktok' })).toThrow('amount must be positive');

        const messagePlatform = {
            processMessage: createMockFn(() => true),
            handleNotification: () => {}
        };
        expect(() => expectValidPlatformBehavior(messagePlatform, 'message_processing', { requiredMethods: ['processMessage'], shouldReturnBoolean: true })).not.toThrow();
        expect(() => expectValidPlatformBehavior(messagePlatform, 'notification_handling')).not.toThrow();
        expect(() => expectValidPlatformBehavior({ processMessage: () => { throw new Error('expected-failure'); } }, 'error_handling', { shouldHandleErrors: true, expectedErrorTypes: ['expected'] })).not.toThrow();
        expect(() => expectValidPlatformBehavior({}, 'message_processing', { requiredMethods: ['processMessage'] })).toThrow('missing required method');

        expect(() => expectProperCurrencyFormatting(10.25, 'USD', 'youtube')).not.toThrow();
        expect(() => expectProperCurrencyFormatting(10.123, 'USD', 'youtube')).toThrow('cannot have more than 2 decimal places');
        expect(() => expectProperCurrencyFormatting(10.5, 'coins', 'tiktok')).toThrow('does not support fractional');
        expect(() => expectProperCurrencyFormatting(10, 'BAD', 'other')).toThrow('Invalid currency format');
    });

    it('validates international support and user-friendly error message helpers', () => {
        const intlData = createInternationalTestData();
        expect(intlData.emoji.username).toContain('🎮');

        expect(() => expectInternationalContentSupport('Thanks 李小明 $10', {
            originalUsername: intlData.chinese.username,
            currency: { symbol: '$' }
        })).not.toThrow();
        expect(() => expectInternationalContentSupport('Missing username', { originalUsername: 'محمد_أحمد', language: 'arabic' }))
            .toThrow('not preserved');

        expect(() => expectUserFriendlyErrorMessage('Please check your connection and try again', { requireGuidance: true })).not.toThrow();
        expect(() => expectUserFriendlyErrorMessage('api timeout occurred')).toThrow('should start with capital letter');
        expect(() => expectUserFriendlyErrorMessage('API request failed')).toThrow('technical term');
        expect(() => expectUserFriendlyErrorMessage('Invalid')).toThrow('too short');
    });

    it('validates consistency assertions for auth, config, errors, and request patterns', () => {
        const validations = [
            { isValid: true, validationSource: 'centralized_validator' },
            { isValid: true, validationSource: 'centralized_validator' }
        ];
        expect(() => expectConsistentValidation(validations)).not.toThrow();
        expect(() => expectConsistentValidation([{ isValid: true, validationSource: 'centralized_validator' }, { isValid: false, validationSource: 'centralized_validator' }]))
            .toThrow('Inconsistent validation results');

        expect(() => expectUnifiedBehavior({
            scenario: 'token_validation',
            results: [
                { validationSource: 'centralized_validator', isValid: true },
                { validationSource: 'centralized_validator', isValid: true }
            ],
            expectedOutcome: 'valid'
        })).not.toThrow();
        expect(() => expectUnifiedBehavior({
            scenario: 'token_expiration_detection',
            results: [
                { validationSource: 'centralized_validator', isExpired: false },
                { validationSource: 'wrong_source', isExpired: false }
            ],
            expectedOutcome: 'not-expired'
        })).toThrow('does not use centralized validation');

        expect(() => expectConsistentConfigBehavior([
            { validation: { implementationType: 'delegated_to_central' } },
            { implementationType: 'delegated_to_central' }
        ])).not.toThrow();
        expect(() => expectConsistentConfigBehavior([{ validation: { implementationType: 'local' } }, { validation: { implementationType: 'delegated_to_central' } }]))
            .toThrow('does not use centralized configuration');

        expect(() => expectUnifiedErrorHandling([
            { implementationType: 'delegated_to_central' },
            { implementationType: 'delegated_to_central' }
        ])).not.toThrow();
        expect(() => expectUnifiedErrorHandling([
            { implementationType: 'delegated_to_central' },
            { implementationType: 'legacy' }
        ])).toThrow('does not use centralized error handling');

        const httpBehaviors = [
            {
                standardHeaders: { Authorization: 'Bearer test', Accept: 'application/json' },
                requestTimeout: 5000,
                maxRetries: 3,
                category: 'ok',
                userMessage: 'Request completed'
            },
            {
                standardHeaders: { Authorization: 'Bearer test', Accept: 'application/json' },
                requestTimeout: 5000,
                maxRetries: 3,
                category: 'ok',
                userMessage: 'Request completed'
            }
        ];
        expect(() => expectConsistentHttpBehavior(httpBehaviors)).not.toThrow();
        expect(() => expectConsistentHttpBehavior([
            httpBehaviors[0],
            { ...httpBehaviors[1], requestTimeout: 1000 }
        ])).toThrow('timeout inconsistent');

        const requestPatterns = [
            {
                requestTimeout: 5000,
                retryTimeout: 1000,
                maxRetries: 3,
                backoffMultiplier: 2,
                actions: ['enqueue', 'execute', 'complete'],
                priority: 'high',
                queuePosition: 1,
                parsedFields: ['id', 'status'],
                builderSource: 'centralized_builder',
                operationSource: 'centralized_operation'
            },
            {
                requestTimeout: 5000,
                retryTimeout: 1000,
                maxRetries: 3,
                backoffMultiplier: 2,
                actions: ['complete', 'execute', 'enqueue'],
                priority: 'high',
                queuePosition: 1,
                parsedFields: ['status', 'id'],
                builderSource: 'centralized_builder',
                operationSource: 'centralized_operation'
            }
        ];
        expect(() => expectUnifiedRequestPatterns(requestPatterns)).not.toThrow();
        expect(() => expectUnifiedRequestPatterns([
            requestPatterns[0],
            { ...requestPatterns[1], maxRetries: 5 }
        ])).toThrow('Retry pattern inconsistent');
    });

    it('covers additional assertion-helper branch paths for migration parity', () => {
        const oldNotification = createGiftNotification({ processedAt: testClock.now() - 1000 });
        expect(() => expectNotificationTiming(oldNotification, { maxAge: 100 })).toThrow('too old');
        expect(() => expectNotificationSequence([createGiftNotification()], 'priority_desc')).not.toThrow();

        expect(() => expectPlatformEventStructure({}, 'youtube')).toThrow('item property');
        expect(() => expectPlatformEventStructure({ gift: {} }, 'tiktok', 'gift')).toThrow('nested userId');

        expect(() => expectInternationalContentPreservation('你好', 'plain-text')).toThrow('Unicode chars');
        expect(() => expectInternationalContentSupport('missing test data')).toThrow('Test data must be provided');

        expect(() => expectUserFriendlyErrorMessage('Please review details code 500', { allowErrorCodes: true })).not.toThrow();
        expect(() => expectCrossPlatformContentConsistency({ youtube: 'one platform only' })).toThrow('Need at least 2 platforms');

        const nonBooleanPlatform = {
            processMessage: createMockFn(() => 'not-boolean')
        };
        expect(() => expectValidPlatformBehavior(nonBooleanPlatform, 'message_processing', { shouldReturnBoolean: true }))
            .toThrow('should return boolean or Promise<boolean>');

        const artifactHeavyString = '[DEBUG] Error: 500 undefined mockObject ${name} at app.js:1 src/path /api/v1 localhost:3000 SELECT row WHERE id = 1 process.env.TEST_KEY';
        expect(() => expectNoTechnicalArtifacts(artifactHeavyString)).toThrow('Technical artifacts detected');

        expect(() => expectConsistentValidation([{ isValid: true }])).toThrow('at least 2 validation results');
        expect(() => expectUnifiedBehavior({ scenario: 'single_source_of_truth', results: [{ validationSource: 'centralized_validator' }, { validationSource: 'centralized_validator' }], expectedOutcome: 'ok' }))
            .toThrow('missing validationSteps');
        expect(() => expectConsistentHttpBehavior([{ requestTimeout: 1 }])).toThrow('at least 2 HTTP behavior objects');
        expect(() => expectUnifiedRequestPatterns([{ requestTimeout: 1 }])).toThrow('at least 2 request pattern objects');
        expect(() => expectConsistentConfigBehavior([{ foo: 'bar' }, { foo: 'baz' }])).toThrow('missing validation or implementationType');
        expect(() => expectUnifiedErrorHandling([{ implementationType: 'delegated_to_central' }, { other: 'x' }])).toThrow('missing required field');
    });
});
