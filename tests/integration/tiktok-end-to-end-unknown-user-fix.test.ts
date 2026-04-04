const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { TEST_TIMEOUTS } = require('../helpers/test-setup');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { expectNoTechnicalArtifacts } = require('../helpers/assertion-helpers');
const testClock = require('../helpers/test-clock');
const { restoreAllMocks } = require('../helpers/bun-mock-utils');
const { extractTikTokUserData, extractTikTokGiftData } = require('../../src/utils/tiktok-data-extraction');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

const TEST_TIMESTAMP = 1234567890000;

describe('TikTok End-to-End Unknown User Fix Integration', () => {
    beforeEach(() => {
        testClock.reset();
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('Complete TikTok Gift Processing Pipeline', () => {
        describe('when processing actual TikTok gift event', () => {
            test('should show actual gift sender username in final notification', () => {
                const actualTikTokGift = {
                    "user": {
                        "userId": "test_user_id_gift_1",
                        "uniqueId": "testGiftUserOne",
                        "nickname": "TestGiftSender",
                        "profilePictureUrl": "https://example.invalid/gifter-avatar.jpg"
                    },
                    "repeatCount": 5,
                    "repeatEnd": 0,
                    "groupId": "test_combo_123",
                    "timestamp": new Date(TEST_TIMESTAMP).toISOString(),
                    "giftDetails": {
                        "giftName": "TestGiftAlpha",
                        "diamondCount": 1,
                        "giftType": 1
                    }
                };

                const userData = extractTikTokUserData(actualTikTokGift);
                const giftData = extractTikTokGiftData(actualTikTokGift);

                const giftNotification = {
                    type: 'platform:gift',
                    platform: 'tiktok',
                    username: userData.username,
                    giftType: giftData.giftType,
                    giftCount: giftData.giftCount,
                    amount: giftData.amount,
                    currency: giftData.currency,
                    displayMessage: `${userData.username} sent ${giftData.giftCount}x ${giftData.giftType}`,
                    timestamp: new Date(testClock.now()).toISOString()
                };

                expect(userData.username).toBe('TestGiftSender');
                expect(userData.userId).toBe('testGiftUserOne');
                expect(giftData.giftType).toBe('TestGiftAlpha');
                expect(giftData.giftCount).toBe(5);
                expect(giftData.unitAmount).toBe(1);
                expect(giftData.amount).toBe(5);
                expect(giftData.currency).toBe('coins');

                expect(giftNotification.displayMessage).toBe('TestGiftSender sent 5x TestGiftAlpha');
                expectNoTechnicalArtifacts(giftNotification.displayMessage);
                expect(giftNotification.displayMessage).not.toContain('Unknown User');
                expect(giftNotification.displayMessage).not.toContain('unknown');
            }, { timeout: TEST_TIMEOUTS.INTEGRATION });

            test('should handle combo gifts with actual usernames', () => {
                const comboGiftData = {
                    "user": {
                        "userId": "test_user_id_gift_combo",
                        "uniqueId": "testGiftUserCombo",
                        "nickname": "TestComboSender"
                    },
                    "repeatCount": 1,
                    "repeatEnd": 1,
                    "groupId": "test_combo_678",
                    "giftDetails": {
                        "giftName": "TestGiftCombo",
                        "diamondCount": 10,
                        "giftType": 1
                    }
                };

                const userData = extractTikTokUserData(comboGiftData);
                const giftData = extractTikTokGiftData(comboGiftData);

                const comboNotification = {
                    type: 'platform:gift',
                    platform: 'tiktok',
                    username: userData.username,
                    giftType: giftData.giftType,
                    giftCount: giftData.giftCount,
                    amount: giftData.amount,
                    currency: giftData.currency,
                    combo: giftData.combo,
                    comboFinished: giftData.repeatEnd,
                    displayMessage: `${userData.username} finished combo: ${giftData.giftCount}x ${giftData.giftType}`
                };

                expect(userData.username).toBe('TestComboSender');
                expect(userData.userId).toBe('testGiftUserCombo');
                expect(giftData.combo).toBe(true);
                expect(giftData.repeatEnd).toBe(true);

                expect(comboNotification.displayMessage).toBe('TestComboSender finished combo: 1x TestGiftCombo');
                expectNoTechnicalArtifacts(comboNotification.displayMessage);
                expect(comboNotification.displayMessage).not.toContain('Unknown User');
            }, { timeout: TEST_TIMEOUTS.INTEGRATION });
        });
    });

    describe('Error Recovery and Fallback Behavior', () => {
        describe('when TikTok data is partially corrupted', () => {
            test('should gracefully handle missing username fields', () => {
                const corruptedData = {
                    "comment": "Test message with no user data",
                    "user": {
                        "userId": "test_user_id_missing_username",
                        "profilePictureUrl": "https://example.invalid/avatar-missing-username.jpg"
                    },
                    "common": { "createTime": TEST_TIMESTAMP }
                };

                expect(() => extractTikTokUserData(corruptedData))
                    .toThrow('user.uniqueId and user.nickname');
            }, { timeout: TEST_TIMEOUTS.INTEGRATION });
        });
    });
});
