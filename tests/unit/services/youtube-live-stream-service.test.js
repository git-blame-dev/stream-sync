const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const testClock = require('../../helpers/test-clock');
const {
  expectNoTechnicalArtifacts,
  validateUserFacingString
} = require('../../helpers/assertion-helpers');
const { YouTubeLiveStreamService } = require('../../../src/services/youtube-live-stream-service');

describe('YouTube Live Stream Service - Complete User Experience', () => {
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

  describe('Live Stream Detection User Experience', () => {
    it('should provide live streams when user requests active channel streams', async () => {
      const channelId = 'UCactive1234567890123456';
      const mockChannel = {
        videos: {
          contents: [
            {
              id: 'live123',
              title: { text: 'Amazing Gaming Stream' },
              is_live: true,
              author: { name: 'Popular Gamer' },
              published: new Date(testClock.now()).toISOString()
            },
            {
              id: 'live456',
              title: { text: 'Music Live Performance' },
              is_live: true,
              author: { name: 'Music Artist' },
              published: new Date(testClock.now()).toISOString()
            }
          ]
        }
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger, timeout: 2000 }
      );

      expect(result.success).toBe(true);
      expect(result.streams).toBeDefined();
      expect(result.streams).toHaveLength(2);
      expect(result.count).toBe(2);
      expect(result.hasContent).toBe(true);

      expect(result.streams[0].videoId).toBe('live123');
      expect(result.streams[0].title).toBe('Amazing Gaming Stream');
      expect(result.streams[0].isLive).toBe(true);
      expect(result.streams[0].author).toBe('Popular Gamer');

      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
      expectNoTechnicalArtifacts(result.streams[1].title);
      expectNoTechnicalArtifacts(result.streams[1].author);

      validateUserFacingString(result.streams[0].title, { audience: 'general', minLength: 5 });
      validateUserFacingString(result.streams[1].title, { audience: 'general', minLength: 5 });
    });

    it('should still detect live streams when channel does not expose getLiveStreams()', async () => {
      const channelId = 'UC' + 'n'.repeat(22);
      const mockChannel = {
        videos: {
          contents: [{
            id: 'video789',
            title: { text: 'Live Coding Marathon' },
            is_live: true,
            author: { name: 'DevCreator' }
          }]
        },
        header: { title: 'DevCreator' }
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(true);
      expect(result.streams).toHaveLength(1);
      expect(result.streams[0].videoId).toBe('video789');
      expect(result.detectionMethod).toBe('channel_videos');
      expect(mockInnertubeClient.search).not.toHaveBeenCalled();
    });

    it('should handle channel with no live streams gracefully for users', async () => {
      const channelId = 'UCinactive12345678901234';
      const mockChannel = { videos: { contents: [] } };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(true);
      expect(result.streams).toHaveLength(0);
      expect(result.count).toBe(0);
      expect(result.hasContent).toBe(false);
      expect(result.streams).toBeDefined();
      expect(Array.isArray(result.streams)).toBe(true);
    });

    it('should fall back to search detection when channel data lacks live entries', async () => {
      const username = 'fallbackCreator';
      const resolvedChannelId = 'UC' + 'f'.repeat(22);
      const mockChannel = {
        videos: { contents: [] },
        header: { title: 'Fallback Creator' }
      };

      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);
      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: { browseId: resolvedChannelId }
      });
      mockInnertubeClient.search.mockResolvedValue({
        videos: [{
          id: 'searchLive123',
          title: { text: 'Live 🔴 Trading Session' },
          author: { id: resolvedChannelId, name: 'Fallback Creator' },
          is_live: true
        }]
      });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        username,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(true);
      expect(result.streams).toHaveLength(1);
      expect(result.streams[0].videoId).toBe('searchLive123');
      expect(result.detectionMethod).toBe('search');
      expect(mockInnertubeClient.search).toHaveBeenCalledTimes(1);
    });

    it('should provide stream metadata for user content discovery', async () => {
      const channelId = 'UCdiverse123456789012345';
      const mockChannel = {
        getLiveStreams: createMockFn().mockResolvedValue({
          videos: [{
            id: 'educational123',
            title: { text: 'Learn JavaScript - Interactive Coding Session' },
            is_live: true,
            author: { name: 'CodeEducator' },
            published: new Date(testClock.now()).toISOString(),
            view_count: '1,245 watching'
          }]
        })
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(true);
      expect(result.streams[0].title).toBe('Learn JavaScript - Interactive Coding Session');
      expect(result.streams[0].author).toBe('CodeEducator');
      expect(result.streams[0].isLive).toBe(true);
      expect(result.streams[0].videoId).toBe('educational123');

      expectNoTechnicalArtifacts(result.streams[0].title);
      validateUserFacingString(result.streams[0].title, {
        audience: 'general',
        minLength: 10,
        mustContain: ['JavaScript']
      });
    });
  });

  describe('Input Format Flexibility User Experience', () => {
    it('should accept Channel ID format directly from users', async () => {
      const channelId = 'UCaBcDeFgHiJkLmNoPqRsTuV';
      const mockChannel = {
        getLiveStreams: createMockFn().mockResolvedValue({
          videos: [{
            id: 'channelid123',
            title: { text: 'Channel ID Stream' },
            is_live: true,
            author: { name: 'Channel Author' }
          }]
        })
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(true);
      expect(result.streams[0].videoId).toBe('channelid123');
      expect(result.streams[0].title).toBe('Channel ID Stream');

      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
    });

    it('should resolve username input for user convenience', async () => {
      const username = 'popularcreator';
      const resolvedChannelId = 'UCresolved1234567890123';
      const mockChannel = {
        getLiveStreams: createMockFn().mockResolvedValue({
          videos: [{
            id: 'username123',
            title: { text: 'Creator Live Stream' },
            is_live: true,
            author: { name: 'Popular Creator' }
          }]
        })
      };

      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: { browseId: resolvedChannelId }
      });
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        username,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(true);
      expect(result.streams[0].videoId).toBe('username123');
      expect(result.streams[0].title).toBe('Creator Live Stream');
      expect(result.streams[0].author).toBe('Popular Creator');

      expectNoTechnicalArtifacts(result.streams[0].title);
      validateUserFacingString(result.streams[0].author, { audience: 'general', minLength: 5 });
    });

    it('should handle @username handle format for users', async () => {
      const handleInput = '@creativechannel';
      const resolvedChannelId = 'UChandle123456789012345';
      const mockChannel = {
        getLiveStreams: createMockFn().mockResolvedValue({
          videos: [{
            id: 'handle123',
            title: { text: 'Creative Live Stream' },
            is_live: true,
            author: { name: 'Creative Channel' }
          }]
        })
      };

      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: { browseId: resolvedChannelId }
      });
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        handleInput,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(true);
      expect(result.streams[0].videoId).toBe('handle123');
      expect(result.streams[0].title).toBe('Creative Live Stream');

      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
    });
  });

  describe('Error Handling User Experience', () => {
    it('should provide clear feedback when user input cannot be resolved', async () => {
      const nonExistentChannel = 'nonexistentchannel';
      mockInnertubeClient.resolveURL.mockResolvedValue({ payload: {} });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        nonExistentChannel,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Channel not found');
      expect(result.streams).toHaveLength(0);
      expect(result.count).toBe(0);

      expectNoTechnicalArtifacts(result.error);
      validateUserFacingString(result.error, {
        audience: 'general',
        minLength: 5,
        mustNotContain: ['undefined', 'null', 'API', 'search']
      });
    });

    it('should handle service errors gracefully for users', async () => {
      const channelId = 'UCerrortest1234567890123';
      mockInnertubeClient.getChannel.mockRejectedValue(new Error('Service temporarily unavailable'));

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Service temporarily unavailable');
      expect(result.streams).toHaveLength(0);

      expectNoTechnicalArtifacts(result.error);
      validateUserFacingString(result.error, { audience: 'general', minLength: 10 });
    });

    it('should handle null/undefined Channel responses for users', async () => {
      const problematicChannelId = 'UCnulltest12345678901234';
      mockInnertubeClient.getChannel.mockResolvedValue(null);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        problematicChannelId,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Channel not found');
      expect(result.error).toContain(problematicChannelId);
      expect(result.streams).toHaveLength(0);
      expect(result.error.length).toBeGreaterThan(20);
    });

    it('should handle timeout scenarios gracefully for users', async () => {
      const timeoutChannelId = 'UCtimeout123456789012345';
      mockInnertubeClient.getChannel.mockImplementation(() => new Promise(() => {}));

      const timeoutPromise = YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        timeoutChannelId,
        { logger: noOpLogger, timeout: 100 }
      );

      const result = await Promise.race([
        timeoutPromise,
        new Promise(resolve => scheduleTestTimeout(() => resolve({ timedOut: true }), 150))
      ]);

      if (result.timedOut) {
        expect(result.timedOut).toBe(true);
      } else {
        expect(result.success).toBe(false);
        expect(result.error).toContain('timeout');
      }
    });
  });

  describe('International Content User Experience', () => {
    it('should handle international stream titles correctly for global users', async () => {
      const internationalChannelId = 'UCinternational123456789';
      const mockChannel = {
        getLiveStreams: createMockFn().mockResolvedValue({
          videos: [{
            id: 'intl123',
            title: { text: 'Live Stream - 中文直播 - العربية المباشرة - ライブ配信' },
            is_live: true,
            author: { name: '国际创作者 International Creator' }
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
      expect(result.streams[0].title).toContain('中文直播');
      expect(result.streams[0].title).toContain('العربية المباشرة');
      expect(result.streams[0].title).toContain('ライブ配信');
      expect(result.streams[0].author).toContain('国际创作者');

      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
    });

    it('should handle emoji-rich content for modern user expectations', async () => {
      const emojiChannelId = 'UCemojichannel1234567890';
      const mockChannel = {
        getLiveStreams: createMockFn().mockResolvedValue({
          videos: [{
            id: 'emoji123',
            title: { text: '🎮 EPIC Gaming Stream! 🔥🚀 Join the Fun! 🎉✨' },
            is_live: true,
            author: { name: 'GamerPro 🎮🏆' }
          }]
        })
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        emojiChannelId,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(true);
      expect(result.streams[0].title).toContain('🎮');
      expect(result.streams[0].title).toContain('🔥');
      expect(result.streams[0].title).toContain('🎉');
      expect(result.streams[0].author).toContain('🎮');
      expect(result.streams[0].author).toContain('🏆');

      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
      validateUserFacingString(result.streams[0].title, { audience: 'general', minLength: 15 });
    });

    it('should preserve special characters in user content', async () => {
      const specialCharChannelId = 'UCspecial123456789012345';
      const mockChannel = {
        getLiveStreams: createMockFn().mockResolvedValue({
          videos: [{
            id: 'special123',
            title: { text: 'Music & Arts: "Live Concert" — Café Sessions (50% Off!)' },
            is_live: true,
            author: { name: 'Café Music & Arts™' }
          }]
        })
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        specialCharChannelId,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(true);
      expect(result.streams[0].title).toContain('&');
      expect(result.streams[0].title).toContain('"');
      expect(result.streams[0].title).toContain('—');
      expect(result.streams[0].title).toContain('(');
      expect(result.streams[0].title).toContain('%');
      expect(result.streams[0].author).toContain('™');

      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
    });
  });

  describe('Edge Cases and Resilience User Experience', () => {
    it('should handle empty/whitespace input gracefully for users', async () => {
      const emptyInputs = ['', '   ', '\t', '\n', null, undefined];

      for (const emptyInput of emptyInputs) {
        const result = await YouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          emptyInput,
          { logger: noOpLogger }
        );

        expect(result.success).toBe(false);
        expect(result.streams).toHaveLength(0);
        expect(result.error).toBeDefined();

        if (result.error) {
          expect(result.error.length).toBeGreaterThan(5);
          expect(typeof result.error).toBe('string');
        }
      }
    });

    it('should handle very long input strings from users', async () => {
      const longInput = 'very'.repeat(100) + 'longchannelname';
      mockInnertubeClient.resolveURL.mockResolvedValue({ payload: {} });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        longInput,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Channel not found');
      expect(result.streams).toHaveLength(0);

      expectNoTechnicalArtifacts(result.error);
    });

    it('should handle malformed Channel ID format gracefully', async () => {
      const malformedChannelId = 'UCinvalidformat123456789';
      mockInnertubeClient.getChannel.mockRejectedValue(new Error('Invalid channel format'));

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        malformedChannelId,
        { logger: noOpLogger }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid channel format');
      expect(result.streams).toHaveLength(0);

      expectNoTechnicalArtifacts(result.error);
      validateUserFacingString(result.error, { audience: 'general', minLength: 5 });
    });

    it('should maintain consistent response structure across all scenarios', async () => {
      const testScenarios = [
        {
          name: 'successful_streams',
          setupMock: () => {
            const mockChannel = {
              getLiveStreams: createMockFn().mockResolvedValue({
                videos: [{
                  id: 'test',
                  title: { text: 'Test' },
                  is_live: true,
                  author: { name: 'Test' }
                }]
              })
            };
            mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);
          },
          input: 'UCconsistent123456789012'
        },
        {
          name: 'no_streams',
          setupMock: () => {
            const mockChannel = {
              getLiveStreams: createMockFn().mockResolvedValue({ videos: [] })
            };
            mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);
          },
          input: 'UCempty1234567890123456'
        },
        {
          name: 'channel_not_found',
          setupMock: () => {
            mockInnertubeClient.resolveURL.mockResolvedValue({ payload: {} });
          },
          input: 'nonexistent'
        }
      ];

      for (const scenario of testScenarios) {
        clearAllMocks();
        scenario.setupMock();

        const result = await YouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          scenario.input,
          { logger: noOpLogger }
        );

        expect(result).toHaveProperty('success');
        expect(result).toHaveProperty('streams');
        expect(result).toHaveProperty('count');
        expect(Array.isArray(result.streams)).toBe(true);
        expect(typeof result.success).toBe('boolean');
        expect(typeof result.count).toBe('number');

        if (!result.success) {
          expect(result).toHaveProperty('error');
          expect(typeof result.error).toBe('string');
          expectNoTechnicalArtifacts(result.error);
        }

        expect(result.count).toBe(result.streams.length);
      }
    });
  });

  describe('Service Reliability User Experience', () => {
    it('should provide reliable service behavior for repeat users', async () => {
      const reliableChannelId = 'UCreliable12345678901234';
      const mockChannel = {
        getLiveStreams: createMockFn().mockResolvedValue({
          videos: [{
            id: 'reliable123',
            title: { text: 'Reliable Stream Content' },
            is_live: true,
            author: { name: 'Reliable Creator' }
          }]
        })
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const requestCount = 5;
      const results = [];

      for (let i = 0; i < requestCount; i++) {
        const result = await YouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          reliableChannelId,
          { logger: noOpLogger }
        );
        results.push(result);
      }

      results.forEach((result) => {
        expect(result.success).toBe(true);
        expect(result.streams).toHaveLength(1);
        expect(result.streams[0].videoId).toBe('reliable123');
        expect(result.streams[0].title).toBe('Reliable Stream Content');

        expectNoTechnicalArtifacts(result.streams[0].title);
        expectNoTechnicalArtifacts(result.streams[0].author);
      });

      expect(results.every(r => r.success)).toBe(true);
      expect(results.every(r => r.count === 1)).toBe(true);
    });

    it('should provide stable performance characteristics for users', async () => {
      const performanceChannelId = 'UCperformance12345678901';
      const mockChannel = {
        getLiveStreams: createMockFn().mockResolvedValue({
          videos: [{
            id: 'perf123',
            title: { text: 'Performance Test Stream' },
            is_live: true,
            author: { name: 'Performance Tester' }
          }]
        })
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const performanceTests = [];

      for (let i = 0; i < 3; i++) {
        const startTime = testClock.now();
        const result = await YouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          performanceChannelId,
          { logger: noOpLogger }
        );
        const simulatedResponseMs = 20;
        testClock.advance(simulatedResponseMs);
        const endTime = testClock.now();

        performanceTests.push({
          result: result,
          responseTime: endTime - startTime,
          testIndex: i
        });
      }

      performanceTests.forEach(({ result, responseTime }) => {
        expect(result.success).toBe(true);
        expect(responseTime).toBeLessThan(100);

        expectNoTechnicalArtifacts(result.streams[0].title);
        expectNoTechnicalArtifacts(result.streams[0].author);
      });

      const responseTimes = performanceTests.map(t => t.responseTime);
      const averageTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
      const maxTime = Math.max(...responseTimes);
      const minTime = Math.min(...responseTimes);

      expect(averageTime).toBeLessThan(50);
      expect(maxTime - minTime).toBeLessThan(30);
    });
  });
});
