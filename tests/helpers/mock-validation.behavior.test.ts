import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createMockFn } from './bun-mock-utils';
import {
    API_CONTRACTS,
    validateMockContract,
    validateNotificationData,
    validatePlatformEventData,
    validateMockSuite,
    generateValidationSummary,
    setupMockValidation,
    toMatchContract,
    MockContractMonitor
} from './mock-validation';
import testClock from './test-clock';

const createNotificationDispatcherMock = (overrides: Record<string, unknown> = {}) => ({
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

type NotificationDispatcherMock = ReturnType<typeof createNotificationDispatcherMock>;

describe('mock-validation behavior', () => {
    it('rejects nullish required payload fields while retaining legitimate zero and empty text', () => {
        const payload = {
            id: 'synthetic-notification', type: 'platform:follow', platform: 'twitch', user: 'synthetic-viewer',
            displayMessage: '', ttsMessage: '', logMessage: '', processedAt: 0, timestamp: new Date(0).toISOString(),
        };
        expect(validateNotificationData(payload).success).toBe(true);
        for (const field of API_CONTRACTS.NotificationBuilder.requiredReturnFields) {
            for (const value of [null, undefined]) {
                expect(validateNotificationData({ ...payload, [field]: value }).success).toBe(false);
            }
        }
        for (const field of ['id', 'type', 'platform', 'displayMessage', 'ttsMessage', 'logMessage', 'timestamp']) {
            for (const value of [0, false]) {
                expect(validateNotificationData({ ...payload, [field]: value }).success).toBe(false);
            }
        }
        for (const processedAt of [NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
            expect(validateNotificationData({ ...payload, processedAt }).success).toBe(false);
        }
    });

    it('retains false and zero platform-event scalars but rejects nullish fields', () => {
        expect(validatePlatformEventData({ gift: {}, user: {}, giftCount: 0 }, 'tiktok', 'gift').success).toBe(true);
        expect(validatePlatformEventData({ event: { user_name: 'synthetic-viewer', tier: '1000', is_gift: false } }, 'twitch', 'subscription').success).toBe(true);
        for (const giftCount of [null, undefined]) {
            expect(validatePlatformEventData({ gift: {}, user: {}, giftCount }, 'tiktok', 'gift').success).toBe(false);
        }
    });

    it('requires callable contract methods and reports a missing application method only once', () => {
        for (const method of [null, undefined, 0, false]) {
            expect(validateMockContract(createNotificationDispatcherMock({ dispatchMessage: method }), 'NotificationDispatcher').success).toBe(false);
        }
        const application = Object.fromEntries(API_CONTRACTS.Application.requiredMethods.filter(method => method !== 'handlePaypiggyNotification').map(method => [method, createMockFn()]));
        expect(validateMockContract(application, 'Application').errors).toEqual(['Missing required method: handlePaypiggyNotification']);
    });
    let originalValidateMock: typeof globalThis.validateMock;
    let originalValidateNotification: typeof globalThis.validateNotification;
    let originalValidatePlatformEvent: typeof globalThis.validatePlatformEvent;

    beforeEach(() => {
        testClock.reset();
        originalValidateMock = globalThis.validateMock;
        originalValidateNotification = globalThis.validateNotification;
        originalValidatePlatformEvent = globalThis.validatePlatformEvent;
    });

    afterEach(() => {
        testClock.useRealTime();
        globalThis.validateMock = originalValidateMock;
        globalThis.validateNotification = originalValidateNotification;
        globalThis.validatePlatformEvent = originalValidatePlatformEvent;
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

        expect(typeof globalThis.validateMock).toBe('function');
        expect(typeof globalThis.validateNotification).toBe('function');
        expect(typeof globalThis.validatePlatformEvent).toBe('function');

        const goodMatch = toMatchContract(createNotificationDispatcherMock(), 'NotificationDispatcher');
        expect(goodMatch.pass).toBe(true);
        expect(goodMatch.message()).toContain('Expected mock not to match');

        const badMatch = toMatchContract({ _mockType: 'NotificationDispatcher' }, 'NotificationDispatcher');
        expect(badMatch.pass).toBe(false);
        expect(badMatch.message()).toContain('Mock failed NotificationDispatcher contract validation');
    });

    it('tracks registered mocks and validation history in the contract monitor', () => {
        const monitor = new MockContractMonitor();
        const dispatcher: NotificationDispatcherMock = createNotificationDispatcherMock();

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
        expect(history[0]?.timestamp).toBeLessThanOrEqual(history[1]?.timestamp ?? 0);

        monitor.reset();
        expect(monitor.getValidationHistory()).toHaveLength(0);
    });
});
