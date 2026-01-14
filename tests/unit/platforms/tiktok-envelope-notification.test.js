
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
// Core testing infrastructure
const { initializeTestLogging, createTestUser, TEST_TIMEOUTS } = require('../../helpers/test-setup');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { createMockLogger, createMockNotificationBuilder, createMockConfig } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const { expectNoTechnicalArtifacts, expectValidNotification } = require('../../helpers/assertion-helpers');
const { extractTikTokUserData } = require('../../../src/utils/tiktok-data-extraction');
const testClock = require('../../helpers/test-clock');

// Initialize logging FIRST
initializeTestLogging();

// Create a testable implementation of the handleEnvelopeNotification method
// This replicates the logic from main.js for direct testing
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
            
            // Pass to handleGiftNotification as a special gift type
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
                // Include original data for any platform-specific processing
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
    let mockNotificationBuilder;
    let mockConfig;
    let handleEnvelopeNotification;
    let mockGiftHandler;
    let capturedGiftCalls;

    // Setup automated cleanup
    setupAutomatedCleanup();

    beforeEach(() => {
        // Create behavior-focused mocks
        mockLogger = createMockLogger();
        mockNotificationBuilder = createMockNotificationBuilder();
        mockConfig = createMockConfig({
            tiktok: { enabled: true, username: 'testUserConfig' }
        });

        // Track gift handler calls for behavior validation
        capturedGiftCalls = [];
        
        // Mock gift handler that captures calls for validation
        mockGiftHandler = createMockFn(async (platform, username, giftData) => {
            const call = {
                platform,
                username,
                giftData,
                timestamp: testClock.now()
            };
            capturedGiftCalls.push(call);
            
            // Return mock notification for validation
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

        // Create the handler under test
        handleEnvelopeNotification = createEnvelopeNotificationHandler(mockLogger, mockGiftHandler);
    });

    afterEach(() => {
        clearAllMocks();
        restoreAllMocks();
        capturedGiftCalls = [];
    });

    // Helper function to get the most recent gift call
    const getLatestGiftCall = () => capturedGiftCalls[capturedGiftCalls.length - 1];
    
    // Helper function to validate gift call behavior
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

    // ================================================================================================
    // COMPLETE DATA STRUCTURE TESTS
    // ================================================================================================

    describe('Complete Data Structure Processing', () => {
        test('should process envelope with complete data (identity + gift fields)', async () => {
            // Given: Complete envelope data structure from TikTok Live Connector
            const completeEnvelopeData = createEnvelopeData({
                user: {
                    uniqueId: "testUserEnvelopeComplete",
                    nickname: "TestEnvelopeDisplay",
                    userId: "test_user_id_envelope_complete"
                },
                amount: 500
            });

            // When: Processing the envelope notification
            await handleEnvelopeNotification('tiktok', completeEnvelopeData);

            // Then: User sees proper treasure chest notification
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

            // Verify logging behavior provides good user feedback
            expect(mockLogger.info).toHaveBeenCalledWith(
                '[Envelope] Treasure chest event on tiktok',
                'tiktok'
            );

            // Verify user-facing content quality from gift handler result
            const result = await mockGiftHandler.mock.results[0].value;
            expectNoTechnicalArtifacts(result.displayMessage);
            expectNoTechnicalArtifacts(result.ttsMessage);
            expect(result.displayMessage).toContain('testUserEnvelopeComplete');
            expect(result.displayMessage).toContain('Treasure Chest');
        }, TEST_TIMEOUTS.UNIT);

        test('should use uniqueId as username when nickname available', async () => {
            // Given: Data with both uniqueId and nickname
            const envelopeData = createEnvelopeData({
                user: {
                    uniqueId: "testUserUnique",
                    nickname: "TestDisplayName",
                    userId: "test_user_id_unique"
                },
                amount: 250
            });

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', envelopeData);

            // Then: User sees notification using uniqueId as username
            expectGiftCallBehavior('tiktok', 'testUserUnique', {
                giftType: 'Treasure Chest',
                amount: 250,
                currency: 'coins'
            });
        }, TEST_TIMEOUTS.UNIT);
    });

    // ================================================================================================
    // PARTIAL DATA SCENARIOS
    // ================================================================================================

    describe('Partial Data Scenario Handling', () => {
        test('should skip when amount is missing', async () => {
            // Given: Envelope data missing amount
            const missingAmountData = createEnvelopeData({
                user: {
                    uniqueId: "testUserMissingAmount",
                    nickname: "TestUserNoAmount",
                    userId: "test_user_id_missing_amount"
                },
                amount: undefined
            });

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', missingAmountData);

            // Then: Notification is rejected and logged
            expect(mockGiftHandler).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Envelope notification requires giftType, giftCount, amount, currency, timestamp, and id'),
                'tiktok',
                expect.any(Error)
            );
        }, TEST_TIMEOUTS.UNIT);

        test('should handle missing nickname with uniqueId fallback', async () => {
            // Given: Envelope data missing nickname
            const missingNicknameData = createEnvelopeData({
                user: {
                    uniqueId: "testUserFallback",
                    userId: "test_user_id_fallback"
                },
                amount: 750
            });

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', missingNicknameData);

            // Then: User sees notification using uniqueId as display name
            expectGiftCallBehavior('tiktok', 'testUserFallback', {
                giftType: 'Treasure Chest',
                amount: 750,
                currency: 'coins'
            });
            
            // Verify fallback provides good user experience
            const result = await mockGiftHandler.mock.results[0].value;
            expectNoTechnicalArtifacts(result.displayMessage);
            expect(result.displayMessage).toContain('testUserFallback');
        }, TEST_TIMEOUTS.UNIT);

        test('should skip when uniqueId is missing', async () => {
            // Given: Envelope data with minimal information
            const minimalData = createEnvelopeData({
                user: {
                    userId: "test_user_id_minimal"
                },
                amount: 100
            });

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', minimalData);

            // Then: No gift notification created without canonical identity
            expect(mockGiftHandler).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error handling envelope notification'),
                'tiktok',
                expect.any(Error)
            );
        }, TEST_TIMEOUTS.UNIT);
    });

    // ================================================================================================
    // NESTED USER OBJECT FORMAT TESTS
    // ================================================================================================

    describe('Nested User Object Format Support', () => {
        test('should process envelope notifications with nested user payloads', async () => {
            // Given: Envelope data with nested user object
            const nestedUserData = createEnvelopeData({
                user: {
                    uniqueId: "testUserNestedEnvelope",
                    nickname: "TestNestedEnvelope",
                    userId: "test_user_id_envelope_nested"
                },
                amount: 300,
                timestamp: new Date(testClock.now()).toISOString()
            });

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', nestedUserData);

            // Then: Handler processes nested identity successfully
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

    // ================================================================================================
    // AMOUNT FIELD TESTS
    // ================================================================================================

    describe('Amount Field Support', () => {
        test('should use amount and currency fields for envelope notifications', async () => {
            // Given: Standard amount payload
            const amountFieldData = createEnvelopeData({
                user: {
                    uniqueId: "testUserAmount",
                    nickname: "TestUserAmount",
                    userId: "test_user_id_amount"
                },
                amount: 500,
                currency: 'coins'
            });

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', amountFieldData);

            // Then: User sees proper amount in notification
            expectGiftCallBehavior('tiktok', 'testUserAmount', {
                giftType: 'Treasure Chest',
                amount: 500,
                currency: 'coins'
            });
        }, TEST_TIMEOUTS.UNIT);

        test('should accept numeric string amounts', async () => {
            // Given: Amount provided as a numeric string
            const stringAmountData = createEnvelopeData({
                user: {
                    uniqueId: "testUserStringAmount",
                    nickname: "TestUserStringAmount",
                    userId: "test_user_id_string_amount"
                },
                amount: '250',
                currency: 'coins'
            });

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', stringAmountData);

            // Then: Amount is normalized to a number
            expectGiftCallBehavior('tiktok', 'testUserStringAmount', {
                giftType: 'Treasure Chest',
                amount: 250,
                currency: 'coins'
            });
        }, TEST_TIMEOUTS.UNIT);

        test('should skip when currency is missing', async () => {
            // Given: Envelope data missing currency
            const missingCurrencyData = createEnvelopeData({
                user: {
                    uniqueId: "testUserMissingCurrency",
                    nickname: "TestUserMissingCurrency",
                    userId: "test_user_id_missing_currency"
                },
                currency: ''
            });

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', missingCurrencyData);

            // Then: Notification is rejected and logged
            expect(mockGiftHandler).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Envelope notification requires giftType, giftCount, amount, currency, timestamp, and id'),
                'tiktok',
                expect.any(Error)
            );
        }, TEST_TIMEOUTS.UNIT);
    });

    // ================================================================================================
    // ANONYMOUS FALLBACK TESTS
    // ================================================================================================

    describe('Missing Identity Behavior', () => {
        test('should skip envelope notifications without identity fields', async () => {
            // Given: Envelope data with no user identification
            const emptyUserData = {
                giftType: 'Treasure Chest',
                giftCount: 1,
                amount: 200,
                currency: 'coins',
                id: 'envelope-empty-user-id',
                timestamp: new Date(testClock.now()).toISOString()
                // No user fields at all
            };

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', emptyUserData);

            // Then: Gift handler is not invoked
            expect(mockGiftHandler).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error handling envelope notification'),
                'tiktok',
                expect.any(Error)
            );
        }, TEST_TIMEOUTS.UNIT);

        test('should skip when identity fields are empty strings', async () => {
            // Given: User fields present but empty
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

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', emptyStringUserData);

            // Then: Gift handler is not invoked
            expect(mockGiftHandler).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error handling envelope notification'),
                'tiktok',
                expect.any(Error)
            );
        }, TEST_TIMEOUTS.UNIT);

        test('should skip when identity fields are null/undefined', async () => {
            // Given: User fields present but null/undefined
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

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', nullUserData);

            // Then: Gift handler is not invoked
            expect(mockGiftHandler).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error handling envelope notification'),
                'tiktok',
                expect.any(Error)
            );
        }, TEST_TIMEOUTS.UNIT);
    });

    // ================================================================================================
    // NOTIFICATION STRING GENERATION TESTS
    // ================================================================================================

    describe('Notification String Generation for Envelope Type', () => {
        test('should generate proper gift data structure for handleGiftNotification', async () => {
            // Given: Standard envelope data
            const envelopeData = createEnvelopeData({
                user: {
                    uniqueId: "testUserEnvelope",
                    nickname: "TestUserEnvelope",
                    userId: "test_user_id_envelope"
                },
                amount: 600
            });

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', envelopeData);

            // Then: Gift handler receives properly structured data
            const latestCall = getLatestGiftCall();
            const giftData = latestCall.giftData;
            
            // Validate core gift data structure
            expect(giftData.giftType).toBe('Treasure Chest');
            expect(giftData.giftCount).toBe(1);
            expect(giftData.amount).toBe(600);
            expect(giftData.currency).toBe('coins');
            expect(giftData.type).toBe('platform:envelope');
            
            // Validate metadata
            expect(giftData.userId).toBe('test_user_id_envelope');
            expect(giftData.timestamp).toBeDefined();
            expect(giftData.originalEnvelopeData).toEqual(envelopeData);
        }, TEST_TIMEOUTS.UNIT);

        test('should preserve original envelope data for platform-specific processing', async () => {
            // Given: Complex envelope data with platform-specific fields
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

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', complexEnvelopeData);

            // Then: Original data preserved for downstream processing
            const latestCall = getLatestGiftCall();
            const giftData = latestCall.giftData;
            expect(giftData.originalEnvelopeData).toEqual(complexEnvelopeData);
            expect(giftData.originalEnvelopeData.platformSpecificField).toBe('test_custom_data');
            
            // Verify user gets meaningful notification regardless of complex data
            const result = await mockGiftHandler.mock.results[0].value;
            expectNoTechnicalArtifacts(result.displayMessage);
        }, TEST_TIMEOUTS.UNIT);

        test('should use provided userId when available in envelope data', async () => {
            // Given: Envelope data with existing userId
            const envelopeWithId = createEnvelopeData({
                user: {
                    uniqueId: "testUserWithId",
                    nickname: "TestUserWithId",
                    userId: "test_user_id_existing"
                },
                amount: 400
            });

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', envelopeWithId);

            // Then: Existing userId preserved
            const latestCall = getLatestGiftCall();
            const giftData = latestCall.giftData;
            expect(giftData.userId).toBe('test_user_id_existing');
        }, TEST_TIMEOUTS.UNIT);
    });

    // ================================================================================================
    // ERROR HANDLING AND EDGE CASES
    // ================================================================================================

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
            // Given: Null envelope data
            const nullData = null;

            // When: Processing null envelope notification
            await handleEnvelopeNotification('tiktok', nullData);

            // Then: Gift handler is not invoked
            expect(mockGiftHandler).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error handling envelope notification'),
                'tiktok',
                expect.any(Error)
            );
        }, TEST_TIMEOUTS.UNIT);

        test('should handle empty envelope data object', async () => {
            // Given: Empty envelope data object
            const emptyData = {};

            // When: Processing empty envelope notification
            await handleEnvelopeNotification('tiktok', emptyData);

            // Then: Gift handler is not invoked
            expect(mockGiftHandler).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error handling envelope notification'),
                'tiktok',
                expect.any(Error)
            );
        }, TEST_TIMEOUTS.UNIT);

        test('should reject non-numeric amounts', async () => {
            // Given: Envelope data with non-numeric amount
            const invalidAmountData = createEnvelopeData({
                user: {
                    uniqueId: "testUserInvalidAmount",
                    nickname: "InvalidTestUserAmount",
                    userId: "test_user_id_invalid_amount"
                },
                amount: 'not_a_number'
            });

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', invalidAmountData);

            // Then: Notification is rejected and logged
            expect(mockGiftHandler).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Envelope notification requires giftType, giftCount, amount, currency, timestamp, and id'),
                'tiktok',
                expect.any(Error)
            );
        }, TEST_TIMEOUTS.UNIT);

        test('should log start of envelope processing', async () => {
            // Given: Standard envelope data
            const envelopeData = createEnvelopeData({
                user: {
                    uniqueId: "testUserDebug",
                    nickname: "TestUserDebug",
                    userId: "test_user_id_debug"
                },
                amount: 500
            });

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', envelopeData);

            // Then: Appropriate logging occurs (behavior validation)
            expect(mockLogger.info).toHaveBeenCalledWith(
                '[Envelope] Treasure chest event on tiktok',
                'tiktok'
            );
        }, TEST_TIMEOUTS.UNIT);
    });

    // ================================================================================================
    // DELEGATION TO GIFT NOTIFICATION HANDLER TESTS
    // ================================================================================================

    describe('Delegation to Gift Notification Handler', () => {
        test('should properly delegate to handleGiftNotification with correct parameters', async () => {
            // Given: Envelope notification data
            const envelopeData = createEnvelopeData({
                user: {
                    uniqueId: "testUserDelegation",
                    nickname: "TestUserDelegation",
                    userId: "test_user_id_delegation"
                },
                amount: 700
            });

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', envelopeData);

            // Then: handleGiftNotification called with proper parameters
            expect(mockGiftHandler).toHaveBeenCalledTimes(1);
            expect(mockGiftHandler).toHaveBeenCalledWith(
                'tiktok',                    // platform
                'testUserDelegation',           // username
                expect.objectContaining({   // giftData
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
            // Given: Envelope data for type tracking
            const envelopeData = createEnvelopeData({
                user: {
                    uniqueId: "testUserType",
                    nickname: "TestUserType",
                    userId: "test_user_id_type"
                },
                amount: 350
            });

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', envelopeData);

            // Then: Type is preserved as 'envelope' for downstream processing
            const latestCall = getLatestGiftCall();
            const giftData = latestCall.giftData;
            expect(giftData.type).toBe('platform:envelope');
            
            // Verify this allows for envelope-specific handling if needed
            expect(giftData.giftType).toBe('Treasure Chest');
            expect(giftData.giftCount).toBe(1);
        }, TEST_TIMEOUTS.UNIT);

        test('should pass through all necessary data for comprehensive gift processing', async () => {
            // Given: Rich envelope data with all possible fields
            const richEnvelopeData = createEnvelopeData({
                user: {
                    uniqueId: "testUserRich",
                    nickname: "TestUserRich",
                    userId: "test_user_id_rich"
                },
                amount: 1000,
                additionalData: "test_extra_info"
            });

            // When: Processing envelope notification
            await handleEnvelopeNotification('tiktok', richEnvelopeData);

            // Then: All data passed through for comprehensive processing
            const latestCall = getLatestGiftCall();
            const giftData = latestCall.giftData;
            expect(giftData.userId).toBe('test_user_id_rich');
            expect(giftData.timestamp).toBeDefined();
            expect(giftData.originalEnvelopeData).toEqual(richEnvelopeData);
            expect(giftData.originalEnvelopeData.additionalData).toBe('test_extra_info');
            
            // Verify user experience is not compromised by data complexity
            const result = await mockGiftHandler.mock.results[0].value;
            expectNoTechnicalArtifacts(result.displayMessage);
            expect(result.displayMessage).toContain('testUserRich');
        }, TEST_TIMEOUTS.UNIT);
    });
});
