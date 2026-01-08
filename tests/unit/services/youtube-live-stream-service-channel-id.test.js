
// Testing Infrastructure (mandatory)
const {
  initializeTestLogging,
  createTestUser,
  TEST_TIMEOUTS,
  INTERNATIONAL_USERNAMES
} = require('../../helpers/test-setup');

const {
  createMockNotificationDispatcher,
  createMockLogger,
  createMockYouTubeServices,
  setupAutomatedCleanup
} = require('../../helpers/mock-factories');

const {
  expectNoTechnicalArtifacts,
  validateUserFacingString,
  expectValidNotification,
  expectOnlyMethodCalled
} = require('../../helpers/assertion-helpers');

const { YouTubeLiveStreamService } = require('../../../src/services/youtube-live-stream-service');

// Initialize testing standards
initializeTestLogging();
setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true
});

describe('YouTube Live Stream Service - Channel ID User Experience', () => {
  let mockInnertubeClient;
  let mockLogger;

  beforeEach(() => {
    // Create behavior-focused mocks
    mockInnertubeClient = {
      getChannel: jest.fn(),
      search: jest.fn(),
      resolveURL: jest.fn()
    };
    mockLogger = createMockLogger();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Valid Channel ID User Experience', () => {
    it('should provide live streams when user supplies valid YouTube Channel ID', async () => {
      // Given: User provides valid YouTube Channel ID format
      const validChannelId = 'UC' + 'a'.repeat(22); // UC + 22 characters
      const mockChannel = {
        getLiveStreams: jest.fn().mockResolvedValue({
          videos: [
            {
              id: 'live123',
              title: { text: 'Amazing Live Stream' },
              is_live: true,
              author: { name: 'Content Creator' }
            }
          ]
        })
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      // When: User requests live streams using Channel ID
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        validChannelId,
        { logger: mockLogger, timeout: 2000 }
      );

      // Then: User receives live stream data successfully
      expect(result.success).toBe(true);
      expect(result.streams).toBeDefined();
      expect(result.streams).toHaveLength(1);
      expect(result.streams[0].videoId).toBe('live123');
      expect(result.streams[0].title).toBe('Amazing Live Stream');
      expect(result.streams[0].isLive).toBe(true);
      expect(result.count).toBe(1);
      
      // Content Quality: User sees clean, friendly content
      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
      validateUserFacingString(result.streams[0].title, {
        audience: 'general',
        minLength: 5
      });
    });

    it('should handle valid Channel ID with no live streams gracefully', async () => {
      // Given: User provides valid Channel ID but channel has no live streams
      const validChannelId = 'UC' + 'x'.repeat(22);
      const mockChannel = {
        getLiveStreams: jest.fn().mockResolvedValue({
          videos: []
        })
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      // When: User requests live streams for inactive channel
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        validChannelId,
        { logger: mockLogger }
      );

      // Then: User receives clear "no streams" response
      expect(result.success).toBe(true);
      expect(result.streams).toHaveLength(0);
      expect(result.count).toBe(0);
      expect(result.hasContent).toBe(false);
    });

    it('should validate Channel ID format for user input', () => {
      // Given: Various Channel ID formats users might provide
      const validChannelIds = [
        'UC' + 'a'.repeat(22),
        'UC' + 'Z'.repeat(22), 
        'UC' + 'a1b2c3d4e5f6g7h8i9j0k1',
        'UC1234567890123456789012'
      ];

      const invalidChannelIds = [
        'UC' + 'a'.repeat(14), // Too short
        'UC' + 'a'.repeat(23), // Too long
        'UX' + 'a'.repeat(22), // Wrong prefix
        'ua' + 'a'.repeat(22), // Lowercase prefix
        'regularusername',      // Regular username
        '@channelhandle'        // Channel handle
      ];

      // When: System validates different Channel ID formats
      validChannelIds.forEach(channelId => {
        // Then: Valid formats are accepted
        const isValid = YouTubeLiveStreamService.isChannelId(channelId);
        expect(isValid).toBe(true);
      });

      invalidChannelIds.forEach(channelId => {
        // Then: Invalid formats are rejected to prevent user confusion
        const isValid = YouTubeLiveStreamService.isChannelId(channelId);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Username Input User Experience', () => {
    it('should provide clear feedback when user provides username instead of Channel ID', async () => {
      // Given: User provides plain username input (common mistake)
      const usernameInput = 'channelname123';
      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: {}
      });

      // When: System attempts to help user by trying username resolution
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        usernameInput,
        { logger: mockLogger }
      );

      // Then: User receives clear, helpful error message
      expect(result.success).toBe(false);
      expect(result.error).toBe('Channel not found');
      expect(result.streams).toHaveLength(0);
      expect(result.count).toBe(0);

      // Content Quality: Error message is user-friendly
      expectNoTechnicalArtifacts(result.error);
      validateUserFacingString(result.error, {
        audience: 'general',
        minLength: 5
      });
    });

    it('should handle @username input with helpful feedback', async () => {
      // Given: User provides @username handle format
      const handleInput = '@channelhandle';
      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: {}
      });

      // When: System attempts to resolve handle for user
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        handleInput,
        { logger: mockLogger }
      );

      // Then: User receives clear error feedback
      expect(result.success).toBe(false);
      expect(result.error).toBe('Channel not found');
      expect(result.streams).toHaveLength(0);
      
      // Content Quality: Clean error messaging
      expectNoTechnicalArtifacts(result.error);
    });

    it('should handle resolution failures gracefully for users', async () => {
      // Given: Username that encounters system issues during resolution
      const problematicUsername = 'nonexistentuser';
      mockInnertubeClient.resolveURL.mockRejectedValue(new Error('resolveURL timeout'));

      // When: System encounters issues while helping user
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        problematicUsername,
        { logger: mockLogger }
      );

      // Then: User receives understandable error message
      expect(result.success).toBe(false);
      expect(result.error).toBe('resolveURL timeout');
      expect(result.streams).toHaveLength(0);

      // Content Quality: Error is user-understandable
      expectNoTechnicalArtifacts(result.error);
    });
  });

  describe('Channel ID Format Validation User Experience', () => {
    it('should accept properly formatted Channel IDs', () => {
      // Given: Specific Channel ID format requirements for users
      const testCases = [
        {
          input: 'UC1234567890123456789012',
          expected: true,
          description: 'Valid UC format with numbers'
        },
        {
          input: 'UCabcdefghijklmnopqrstu1',
          expected: true,
          description: 'Valid UC format with mixed characters'
        },
        {
          input: 'UC_-aBc123XyZ987654321_-',
          expected: true,
          description: 'Valid UC format with allowed special characters'
        },
        {
          input: 'uc1234567890123456789012',
          expected: false,
          description: 'Invalid lowercase prefix'
        },
        {
          input: 'UC12345678901234',
          expected: false,
          description: 'Too short (14 characters after UC)'
        },
        {
          input: 'UC12345678901234567890123',
          expected: false,
          description: 'Too long (23 characters after UC)'
        },
        {
          input: '',
          expected: false,
          description: 'Empty string'
        },
        {
          input: null,
          expected: false,
          description: 'Null input'
        },
        {
          input: undefined,
          expected: false,
          description: 'Undefined input'
        }
      ];

      // When: Users provide different Channel ID formats
      testCases.forEach(({ input, expected, description }) => {
        // Then: Format validation provides correct feedback
        const isValid = YouTubeLiveStreamService.isChannelId(input);
        expect(isValid).toBe(expected);
      });
    });

    it('should handle edge cases in Channel ID validation', () => {
      // Given: Edge case Channel ID inputs users might provide
      const edgeCases = [
        'UC' + '0'.repeat(22),    // All zeros
        'UC' + 'Z'.repeat(22),    // All uppercase
        'UC' + 'a'.repeat(22),    // All lowercase
        'UC' + '-'.repeat(22),    // All hyphens (valid character)
        'UC' + '_'.repeat(22)     // All underscores (valid character)
      ];

      // When: System validates edge case formats
      edgeCases.forEach(channelId => {
        // Then: All valid patterns are accepted for user convenience
        const isValid = YouTubeLiveStreamService.isChannelId(channelId);
        expect(isValid).toBe(true);
      });
    });
  });

  describe('Invalid Channel ID Error Handling User Experience', () => {
    it('should handle malformed Channel ID gracefully for users', async () => {
      // Given: Malformed Channel ID that passes format check but fails at system level
      const malformedChannelId = 'UC' + '1'.repeat(22);
      mockInnertubeClient.getChannel.mockRejectedValue(new Error('Invalid channel ID format'));

      // When: User provides malformed but valid-looking Channel ID
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        malformedChannelId,
        { logger: mockLogger }
      );

      // Then: User receives helpful error message
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid channel ID format');
      expect(result.streams).toHaveLength(0);
      
      // Content Quality: Error is user-understandable
      expectNoTechnicalArtifacts(result.error);
    });

    it('should handle non-existent Channel ID with clear feedback', async () => {
      // Given: Valid format but non-existent Channel ID
      const nonExistentChannelId = 'UC' + 'x'.repeat(22);
      mockInnertubeClient.getChannel.mockRejectedValue(new Error('Channel not found'));

      // When: User provides non-existent Channel ID
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        nonExistentChannelId,
        { logger: mockLogger }
      );

      // Then: User receives clear error message
      expect(result.success).toBe(false);
      expect(result.error).toBe('Channel not found');
      expect(result.streams).toHaveLength(0);
      
      // Content Quality: Clear error messaging
      expectNoTechnicalArtifacts(result.error);
      validateUserFacingString(result.error, {
        minLength: 5,
        mustNotContain: ['undefined', 'null', 'API']
      });
    });

    it('should provide specific error for channel access issues', async () => {
      // Given: Valid Channel ID but access/permission issues
      const restrictedChannelId = 'UC' + 'r'.repeat(22);
      mockInnertubeClient.getChannel.mockResolvedValue(null);

      // When: System encounters access issues
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        restrictedChannelId,
        { logger: mockLogger }
      );

      // Then: User receives appropriate error message
      expect(result.success).toBe(false);
      expect(result.error).toContain('Channel not found');
      expect(result.streams).toHaveLength(0);

      // Content Quality: Error explains the issue to user
      expectNoTechnicalArtifacts(result.error);
      expect(result.error).toContain(restrictedChannelId);
    });
  });

  describe('Performance and Efficiency User Experience', () => {
    it('should provide fast response when user provides Channel ID', async () => {
      // Given: User provides Channel ID for quick stream detection
      const channelId = 'UC' + 'p'.repeat(22);
      const mockChannel = {
        getLiveStreams: jest.fn().mockResolvedValue({
          videos: []
        })
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      // When: User requests live streams with Channel ID
      const startTime = Date.now();
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: mockLogger }
      );
      const responseTime = Date.now() - startTime;

      // Then: User experiences fast response
      expect(result.success).toBe(true);
      expect(responseTime).toBeLessThan(100); // Fast response for user
    });

    it('should avoid handle resolution work when user supplies Channel ID', async () => {
      const username = 'performancetestchannel';
      const channelId = 'UC' + 'direct4567890123456789';

      // Username path: requires resolveURL to resolve handle -> channelId
      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: { browseId: channelId }
      });
      const mockChannelForUsername = {
        getLiveStreams: jest.fn().mockResolvedValue({ 
          videos: [{
            id: 'username123',
            title: { text: 'Username Stream' },
            is_live: true,
            author: { name: 'TestChannel' }
          }]
        })
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannelForUsername);

      const usernameResult = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        username,
        { logger: mockLogger, timeout: 2000 }
      );

      expect(usernameResult.success).toBe(true);
      expect(mockInnertubeClient.resolveURL).toHaveBeenCalledTimes(1);
      expect(mockInnertubeClient.getChannel).toHaveBeenCalledWith(channelId);

      // Reset for Channel ID path
      jest.clearAllMocks();
      const mockChannel = {
        getLiveStreams: jest.fn().mockResolvedValue({ 
          videos: [{
            id: 'channelid123',
            title: { text: 'Channel ID Stream' },
            is_live: true,
            author: { name: 'TestChannel' }
          }]
        })
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const channelIdResult = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: mockLogger, timeout: 2000 }
      );

      expect(channelIdResult.success).toBe(true);
      expect(mockInnertubeClient.resolveURL).not.toHaveBeenCalled(); // direct path, no handle resolution
      expect(mockInnertubeClient.getChannel).toHaveBeenCalledWith(channelId);
    });
  });

  describe('International Channel ID User Experience', () => {
    it('should handle international channels correctly for global users', async () => {
      // Given: Channel ID for international content creators
      const internationalChannelId = 'UC' + 'i'.repeat(22);
      const mockChannel = {
        getLiveStreams: jest.fn().mockResolvedValue({
          videos: [{
            id: 'intl123',
            title: { text: 'Live Stream 中文 العربية' },
            is_live: true,
            author: { name: '国际频道 قناة دولية' }
          }]
        })
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      // When: User requests streams from international channel
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        internationalChannelId,
        { logger: mockLogger }
      );

      // Then: International content is preserved for users
      expect(result.success).toBe(true);
      expect(result.streams[0].title).toContain('中文');
      expect(result.streams[0].title).toContain('العربية');
      expect(result.streams[0].author).toContain('国际频道');
      expect(result.streams[0].author).toContain('قناة دولية');

      // Content Quality: No corruption of international text
      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
    });
  });
});
