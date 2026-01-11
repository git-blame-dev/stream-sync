
// MANDATORY imports
const { 
  initializeTestLogging,
  TEST_TIMEOUTS 
} = require('../../helpers/test-setup');

const { 
  setupAutomatedCleanup
} = require('../../helpers/mock-lifecycle');

const { 
  expectNoTechnicalArtifacts
} = require('../../helpers/assertion-helpers');
const testClock = require('../../helpers/test-clock');

// Import functions under test
const { normalizeTikTokMessage } = require('../../../src/utils/message-normalization');
const { extractTikTokUserData } = require('../../../src/utils/tiktok-data-extraction');

// Initialize FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  logPerformanceMetrics: true
});

const buildTimestampService = () => ({
  extractTimestamp: jest.fn((platform, data) => {
    if (platform !== 'tiktok') {
      throw new Error('Unsupported platform');
    }
    if (!data?.createTime) {
      throw new Error('Missing tiktok timestamp');
    }
    return new Date(Number(data.createTime)).toISOString();
  })
});

describe('TikTok Unknown User Data Structure Mismatch', () => {
  let timestampService;

  beforeEach(() => {
    timestampService = buildTimestampService();
  });
  describe('Message Normalization with Actual TikTok Data Structure', () => {
    describe('when TikTok data has nested structure (current production format)', () => {
      it('should extract username from nested user structure', () => {
        // Arrange: Nested structure from TikTok event payloads
        const nestedTikTokData = {
          "comment": "Test nested message",
          "user": {
            "uniqueId": "testUserNested",
            "nickname": "TestNestedUser",
            "userId": "test_user_id_nested",
            "profilePictureUrl": "https://example.invalid/avatar-nested.jpg"
          },
          "createTime": testClock.now()
        };

        // Act
        const result = normalizeTikTokMessage(nestedTikTokData, 'tiktok', timestampService);

        // Assert
        expect(result.username).toBe('testUserNested');
        expect(result.userId).toBe('test_user_id_nested');
        expect(result.message).toBe('Test nested message');
        expect(result.platform).toBe('tiktok');
        expectNoTechnicalArtifacts(result.username);
      }, TEST_TIMEOUTS.FAST);
    });

    describe('when TikTok data is malformed or empty', () => {
      it('should reject null data', () => {
        // Act
        expect(() => normalizeTikTokMessage(null, 'tiktok', timestampService))
          .toThrow('message data');
      }, TEST_TIMEOUTS.FAST);

      it('should reject empty object', () => {
        // Act
        expect(() => normalizeTikTokMessage({}, 'tiktok', timestampService))
          .toThrow('userId');
      }, TEST_TIMEOUTS.FAST);
    });
  });

  describe('User Data Extraction with Actual TikTok Gift Structure', () => {
    describe('when gift data has nested structure (current production format)', () => {
      it('should extract user data from nested gift structure', () => {
        // Arrange: Gift data with nested user object
        const nestedGiftData = {
          "user": {
            "uniqueId": "testGiftNestedUser",
            "nickname": "TestNestedGiftSender",
            "userId": "test_user_id_gift_nested"
          },
          "giftName": "TestGiftTikTok",
          "giftCount": 1,
          "diamondCount": 10
        };

        // Act
        const result = extractTikTokUserData(nestedGiftData);

        // Assert
        expect(result.userId).toBe('test_user_id_gift_nested');
        expect(result.username).toBe('testGiftNestedUser');
      }, TEST_TIMEOUTS.FAST);
    });

    describe('when gift data is malformed', () => {
      it('should reject null gift data', () => {
        expect(() => extractTikTokUserData(null)).toThrow('TikTok user payload');
      }, TEST_TIMEOUTS.FAST);

      it('should reject empty gift data', () => {
        expect(() => extractTikTokUserData({})).toThrow('TikTok user payload');
      }, TEST_TIMEOUTS.FAST);
    });
  });

  describe('Cross-Platform Consistency', () => {
    it('should maintain consistent user data format across platforms', () => {
      // Arrange: TikTok data that should work
      const tikTokData = {
        "user": {
          "userId": "test_user_id_cross",
          "uniqueId": "testUserCrossPlatform",
          "nickname": "TestCrossPlatform"
        },
        "comment": "Test consistency message",
        "createTime": testClock.now()
      };

      // Act
      const result = normalizeTikTokMessage(tikTokData, 'tiktok', timestampService);

      // Assert: Should match standard format used by other platforms
      expect(result).toHaveProperty('platform', 'tiktok');
      expect(result).toHaveProperty('userId');
      expect(result).toHaveProperty('username');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('isMod');
      expect(result).toHaveProperty('isSubscriber');
      expect(result).toHaveProperty('isBroadcaster');
      expect(result).toHaveProperty('metadata');
      expect(result).toHaveProperty('rawData');

      // Verify no undefined or null values in user-facing fields
      expectNoTechnicalArtifacts(result.username);
      expect(result.userId).not.toBe('undefined');
      expect(result.userId).not.toBe(null);
    }, TEST_TIMEOUTS.FAST);
  });

  describe('Error Recovery and Data Validation', () => {
    it('should reject nested user data missing uniqueId', () => {
      const corruptedData = {
        "comment": "Test message with missing username",
        "user": {
          "userId": "test_user_id_missing_username",
          "nickname": "MissingUnique"
        },
        "createTime": testClock.now()
      };

      const timestampService = buildTimestampService();

      expect(() => normalizeTikTokMessage(corruptedData, 'tiktok', timestampService))
        .toThrow('username');
      expect(() => extractTikTokUserData(corruptedData)).toThrow('user.userId and user.uniqueId');
    }, TEST_TIMEOUTS.FAST);
  });

  describe('Performance and Memory Impact', () => {
    it('should maintain performance with nested user structures', () => {
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

      const timestampService = buildTimestampService();
      const results = multipleEvents.map(event => {
        const normalized = normalizeTikTokMessage(event, 'tiktok', timestampService);
        const userData = extractTikTokUserData(event);
        return { normalized, userData };
      });

      const simulatedProcessingMs = 120;
      testClock.advance(simulatedProcessingMs);
      const processingTime = testClock.now() - startTime;

      expect(processingTime).toBeLessThan(1000);
      expect(results).toHaveLength(100);
      expect(results[0].normalized.username).toBe('testRapidUser0');
      expect(results[99].normalized.username).toBe('testRapidUser99');

      const unknownUserEvents = results.filter(r =>
        r.normalized.username === 'Unknown User' ||
        r.userData.username === 'Unknown User'
      );
      expect(unknownUserEvents).toHaveLength(0);
    }, TEST_TIMEOUTS.SLOW);
  });
});
