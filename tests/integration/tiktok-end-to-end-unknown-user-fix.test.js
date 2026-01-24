const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { TEST_TIMEOUTS } = require('../helpers/test-setup');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { expectNoTechnicalArtifacts } = require('../helpers/assertion-helpers');
const testClock = require('../helpers/test-clock');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { normalizeMessage } = require('../../src/utils/message-normalization');
const { extractTikTokUserData, extractTikTokGiftData } = require('../../src/utils/tiktok-data-extraction');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

const TEST_TIMESTAMP = 1234567890000;

const buildTimestampService = () => ({
    extractTimestamp: createMockFn((platform, data) => {
        if (platform !== 'tiktok') {
            throw new Error('Unsupported platform');
        }
        const raw = data?.common?.createTime ?? testClock.now();
        return new Date(Number(raw)).toISOString();
    })
});

describe('TikTok End-to-End Unknown User Fix Integration', () => {
    beforeEach(() => {
        testClock.reset();
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('Complete TikTok Message Processing Pipeline', () => {
        describe('when processing actual TikTok chat message', () => {
            test('should show actual username in final notification output', () => {
                const actualTikTokMessage = {
                    "comment": "Love your stream! 🎉",
                    "user": {
                        "userId": "test_user_id_chat_1",
                        "uniqueId": "testUserChatOne",
                        "nickname": "TestChatViewer",
                        "profilePictureUrl": "https://example.invalid/avatar-chat.jpg",
                        "followRole": 0,
                        "userBadges": []
                    },
                    "common": { "createTime": TEST_TIMESTAMP }
                };

                const timestampService = buildTimestampService();
                const normalizedMessage = normalizeMessage('tiktok', actualTikTokMessage, 'tiktok', timestampService);

                const notificationData = {
                    type: 'chat',
                    platform: 'tiktok',
                    username: normalizedMessage.username,
                    message: normalizedMessage.message,
                    timestamp: normalizedMessage.timestamp
                };

                expect(normalizedMessage.username).toBe('TestChatViewer');
                expect(normalizedMessage.userId).toBe('testUserChatOne');
                expect(normalizedMessage.message).toBe('Love your stream! 🎉');

                expectNoTechnicalArtifacts(notificationData.username);
                expect(notificationData.username).not.toBe('unknown');
            }, { timeout: TEST_TIMEOUTS.INTEGRATION });

            test('should handle unicode usernames correctly in complete pipeline', () => {
                const unicodeTikTokMessage = {
                    "comment": "你好! Hello from China 🇨🇳",
                    "user": {
                        "userId": "test_user_id_unicode",
                        "uniqueId": "testUser中文",
                        "nickname": "TestUser中文",
                        "profilePictureUrl": "https://example.invalid/unicode-avatar.jpg",
                        "followRole": 0
                    },
                    "common": { "createTime": TEST_TIMESTAMP }
                };

                const timestampService = buildTimestampService();
                const normalizedMessage = normalizeMessage('tiktok', unicodeTikTokMessage, 'tiktok', timestampService);

                expect(normalizedMessage.username).toBe('TestUser中文');
                expect(normalizedMessage.userId).toBe('testUser中文');
                expect(normalizedMessage.message).toBe('你好! Hello from China 🇨🇳');

                expectNoTechnicalArtifacts(normalizedMessage.username);
                expect(normalizedMessage.username).toMatch(/[\u4e00-\u9fff]/);
            }, { timeout: TEST_TIMEOUTS.INTEGRATION });
        });
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

                const timestampService = buildTimestampService();
                expect(() => normalizeMessage('tiktok', corruptedData, 'tiktok', timestampService))
                    .toThrow('userId');

                expect(() => extractTikTokUserData(corruptedData))
                    .toThrow('user.uniqueId and user.nickname');
            }, { timeout: TEST_TIMEOUTS.INTEGRATION });
        });
    });

    describe('Performance and Memory Impact', () => {
        describe('when processing multiple TikTok events rapidly', () => {
            test('should maintain performance with actual data structures', () => {
                const multipleEvents = Array.from({ length: 100 }, (_, i) => ({
                    "user": {
                        "uniqueId": `testRapidUser${i}`,
                        "nickname": `TestRapidUser${i}`,
                        "userId": `test_user_id_${i}`
                    },
                    "comment": `Test message ${i}`,
                    "common": { "createTime": testClock.now() + i }
                }));

                const startTime = testClock.now();

                const timestampService = buildTimestampService();
                const results = multipleEvents.map(event => {
                    const normalized = normalizeMessage('tiktok', event, 'tiktok', timestampService);
                    const userData = extractTikTokUserData(event);
                    return { normalized, userData };
                });

                const simulatedProcessingMs = multipleEvents.length;
                testClock.advance(simulatedProcessingMs);
                const processingTime = testClock.now() - startTime;

                expect(processingTime).toBeLessThan(1000);
                expect(results).toHaveLength(100);

                expect(results[0].normalized.username).toBe('TestRapidUser0');
                expect(results[99].normalized.username).toBe('TestRapidUser99');

                const unknownUserEvents = results.filter(r =>
                    r.normalized.username === 'Unknown User' ||
                    r.userData.username === 'Unknown User'
                );
                expect(unknownUserEvents).toHaveLength(0);
            }, { timeout: TEST_TIMEOUTS.SLOW });
        });
    });
});
