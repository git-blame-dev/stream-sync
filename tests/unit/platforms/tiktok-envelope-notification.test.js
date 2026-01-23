
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { initializeTestLogging, TEST_TIMEOUTS } = require('../../helpers/test-setup');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const { expectNoTechnicalArtifacts } = require('../../helpers/assertion-helpers');
const { extractTikTokUserData } = require('../../../src/utils/tiktok-data-extraction');
const testClock = require('../../helpers/test-clock');

initializeTestLogging();

const createEnvelopeNotificationHandler = (mockLogger, mockGiftHandler) => {
    return async (platform, data) => {
        try {
            mockLogger.info(`[Envelope] Treasure chest event on ${platform}`, platform);

            const identity = platform === 'tiktok'
                ? extractTikTokUserData(data)
                : { userId: data?.userId, username: data?.username };

            if (!identity.userId || !identity.username) {
                mockLogger.warn('[Envelope] Missing canonical identity in envelope data', platform, { data });
                return;
            }

            const isError = data?.isError === true;
            const giftType = typeof data?.giftType === 'string' ? data.giftType.trim() : '';
            const giftCount = Number(data?.giftCount);
            const amount = Number(data?.amount);
            const currency = typeof data?.currency === 'string' ? data.currency.trim() : '';
            const repeatCount = data?.repeatCount === undefined ? 1 : data.repeatCount;

            if (!giftType || !Number.isFinite(giftCount) || giftCount < 0 || !Number.isFinite(amount) || amount < 0 || !currency || !data?.timestamp) {
                throw new Error('Envelope notification requires giftType, giftCount, amount, currency, timestamp, and id');
            }

            if (!isError && (giftCount <= 0 || amount <= 0 || !data?.id)) {
                throw new Error('Envelope notification requires giftType, giftCount, amount, currency, timestamp, and id');
            }

            const giftData = {
                giftType,
                giftCount,
                amount,
                currency,
                repeatCount,
                type: 'platform:envelope',
                userId: identity.userId,
                timestamp: data.timestamp,
                ...(data?.id ? { id: data.id } : {}),
                ...(isError ? { isError: true } : {}),
                originalEnvelopeData: data
            };

            await mockGiftHandler(platform, identity.username, giftData);

        } catch (error) {
            mockLogger.error(`Error handling envelope notification: ${error.message}`, platform, error);
        }
    };
};

describe('TikTok Envelope Notification - Behavior Testing', () => {
    let mockLogger;
    let handleEnvelopeNotification;
    let mockGiftHandler;
    let capturedGiftCalls;

    setupAutomatedCleanup();

    beforeEach(() => {
        mockLogger = noOpLogger;

        capturedGiftCalls = [];

        mockGiftHandler = createMockFn(async (platform, username, giftData) => {
            const call = {
                platform,
                username,
                giftData,
                timestamp: testClock.now()
            };
            capturedGiftCalls.push(call);

            return {
                id: 'test-notification-id',
                type: 'platform:envelope',
                platform: platform,
                username: username,
                displayMessage: `${username} sent a Treasure Chest`,
                ttsMessage: `${username} sent a treasure chest`,
                logMessage: `[Gift] ${username} sent Treasure Chest`,
                processedAt: testClock.now(),
                timestamp: new Date(testClock.now()).toISOString(),
                data: giftData
            };
        });

        handleEnvelopeNotification = createEnvelopeNotificationHandler(mockLogger, mockGiftHandler);
    });

    afterEach(() => {
        clearAllMocks();
        restoreAllMocks();
        capturedGiftCalls = [];
    });

    const getLatestGiftCall = () => capturedGiftCalls[capturedGiftCalls.length - 1];

    const expectGiftCallBehavior = (expectedPlatform, expectedUsername, expectedGiftData) => {
        const latestCall = getLatestGiftCall();
        expect(latestCall).toBeDefined();
        expect(latestCall.platform).toBe(expectedPlatform);
        expect(latestCall.username).toBe(expectedUsername);
        expect(latestCall.giftData).toMatchObject(expectedGiftData);
    };

    const createEnvelopeData = (overrides = {}) => ({
        user: {
            uniqueId: "testUserEnvelope",
            nickname: "TestEnvelopeDisplay",
            userId: "test_user_id_envelope"
        },
        giftType: 'Treasure Chest',
        giftCount: 1,
        amount: 500,
        currency: 'coins',
        id: 'envelope-test-id',
        timestamp: new Date(testClock.now()).toISOString(),
        ...overrides
    });

    describe('Complete Data Structure Processing', () => {
        test('should process envelope with complete data (identity + gift fields)', async () => {
            const completeEnvelopeData = createEnvelopeData({
                user: {
                    uniqueId: "testUserEnvelopeComplete",
                    nickname: "TestEnvelopeDisplay",
                    userId: "test_user_id_envelope_complete"
                },
                amount: 500
            });

            await handleEnvelopeNotification('tiktok', completeEnvelopeData);

            expect(mockGiftHandler).toHaveBeenCalledTimes(1);
            expectGiftCallBehavior('tiktok', 'testUserEnvelopeComplete', {
                giftType: 'Treasure Chest',
                giftCount: 1,
                amount: 500,
                currency: 'coins',
                type: 'platform:envelope',
                id: completeEnvelopeData.id,
                timestamp: completeEnvelopeData.timestamp,
                originalEnvelopeData: completeEnvelopeData
            });

            const result = await mockGiftHandler.mock.results[0].value;
            expectNoTechnicalArtifacts(result.displayMessage);
            expectNoTechnicalArtifacts(result.ttsMessage);
            expect(result.displayMessage).toContain('testUserEnvelopeComplete');
            expect(result.displayMessage).toContain('Treasure Chest');
        }, TEST_TIMEOUTS.UNIT);

        test('should use uniqueId as username when nickname available', async () => {
            const envelopeData = createEnvelopeData({
                user: {
                    uniqueId: "testUserUnique",
                    nickname: "TestDisplayName",
                    userId: "test_user_id_unique"
                },
                amount: 250
            });

            await handleEnvelopeNotification('tiktok', envelopeData);

            expectGiftCallBehavior('tiktok', 'testUserUnique', {
                giftType: 'Treasure Chest',
                amount: 250,
                currency: 'coins'
            });
        }, TEST_TIMEOUTS.UNIT);
    });

    describe('Partial Data Scenario Handling', () => {
        test('should skip when amount is missing', async () => {
            const missingAmountData = createEnvelopeData({
                user: {
                    uniqueId: "testUserMissingAmount",
                    nickname: "TestUserNoAmount",
                    userId: "test_user_id_missing_amount"
                },
                amount: undefined
            });

            await handleEnvelopeNotification('tiktok', missingAmountData);

            expect(mockGiftHandler).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.UNIT);

        test('should handle missing nickname with uniqueId fallback', async () => {
            const missingNicknameData = createEnvelopeData({
                user: {
                    uniqueId: "testUserFallback",
                    userId: "test_user_id_fallback"
                },
                amount: 750
            });

            await handleEnvelopeNotification('tiktok', missingNicknameData);

            expectGiftCallBehavior('tiktok', 'testUserFallback', {
                giftType: 'Treasure Chest',
                amount: 750,
                currency: 'coins'
            });

            const result = await mockGiftHandler.mock.results[0].value;
            expectNoTechnicalArtifacts(result.displayMessage);
            expect(result.displayMessage).toContain('testUserFallback');
        }, TEST_TIMEOUTS.UNIT);

        test('should skip when uniqueId is missing', async () => {
            const minimalData = createEnvelopeData({
                user: {
                    userId: "test_user_id_minimal"
                },
                amount: 100
            });

            await handleEnvelopeNotification('tiktok', minimalData);

            expect(mockGiftHandler).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.UNIT);
    });

    describe('Nested User Object Format Support', () => {
        test('should process envelope notifications with nested user payloads', async () => {
            const nestedUserData = createEnvelopeData({
                user: {
                    uniqueId: "testUserNestedEnvelope",
                    nickname: "TestNestedEnvelope",
                    userId: "test_user_id_envelope_nested"
                },
                amount: 300,
                timestamp: new Date(testClock.now()).toISOString()
            });

            await handleEnvelopeNotification('tiktok', nestedUserData);

            expect(mockGiftHandler).toHaveBeenCalledTimes(1);
            expectGiftCallBehavior('tiktok', 'testUserNestedEnvelope', {
                giftType: 'Treasure Chest',
                giftCount: 1,
                amount: 300,
                currency: 'coins',
                type: 'platform:envelope',
                id: nestedUserData.id,
                timestamp: nestedUserData.timestamp,
                originalEnvelopeData: nestedUserData
            });
        }, TEST_TIMEOUTS.UNIT);
    });

    describe('Amount Field Support', () => {
        test('should use amount and currency fields for envelope notifications', async () => {
            const amountFieldData = createEnvelopeData({
                user: {
                    uniqueId: "testUserAmount",
                    nickname: "TestUserAmount",
                    userId: "test_user_id_amount"
                },
                amount: 500,
                currency: 'coins'
            });

            await handleEnvelopeNotification('tiktok', amountFieldData);

            expectGiftCallBehavior('tiktok', 'testUserAmount', {
                giftType: 'Treasure Chest',
                amount: 500,
                currency: 'coins'
            });
        }, TEST_TIMEOUTS.UNIT);

        test('should accept numeric string amounts', async () => {
            const stringAmountData = createEnvelopeData({
                user: {
                    uniqueId: "testUserStringAmount",
                    nickname: "TestUserStringAmount",
                    userId: "test_user_id_string_amount"
                },
                amount: '250',
                currency: 'coins'
            });

            await handleEnvelopeNotification('tiktok', stringAmountData);

            expectGiftCallBehavior('tiktok', 'testUserStringAmount', {
                giftType: 'Treasure Chest',
                amount: 250,
                currency: 'coins'
            });
        }, TEST_TIMEOUTS.UNIT);

        test('should skip when currency is missing', async () => {
            const missingCurrencyData = createEnvelopeData({
                user: {
                    uniqueId: "testUserMissingCurrency",
                    nickname: "TestUserMissingCurrency",
                    userId: "test_user_id_missing_currency"
                },
                currency: ''
            });

            await handleEnvelopeNotification('tiktok', missingCurrencyData);

            expect(mockGiftHandler).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.UNIT);
    });

    describe('Missing Identity Behavior', () => {
        test('should skip envelope notifications without identity fields', async () => {
            const emptyUserData = {
                giftType: 'Treasure Chest',
                giftCount: 1,
                amount: 200,
                currency: 'coins',
                id: 'envelope-empty-user-id',
                timestamp: new Date(testClock.now()).toISOString()
            };

            await handleEnvelopeNotification('tiktok', emptyUserData);

            expect(mockGiftHandler).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.UNIT);

        test('should skip when identity fields are empty strings', async () => {
            const emptyStringUserData = {
                user: {
                    uniqueId: "",
                    userId: "",
                    nickname: ""
                },
                giftType: 'Treasure Chest',
                giftCount: 1,
                amount: 350,
                currency: 'coins',
                id: 'envelope-empty-strings',
                timestamp: new Date(testClock.now()).toISOString()
            };

            await handleEnvelopeNotification('tiktok', emptyStringUserData);

            expect(mockGiftHandler).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.UNIT);

        test('should skip when identity fields are null/undefined', async () => {
            const nullUserData = {
                user: {
                    uniqueId: null,
                    nickname: undefined,
                    userId: null
                },
                giftType: 'Treasure Chest',
                giftCount: 1,
                amount: 450,
                currency: 'coins',
                id: 'envelope-null-user',
                timestamp: new Date(testClock.now()).toISOString()
            };

            await handleEnvelopeNotification('tiktok', nullUserData);

            expect(mockGiftHandler).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.UNIT);
    });

    describe('Notification String Generation for Envelope Type', () => {
        test('should generate proper gift data structure for handleGiftNotification', async () => {
            const envelopeData = createEnvelopeData({
                user: {
                    uniqueId: "testUserEnvelope",
                    nickname: "TestUserEnvelope",
                    userId: "test_user_id_envelope"
                },
                amount: 600
            });

            await handleEnvelopeNotification('tiktok', envelopeData);

            const latestCall = getLatestGiftCall();
            const giftData = latestCall.giftData;

            expect(giftData.giftType).toBe('Treasure Chest');
            expect(giftData.giftCount).toBe(1);
            expect(giftData.amount).toBe(600);
            expect(giftData.currency).toBe('coins');
            expect(giftData.type).toBe('platform:envelope');

            expect(giftData.userId).toBe('test_user_id_envelope');
            expect(giftData.timestamp).toBeDefined();
            expect(giftData.originalEnvelopeData).toEqual(envelopeData);
        }, TEST_TIMEOUTS.UNIT);

        test('should preserve original envelope data for platform-specific processing', async () => {
            const complexEnvelopeData = createEnvelopeData({
                user: {
                    uniqueId: "testUserComplex",
                    nickname: "TestUserComplex",
                    userId: "test_user_id_complex"
                },
                amount: 800,
                eventId: "test_event_456",
                platformSpecificField: "test_custom_data"
            });

            await handleEnvelopeNotification('tiktok', complexEnvelopeData);

            const latestCall = getLatestGiftCall();
            const giftData = latestCall.giftData;
            expect(giftData.originalEnvelopeData).toEqual(complexEnvelopeData);
            expect(giftData.originalEnvelopeData.platformSpecificField).toBe('test_custom_data');

            const result = await mockGiftHandler.mock.results[0].value;
            expectNoTechnicalArtifacts(result.displayMessage);
        }, TEST_TIMEOUTS.UNIT);

        test('should use provided userId when available in envelope data', async () => {
            const envelopeWithId = createEnvelopeData({
                user: {
                    uniqueId: "testUserWithId",
                    nickname: "TestUserWithId",
                    userId: "test_user_id_existing"
                },
                amount: 400
            });

            await handleEnvelopeNotification('tiktok', envelopeWithId);

            const latestCall = getLatestGiftCall();
            const giftData = latestCall.giftData;
            expect(giftData.userId).toBe('test_user_id_existing');
        }, TEST_TIMEOUTS.UNIT);
    });

    describe('Error Handling and Edge Cases', () => {
        test('allows error envelopes without ids to reach gift handler', async () => {
            const errorEnvelope = createEnvelopeData({
                id: undefined,
                giftCount: 0,
                amount: 0,
                isError: true
            });

            await handleEnvelopeNotification('tiktok', errorEnvelope);

            expect(mockGiftHandler).toHaveBeenCalledTimes(1);
            const latestCall = getLatestGiftCall();
            const giftData = latestCall.giftData;
            expect(giftData.isError).toBe(true);
            expect(giftData.giftCount).toBe(0);
            expect(giftData.amount).toBe(0);
            expect(giftData).not.toHaveProperty('id');
        }, TEST_TIMEOUTS.UNIT);

        test('should handle null envelope data gracefully', async () => {
            await handleEnvelopeNotification('tiktok', null);

            expect(mockGiftHandler).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.UNIT);

        test('should handle empty envelope data object', async () => {
            await handleEnvelopeNotification('tiktok', {});

            expect(mockGiftHandler).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.UNIT);

        test('should reject non-numeric amounts', async () => {
            const invalidAmountData = createEnvelopeData({
                user: {
                    uniqueId: "testUserInvalidAmount",
                    nickname: "InvalidTestUserAmount",
                    userId: "test_user_id_invalid_amount"
                },
                amount: 'not_a_number'
            });

            await handleEnvelopeNotification('tiktok', invalidAmountData);

            expect(mockGiftHandler).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.UNIT);
    });

    describe('Delegation to Gift Notification Handler', () => {
        test('should properly delegate to handleGiftNotification with correct parameters', async () => {
            const envelopeData = createEnvelopeData({
                user: {
                    uniqueId: "testUserDelegation",
                    nickname: "TestUserDelegation",
                    userId: "test_user_id_delegation"
                },
                amount: 700
            });

            await handleEnvelopeNotification('tiktok', envelopeData);

            expect(mockGiftHandler).toHaveBeenCalledTimes(1);
            expect(mockGiftHandler).toHaveBeenCalledWith(
                'tiktok',
                'testUserDelegation',
                expect.objectContaining({
                    giftType: 'Treasure Chest',
                    giftCount: 1,
                    amount: 700,
                    currency: 'coins',
                    type: 'platform:envelope',
                    id: envelopeData.id,
                    timestamp: envelopeData.timestamp,
                    originalEnvelopeData: envelopeData
                })
            );
        }, TEST_TIMEOUTS.UNIT);

        test('should maintain envelope type designation through gift processing', async () => {
            const envelopeData = createEnvelopeData({
                user: {
                    uniqueId: "testUserType",
                    nickname: "TestUserType",
                    userId: "test_user_id_type"
                },
                amount: 350
            });

            await handleEnvelopeNotification('tiktok', envelopeData);

            const latestCall = getLatestGiftCall();
            const giftData = latestCall.giftData;
            expect(giftData.type).toBe('platform:envelope');

            expect(giftData.giftType).toBe('Treasure Chest');
            expect(giftData.giftCount).toBe(1);
        }, TEST_TIMEOUTS.UNIT);

        test('should pass through all necessary data for comprehensive gift processing', async () => {
            const richEnvelopeData = createEnvelopeData({
                user: {
                    uniqueId: "testUserRich",
                    nickname: "TestUserRich",
                    userId: "test_user_id_rich"
                },
                amount: 1000,
                additionalData: "test_extra_info"
            });

            await handleEnvelopeNotification('tiktok', richEnvelopeData);

            const latestCall = getLatestGiftCall();
            const giftData = latestCall.giftData;
            expect(giftData.userId).toBe('test_user_id_rich');
            expect(giftData.timestamp).toBeDefined();
            expect(giftData.originalEnvelopeData).toEqual(richEnvelopeData);
            expect(giftData.originalEnvelopeData.additionalData).toBe('test_extra_info');

            const result = await mockGiftHandler.mock.results[0].value;
            expectNoTechnicalArtifacts(result.displayMessage);
            expect(result.displayMessage).toContain('testUserRich');
        }, TEST_TIMEOUTS.UNIT);
    });
});
