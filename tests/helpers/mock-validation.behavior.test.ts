const { describe, it, expect, beforeEach, afterEach } = require('bun:test');

const testClock = require('./test-clock');
const { createMockFn } = require('./bun-mock-utils');
const {
    API_CONTRACTS,
    validateMockContract,
    validateNotificationData,
    validatePlatformEventData,
    validateMockSuite,
    generateValidationSummary,
    setupMockValidation,
    toMatchContract,
    MockContractMonitor
} = require('./mock-validation');

const createNotificationDispatcherMock = (overrides = {}) => ({
    _mockType: 'NotificationDispatcher',
    dispatchSuperChat: createMockFn(async () => true),
    dispatchMembership: createMockFn(async () => true),
    dispatchGiftMembership: createMockFn(async () => true),
    dispatchSuperSticker: createMockFn(async () => true),
    dispatchFollow: createMockFn(async () => true),
    dispatchRaid: createMockFn(async () => true),
    dispatchMessage: createMockFn(async () => true),
    ...overrides
});

describe('mock-validation behavior', () => {
    let originalValidateMock;
    let originalValidateNotification;
    let originalValidatePlatformEvent;

    beforeEach(() => {
        testClock.reset();
        originalValidateMock = global.validateMock;
        originalValidateNotification = global.validateNotification;
        originalValidatePlatformEvent = global.validatePlatformEvent;
    });

    afterEach(() => {
        testClock.useRealTime();
        global.validateMock = originalValidateMock;
        global.validateNotification = originalValidateNotification;
        global.validatePlatformEvent = originalValidatePlatformEvent;
    });

    it('exposes API contracts for expected helper categories', () => {
        expect(API_CONTRACTS.NotificationDispatcher.requiredMethods.length).toBeGreaterThan(0);
        expect(API_CONTRACTS.NotificationBuilder.requiredReturnFields).toContain('processedAt');
        expect(API_CONTRACTS.Logger.requiredMethods).toEqual(['debug', 'info', 'warn', 'error']);
    });

    it('validates mock contracts for unknown, invalid, and valid dispatcher mocks', () => {
        const unknown = validateMockContract({ _mockType: 'Unknown' }, 'DoesNotExist');
        expect(unknown.success).toBe(false);
        expect(unknown.errors[0]).toContain('Unknown API contract');

        const invalid = validateMockContract({
            _mockType: 'WrongType',
            dispatchSuperChat: () => true
        }, 'NotificationDispatcher');
        expect(invalid.success).toBe(false);
        expect(invalid.errors.some((error) => error.includes('Missing required method'))).toBe(true);
        expect(invalid.warnings.some((warning) => warning.includes('not a mock function'))).toBe(true);
        expect(invalid.warnings.some((warning) => warning.includes('annotation mismatch'))).toBe(true);

        const valid = validateMockContract(createNotificationDispatcherMock(), 'NotificationDispatcher');
        expect(valid.success).toBe(true);
        expect(valid.errors).toHaveLength(0);
    });

    it('validates notification payload fields, types, and platform warnings', () => {
        const validPayload = {
            id: 'test-notification-id',
            type: 'platform:gift',
            platform: 'twitch',
            user: 'test-user',
            displayMessage: 'display',
            ttsMessage: 'tts',
            logMessage: 'log',
            processedAt: 1700000000000,
            timestamp: '2024-01-01T00:00:00.000Z'
        };
        const valid = validateNotificationData(validPayload);
        expect(valid.success).toBe(true);
        expect(valid.errors).toHaveLength(0);

        const invalid = validateNotificationData({
            id: 123,
            type: 123,
            platform: 'custom-platform',
            processedAt: 10.5,
            timestamp: 'not-a-date'
        });
        expect(invalid.success).toBe(false);
        expect(invalid.errors.some((error) => error.includes('Missing required notification field'))).toBe(true);
        expect(invalid.errors).toContain('Notification ID must be a string');
        expect(invalid.errors).toContain('Notification type must be a string');
        expect(invalid.errors).toContain('processedAt must be a timestamp integer');
        expect(invalid.errors).toContain('timestamp must be a valid ISO date string');
        expect(invalid.warnings).toContain('Unknown platform: custom-platform');
    });

    it('validates nested platform event requirements and unknown-rule warnings', () => {
        const youtubeChat = validatePlatformEventData({
            item: {
                type: 'LiveChatTextMessage',
                message: { text: 'hello' },
                authorDetails: { displayName: 'viewer' }
            }
        }, 'youtube', 'chat');
        expect(youtubeChat.success).toBe(true);

        const missingTwitchFollow = validatePlatformEventData({ event: { user_name: 'follower' } }, 'twitch', 'follow');
        expect(missingTwitchFollow.success).toBe(false);
        expect(missingTwitchFollow.errors).toContain('Missing required field: event.followed_at');

        const unknownRule = validatePlatformEventData({}, 'custom', 'event');
        expect(unknownRule.success).toBe(true);
        expect(unknownRule.warnings[0]).toContain('No validation rules defined');
    });

    it('builds batch validation reports and summaries with mixed results', () => {
        const suite = validateMockSuite([
            { contractName: 'NotificationDispatcher', mock: createNotificationDispatcherMock() },
            { contractName: 'NotificationDispatcher', mock: { _mockType: 'NotificationDispatcher' } }
        ]);

        expect(suite.overallSuccess).toBe(false);
        expect(suite.totalMocksValidated).toBe(2);
        expect(suite.totalErrors).toBeGreaterThan(0);
        expect(typeof suite.summary).toBe('string');
        expect(suite.summary).toContain('Mock Validation Summary');
        expect(suite.summary).toContain('Failed Validations');

        const summary = generateValidationSummary(suite.results);
        expect(summary).toContain('Successful: 1');
        expect(summary).toContain('Failed: 1');
    });

    it('integrates custom matcher setup and direct matcher helper outcomes', () => {
        setupMockValidation();

        expect(typeof global.validateMock).toBe('function');
        expect(typeof global.validateNotification).toBe('function');
        expect(typeof global.validatePlatformEvent).toBe('function');

        const goodMatch = toMatchContract(createNotificationDispatcherMock(), 'NotificationDispatcher');
        expect(goodMatch.pass).toBe(true);
        expect(goodMatch.message()).toContain('Expected mock not to match');

        const badMatch = toMatchContract({ _mockType: 'NotificationDispatcher' }, 'NotificationDispatcher');
        expect(badMatch.pass).toBe(false);
        expect(badMatch.message()).toContain('Mock failed NotificationDispatcher contract validation');
    });

    it('tracks registered mocks and validation history in the contract monitor', () => {
        const monitor = new MockContractMonitor();
        const dispatcher = createNotificationDispatcherMock();

        monitor.registerMock('dispatcher', dispatcher, 'NotificationDispatcher');
        const firstReport = monitor.validateAll();
        expect(firstReport.overallSuccess).toBe(true);
        expect(firstReport.totalMocksValidated).toBe(1);

        monitor.registerMock('invalid-dispatcher', { _mockType: 'NotificationDispatcher' }, 'NotificationDispatcher');
        const secondReport = monitor.validateAll();
        expect(secondReport.overallSuccess).toBe(false);
        expect(secondReport.totalMocksValidated).toBe(2);

        const history = monitor.getValidationHistory();
        expect(history).toHaveLength(2);
        expect(history[0].timestamp).toBeLessThanOrEqual(history[1].timestamp);

        monitor.reset();
        expect(monitor.getValidationHistory()).toHaveLength(0);
    });
});
