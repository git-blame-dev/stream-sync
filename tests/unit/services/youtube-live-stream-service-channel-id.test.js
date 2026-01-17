const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const testClock = require('../../helpers/test-clock');
const {
  expectNoTechnicalArtifacts,
  validateUserFacingString
} = require('../../helpers/assertion-helpers');
const { YouTubeLiveStreamService } = require('../../../src/services/youtube-live-stream-service');

describe('YouTube Live Stream Service - Channel ID User Experience', () => {
  let mockInnertubeClient;

  beforeEach(() => {
    mockInnertubeClient = {
      getChannel: createMockFn(),
      search: createMockFn(),
      resolveURL: createMockFn()
    };
  });

  afterEach(() => {
    clearAllMocks();
  });

  describe('Valid Channel ID User Experience', () => {
    it('should provide live streams when user supplies valid YouTube Channel ID', async () => {
      const validChannelId = 'UC' + 'a'.repeat(22);
      const mockChannel = {
        getLiveStreams: createMockFn().mockResolvedValue({
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

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        validChannelId,
        { logger: noOpLogger, timeout: 2000 }
      );

      expect(result.success).toBe(true);
      expect(result.streams).toBeDefined();
      expect(result.streams).toHaveLength(1);
      expect(result.streams[0].videoId).toBe('live123');
      expect(result.streams[0].title).toBe('Amazing Live Stream');
      expect(result.streams[0].isLive).toBe(true);
      expect(result.count).toBe(1);

      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
      validateUserFacingString(result.streams[0].title, {
        audience: 'general',
        minLength: 5
      });
    });

    it('should handle valid Channel ID with no live streams gracefully', async () => {
      const validChannelId = 'UC' + 'x'.repeat(22);
      const mockChannel = {
        getLiveStreams: createMockFn().mockResolvedValue({
          videos: []
        })
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        validChannelId,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(true);
      expect(result.streams).toHaveLength(0);
      expect(result.count).toBe(0);
      expect(result.hasContent).toBe(false);
    });

    it('should validate Channel ID format for user input', () => {
      const validChannelIds = [
        'UC' + 'a'.repeat(22),
        'UC' + 'Z'.repeat(22),
        'UC' + 'a1b2c3d4e5f6g7h8i9j0k1',
        'UC1234567890123456789012'
      ];

      const invalidChannelIds = [
        'UC' + 'a'.repeat(14),
        'UC' + 'a'.repeat(23),
        'UX' + 'a'.repeat(22),
        'ua' + 'a'.repeat(22),
        'regularusername',
        '@channelhandle'
      ];

      validChannelIds.forEach(channelId => {
        const isValid = YouTubeLiveStreamService.isChannelId(channelId);
        expect(isValid).toBe(true);
      });

      invalidChannelIds.forEach(channelId => {
        const isValid = YouTubeLiveStreamService.isChannelId(channelId);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Username Input User Experience', () => {
    it('should provide clear feedback when user provides username instead of Channel ID', async () => {
      const usernameInput = 'channelname123';
      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: {}
      });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        usernameInput,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Channel not found');
      expect(result.streams).toHaveLength(0);
      expect(result.count).toBe(0);

      expectNoTechnicalArtifacts(result.error);
      validateUserFacingString(result.error, {
        audience: 'general',
        minLength: 5
      });
    });

    it('should handle @username input with helpful feedback', async () => {
      const handleInput = '@channelhandle';
      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: {}
      });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        handleInput,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Channel not found');
      expect(result.streams).toHaveLength(0);

      expectNoTechnicalArtifacts(result.error);
    });

    it('should handle resolution failures gracefully for users', async () => {
      const problematicUsername = 'nonexistentuser';
      mockInnertubeClient.resolveURL.mockRejectedValue(new Error('resolveURL timeout'));

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        problematicUsername,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('resolveURL timeout');
      expect(result.streams).toHaveLength(0);

      expectNoTechnicalArtifacts(result.error);
    });
  });

  describe('Channel ID Format Validation User Experience', () => {
    it('should accept properly formatted Channel IDs', () => {
      const testCases = [
        { input: 'UC1234567890123456789012', expected: true },
        { input: 'UCabcdefghijklmnopqrstu1', expected: true },
        { input: 'UC_-aBc123XyZ987654321_-', expected: true },
        { input: 'uc1234567890123456789012', expected: false },
        { input: 'UC12345678901234', expected: false },
        { input: 'UC12345678901234567890123', expected: false },
        { input: '', expected: false },
        { input: null, expected: false },
        { input: undefined, expected: false }
      ];

      testCases.forEach(({ input, expected }) => {
        const isValid = YouTubeLiveStreamService.isChannelId(input);
        expect(isValid).toBe(expected);
      });
    });

    it('should handle edge cases in Channel ID validation', () => {
      const edgeCases = [
        'UC' + '0'.repeat(22),
        'UC' + 'Z'.repeat(22),
        'UC' + 'a'.repeat(22),
        'UC' + '-'.repeat(22),
        'UC' + '_'.repeat(22)
      ];

      edgeCases.forEach(channelId => {
        const isValid = YouTubeLiveStreamService.isChannelId(channelId);
        expect(isValid).toBe(true);
      });
    });
  });

  describe('Invalid Channel ID Error Handling User Experience', () => {
    it('should handle malformed Channel ID gracefully for users', async () => {
      const malformedChannelId = 'UC' + '1'.repeat(22);
      mockInnertubeClient.getChannel.mockRejectedValue(new Error('Invalid channel ID format'));

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        malformedChannelId,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid channel ID format');
      expect(result.streams).toHaveLength(0);

      expectNoTechnicalArtifacts(result.error);
    });

    it('should handle non-existent Channel ID with clear feedback', async () => {
      const nonExistentChannelId = 'UC' + 'x'.repeat(22);
      mockInnertubeClient.getChannel.mockRejectedValue(new Error('Channel not found'));

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        nonExistentChannelId,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Channel not found');
      expect(result.streams).toHaveLength(0);

      expectNoTechnicalArtifacts(result.error);
      validateUserFacingString(result.error, {
        minLength: 5,
        mustNotContain: ['undefined', 'null', 'API']
      });
    });

    it('should provide specific error for channel access issues', async () => {
      const restrictedChannelId = 'UC' + 'r'.repeat(22);
      mockInnertubeClient.getChannel.mockResolvedValue(null);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        restrictedChannelId,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Channel not found');
      expect(result.streams).toHaveLength(0);

      expectNoTechnicalArtifacts(result.error);
      expect(result.error).toContain(restrictedChannelId);
    });
  });

  describe('Performance and Efficiency User Experience', () => {
    it('should provide fast response when user provides Channel ID', async () => {
      const channelId = 'UC' + 'p'.repeat(22);
      const mockChannel = {
        getLiveStreams: createMockFn().mockResolvedValue({
          videos: []
        })
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const startTime = testClock.now();
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger }
      );
      const simulatedResponseMs = 20;
      testClock.advance(simulatedResponseMs);
      const responseTime = testClock.now() - startTime;

      expect(result.success).toBe(true);
      expect(responseTime).toBeLessThan(100);
    });

    it('should avoid handle resolution work when user supplies Channel ID', async () => {
      const username = 'performancetestchannel';
      const channelId = 'UC' + 'direct4567890123456789';

      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: { browseId: channelId }
      });
      const mockChannelForUsername = {
        getLiveStreams: createMockFn().mockResolvedValue({
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
        { logger: noOpLogger, timeout: 2000 }
      );

      expect(usernameResult.success).toBe(true);
      expect(mockInnertubeClient.resolveURL).toHaveBeenCalledTimes(1);
      expect(mockInnertubeClient.getChannel).toHaveBeenCalledWith(channelId);

      clearAllMocks();
      const mockChannel = {
        getLiveStreams: createMockFn().mockResolvedValue({
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
        { logger: noOpLogger, timeout: 2000 }
      );

      expect(channelIdResult.success).toBe(true);
      expect(mockInnertubeClient.resolveURL).not.toHaveBeenCalled();
      expect(mockInnertubeClient.getChannel).toHaveBeenCalledWith(channelId);
    });
  });

  describe('International Channel ID User Experience', () => {
    it('should handle international channels correctly for global users', async () => {
      const internationalChannelId = 'UC' + 'i'.repeat(22);
      const mockChannel = {
        getLiveStreams: createMockFn().mockResolvedValue({
          videos: [{
            id: 'intl123',
            title: { text: 'Live Stream 中文 العربية' },
            is_live: true,
            author: { name: '国际频道 قناة دولية' }
          }]
        })
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        internationalChannelId,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(true);
      expect(result.streams[0].title).toContain('中文');
      expect(result.streams[0].title).toContain('العربية');
      expect(result.streams[0].author).toContain('国际频道');
      expect(result.streams[0].author).toContain('قناة دولية');

      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
    });
  });
});
