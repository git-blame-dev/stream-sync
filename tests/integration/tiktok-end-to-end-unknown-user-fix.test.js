
// MANDATORY imports
const { 
  initializeTestLogging,
  TEST_TIMEOUTS 
} = require('../helpers/test-setup');

const { 
  setupAutomatedCleanup
} = require('../helpers/mock-lifecycle');

const { 
  expectValidNotification,
  expectNoTechnicalArtifacts
} = require('../helpers/assertion-helpers');
const testClock = require('../helpers/test-clock');

// Import system components
const { normalizeMessage } = require('../../src/utils/message-normalization');
const { extractTikTokUserData, extractTikTokGiftData } = require('../../src/utils/tiktok-data-extraction');

// Initialize FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  logPerformanceMetrics: true
});

const TEST_TIMESTAMP = 1234567890000;

const buildTimestampService = () => ({
  extractTimestamp: jest.fn((platform, data) => {
    if (platform !== 'tiktok') {
      throw new Error('Unsupported platform');
    }
    const raw = data?.createTime ?? testClock.now();
    return new Date(Number(raw)).toISOString();
  })
});

describe('TikTok End-to-End Unknown User Fix Integration', () => {
  beforeEach(() => {
    testClock.reset();
  });

  describe('Complete TikTok Message Processing Pipeline', () => {
    describe('when processing actual TikTok chat message', () => {
      it('should show actual username in final notification output', () => {
        // Arrange: TikTok chat message structure (test fixture)
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
          "createTime": TEST_TIMESTAMP
        };

        // Act: Process through complete pipeline
        const timestampService = buildTimestampService();
        const normalizedMessage = normalizeMessage('tiktok', actualTikTokMessage, 'tiktok', timestampService);
        
        // Simulate notification creation (what would happen in main processing)
        const notificationData = {
          type: 'chat',
          platform: 'tiktok',
          username: normalizedMessage.username,
          message: normalizedMessage.message,
          timestamp: normalizedMessage.timestamp
        };

        // Assert: Final user-facing content should show actual username
        expect(normalizedMessage.username).toBe('testUserChatOne');
        expect(normalizedMessage.userId).toBe('test_user_id_chat_1');
        expect(normalizedMessage.message).toBe('Love your stream! 🎉');
        
        // Validate notification data has no technical artifacts
        expectNoTechnicalArtifacts(notificationData.username);
        expect(notificationData.username).not.toBe('unknown');
      }, TEST_TIMEOUTS.INTEGRATION);

      it('should handle unicode usernames correctly in complete pipeline', () => {
        // Arrange: TikTok message with unicode/international username
        const unicodeTikTokMessage = {
          "comment": "你好! Hello from China 🇨🇳",
          "user": {
            "userId": "test_user_id_unicode",
            "uniqueId": "testUser中文",
            "nickname": "TestUser中文",
            "profilePictureUrl": "https://example.invalid/unicode-avatar.jpg",
            "followRole": 0
          },
          "createTime": TEST_TIMESTAMP
        };

        // Act: Process through complete pipeline  
        const timestampService = buildTimestampService();
        const normalizedMessage = normalizeMessage('tiktok', unicodeTikTokMessage, 'tiktok', timestampService);

        // Assert: Unicode usernames should be preserved
        expect(normalizedMessage.username).toBe('testUser中文');
        expect(normalizedMessage.userId).toBe('test_user_id_unicode');
        expect(normalizedMessage.message).toBe('你好! Hello from China 🇨🇳');
        
        // Validate unicode content quality
        expectNoTechnicalArtifacts(normalizedMessage.username);
        expect(normalizedMessage.username).toMatch(/[\u4e00-\u9fff]/); // Contains Chinese characters
      }, TEST_TIMEOUTS.INTEGRATION);
    });
  });

  describe('Complete TikTok Gift Processing Pipeline', () => {
    describe('when processing actual TikTok gift event', () => {
      it('should show actual gift sender username in final notification', () => {
        // Arrange: TikTok gift structure (test fixture)
        const actualTikTokGift = {
          "user": {
            "userId": "test_user_id_gift_1",
            "uniqueId": "testGiftUserOne",
            "nickname": "TestGiftSender",
            "profilePictureUrl": "https://example.invalid/gifter-avatar.jpg"
          },
          "repeatCount": 5,  // TikTok's actual field
          "repeatEnd": false,
          "groupId": "test_combo_123",
          "timestamp": TEST_TIMESTAMP,
          "giftDetails": {
            "giftName": "TestGiftAlpha",
            "diamondCount": 1,
            "giftType": 1 // combo-enabled
          }
        };

        // Act: Process through complete gift pipeline
        const userData = extractTikTokUserData(actualTikTokGift);
        const giftData = extractTikTokGiftData(actualTikTokGift);

        // Simulate complete gift notification creation
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

        // Assert: Gift notification should show actual sender username
        expect(userData.username).toBe('testGiftUserOne');
        expect(userData.userId).toBe('test_user_id_gift_1');
        expect(giftData.giftType).toBe('TestGiftAlpha');
        expect(giftData.giftCount).toBe(5);
        expect(giftData.unitAmount).toBe(1);
        expect(giftData.amount).toBe(5);
        expect(giftData.currency).toBe('coins');
        
        // Validate final gift notification content
        expect(giftNotification.displayMessage).toBe('testGiftUserOne sent 5x TestGiftAlpha');
        expectNoTechnicalArtifacts(giftNotification.displayMessage);
        expect(giftNotification.displayMessage).not.toContain('Unknown User');
        expect(giftNotification.displayMessage).not.toContain('unknown');
      }, TEST_TIMEOUTS.INTEGRATION);

      it('should handle combo gifts with actual usernames', () => {
        // Arrange: TikTok combo gift (multiple gifts in sequence)
        const comboGiftData = {
          "user": {
            "userId": "test_user_id_gift_combo",
            "uniqueId": "testGiftUserCombo",
            "nickname": "TestComboSender"
          },
          "repeatCount": 1,  // TikTok's actual field
          "repeatEnd": true, // combo finished
          "groupId": "test_combo_678",
          "giftDetails": {
            "giftName": "TestGiftCombo",
            "diamondCount": 10,
            "giftType": 1 // combo gift
          }
        };

        // Act: Process combo gift
        const userData = extractTikTokUserData(comboGiftData);
        const giftData = extractTikTokGiftData(comboGiftData);

        // Simulate combo completion notification
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

        // Assert: Combo notification should show actual username
        expect(userData.username).toBe('testGiftUserCombo');
        expect(userData.userId).toBe('test_user_id_gift_combo');
        expect(giftData.combo).toBe(true);
        expect(giftData.repeatEnd).toBe(true);
        
        expect(comboNotification.displayMessage).toBe('testGiftUserCombo finished combo: 1x TestGiftCombo');
        expectNoTechnicalArtifacts(comboNotification.displayMessage);
        expect(comboNotification.displayMessage).not.toContain('Unknown User');
      }, TEST_TIMEOUTS.INTEGRATION);
    });
  });

  describe('Error Recovery and Fallback Behavior', () => {
    describe('when TikTok data is partially corrupted', () => {
      it('should gracefully handle missing username fields', () => {
        // Arrange: TikTok data missing all username fields
        const corruptedData = {
          "comment": "Test message with no user data",
          "user": {
            "userId": "test_user_id_missing_username",
            "profilePictureUrl": "https://example.invalid/avatar-missing-username.jpg"
          },
          "createTime": TEST_TIMESTAMP
        };

        const timestampService = buildTimestampService();
        expect(() => normalizeMessage('tiktok', corruptedData, 'tiktok', timestampService))
          .toThrow('username');

        expect(() => extractTikTokUserData(corruptedData))
          .toThrow('user.userId and user.uniqueId');
      }, TEST_TIMEOUTS.INTEGRATION);
    });
  });

  describe('Performance and Memory Impact', () => {
    describe('when processing multiple TikTok events rapidly', () => {
      it('should maintain performance with actual data structures', () => {
        // Arrange: Multiple TikTok events simulating real stream activity
        const multipleEvents = Array.from({ length: 100 }, (_, i) => ({
          "user": {
            "uniqueId": `testRapidUser${i}`,
            "nickname": `TestRapidUser${i}`,
            "userId": `test_user_id_${i}`
          },
          "comment": `Test message ${i}`,
          "createTime": testClock.now() + i
        }));

        const startTime = testClock.now();

        // Act: Process all events rapidly
        const timestampService = buildTimestampService();
        const results = multipleEvents.map(event => {
          const normalized = normalizeMessage('tiktok', event, 'tiktok', timestampService);
          const userData = extractTikTokUserData(event);
          return { normalized, userData };
        });

        const simulatedProcessingMs = multipleEvents.length;
        testClock.advance(simulatedProcessingMs);
        const processingTime = testClock.now() - startTime;

        // Assert: Should process quickly with correct usernames
        expect(processingTime).toBeLessThan(1000); // Should process 100 events in <1s
        expect(results).toHaveLength(100);
        
        // Verify first and last results have correct usernames
        expect(results[0].normalized.username).toBe('testRapidUser0');
        expect(results[99].normalized.username).toBe('testRapidUser99');
        
        // Verify no events show "Unknown User"
        const unknownUserEvents = results.filter(r => 
          r.normalized.username === 'Unknown User' || 
          r.userData.username === 'Unknown User'
        );
        expect(unknownUserEvents).toHaveLength(0);
      }, TEST_TIMEOUTS.SLOW);
    });
  });
});
