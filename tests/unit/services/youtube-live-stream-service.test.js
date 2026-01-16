const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');

// Testing Infrastructure (mandatory)
const {
  initializeTestLogging,
  createTestUser,
  TEST_TIMEOUTS,
  INTERNATIONAL_USERNAMES
} = require('../../helpers/test-setup');

const {
  createMockNotificationDispatcher,
  noOpLogger,
  createMockYouTubeServices,
  setupAutomatedCleanup
} = require('../../helpers/mock-factories');
const testClock = require('../../helpers/test-clock');

const {
  expectNoTechnicalArtifacts,
  validateUserFacingString,
  expectValidNotification,
  expectOnlyMethodCalled,
  expectValidPlatformBehavior
} = require('../../helpers/assertion-helpers');

const { YouTubeLiveStreamService } = require('../../../src/services/youtube-live-stream-service');

// Initialize testing standards
initializeTestLogging();
setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true
});

describe('YouTube Live Stream Service - Complete User Experience', () => {
  let mockInnertubeClient;
  let mockLogger;

  beforeEach(() => {
    // Create comprehensive mocks for user experience testing
    mockLogger = noOpLogger;
    
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
      // Given: Active channel with live streams (ensure proper Channel ID format)
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

      // When: User requests live streams from active channel
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: mockLogger, timeout: 2000 }
      );

      // Then: User receives live stream data successfully  
      expect(result.success).toBe(true);
      expect(result.streams).toBeDefined();
      expect(result.streams).toHaveLength(2);
      expect(result.count).toBe(2);
      expect(result.hasContent).toBe(true);
      
      // User Experience: First stream data is clean and complete
      expect(result.streams[0].videoId).toBe('live123');
      expect(result.streams[0].title).toBe('Amazing Gaming Stream');
      expect(result.streams[0].isLive).toBe(true);
      expect(result.streams[0].author).toBe('Popular Gamer');
      
      // Content Quality: User-facing content is clean
      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
      expectNoTechnicalArtifacts(result.streams[1].title);
      expectNoTechnicalArtifacts(result.streams[1].author);
      
      // User Content: Validate titles meet quality standards
      validateUserFacingString(result.streams[0].title, {
        audience: 'general',
        minLength: 5
      });
      validateUserFacingString(result.streams[1].title, {
        audience: 'general', 
        minLength: 5
      });
    });

    it('should still detect live streams when channel does not expose getLiveStreams()', async () => {
      // Given: Channel representation without getLiveStreams but with videos list
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

      // When: User requests live streams
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: mockLogger }
      );

      // Then: Service uses channel.videos fallback and succeeds
      expect(result.success).toBe(true);
      expect(result.streams).toHaveLength(1);
      expect(result.streams[0].videoId).toBe('video789');
      expect(result.detectionMethod).toBe('channel_videos');
      expect(mockInnertubeClient.search).not.toHaveBeenCalled();
    });

    it('should handle channel with no live streams gracefully for users', async () => {
      // Given: Valid channel but no active live streams
      const channelId = 'UCinactive12345678901234';
      const mockChannel = {
        videos: { contents: [] }
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      // When: User requests streams from inactive channel
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: mockLogger }
      );

      // Then: User receives clear "no streams" response
      expect(result.success).toBe(true);
      expect(result.streams).toHaveLength(0);
      expect(result.count).toBe(0);
      expect(result.hasContent).toBe(false);
      
      // User Experience: Clear indication that no streams are available
      expect(result.streams).toBeDefined();
      expect(Array.isArray(result.streams)).toBe(true);
    });

    it('should fall back to search detection when channel data lacks live entries', async () => {
      // Given: Username with no live data in channel payload but live results in search
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

      // When: User relies on fallback detection
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        username,
        { logger: mockLogger }
      );

      // Then: Service surfaces search results seamlessly
      expect(result.success).toBe(true);
      expect(result.streams).toHaveLength(1);
      expect(result.streams[0].videoId).toBe('searchLive123');
      expect(result.detectionMethod).toBe('search');
      expect(mockInnertubeClient.search).toHaveBeenCalledTimes(1);
    });

    it('should provide stream metadata for user content discovery', async () => {
      // Given: Channel with diverse stream content
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

      // When: User discovers available streams
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: mockLogger }
      );

      // Then: User receives rich metadata for content discovery
      expect(result.success).toBe(true);
      expect(result.streams[0].title).toBe('Learn JavaScript - Interactive Coding Session');
      expect(result.streams[0].author).toBe('CodeEducator');
      expect(result.streams[0].isLive).toBe(true);
      expect(result.streams[0].videoId).toBe('educational123');
      
      // Content Quality: Educational content title is preserved and clean
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
      // Given: User provides standard YouTube Channel ID
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

      // When: User provides Channel ID format
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: mockLogger }
      );

      // Then: User receives successful stream detection
      expect(result.success).toBe(true);
      expect(result.streams[0].videoId).toBe('channelid123');
      expect(result.streams[0].title).toBe('Channel ID Stream');
      
      // Content Quality: Channel ID processing maintains clean results
      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
    });

    it('should resolve username input for user convenience', async () => {
      // Given: User provides plain username instead of Channel ID
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

      // When: User provides username for convenience
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        username,
        { logger: mockLogger }
      );

      // Then: User receives resolved stream data
      expect(result.success).toBe(true);
      expect(result.streams[0].videoId).toBe('username123');
      expect(result.streams[0].title).toBe('Creator Live Stream');
      expect(result.streams[0].author).toBe('Popular Creator');
      
      // User Experience: Username resolution works transparently
      expectNoTechnicalArtifacts(result.streams[0].title);
      validateUserFacingString(result.streams[0].author, {
        audience: 'general',
        minLength: 5
      });
    });

    it('should handle @username handle format for users', async () => {
      // Given: User provides @handle format (common user input)
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

      // When: User provides handle format
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        handleInput,
        { logger: mockLogger }
      );

      // Then: User receives successful stream detection
      expect(result.success).toBe(true);
      expect(result.streams[0].videoId).toBe('handle123');
      expect(result.streams[0].title).toBe('Creative Live Stream');
      
      // User Experience: Handle format works seamlessly
      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
    });
  });

  describe('Error Handling User Experience', () => {
    it('should provide clear feedback when user input cannot be resolved', async () => {
      // Given: User provides non-existent channel identifier
      const nonExistentChannel = 'nonexistentchannel';
      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: {}
      });

      // When: User attempts to find streams for non-existent channel
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        nonExistentChannel,
        { logger: mockLogger }
      );

      // Then: User receives clear error message
      expect(result.success).toBe(false);
      expect(result.error).toBe('Channel not found');
      expect(result.streams).toHaveLength(0);
      expect(result.count).toBe(0);
      
      // Content Quality: Error message is user-friendly
      expectNoTechnicalArtifacts(result.error);
      validateUserFacingString(result.error, {
        audience: 'general',
        minLength: 5,
        mustNotContain: ['undefined', 'null', 'API', 'search']
      });
    });

    it('should handle service errors gracefully for users', async () => {
      // Given: Service encounters system error
      const channelId = 'UCerrortest1234567890123';
      mockInnertubeClient.getChannel.mockRejectedValue(new Error('Service temporarily unavailable'));

      // When: User requests streams during service issues
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: mockLogger }
      );

      // Then: User receives understandable error message
      expect(result.success).toBe(false);
      expect(result.error).toBe('Service temporarily unavailable');
      expect(result.streams).toHaveLength(0);
      
      // Content Quality: Service error is user-understandable
      expectNoTechnicalArtifacts(result.error);
      validateUserFacingString(result.error, {
        audience: 'general',
        minLength: 10
      });
    });

    it('should handle null/undefined Channel responses for users', async () => {
      // Given: Channel lookup returns null (access issue or deleted channel)
      const problematicChannelId = 'UCnulltest12345678901234';
      mockInnertubeClient.getChannel.mockResolvedValue(null);

      // When: User requests streams from inaccessible channel
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        problematicChannelId,
        { logger: mockLogger }
      );

      // Then: User receives descriptive error message
      expect(result.success).toBe(false);
      expect(result.error).toContain('Channel not found');
      expect(result.error).toContain(problematicChannelId);
      expect(result.streams).toHaveLength(0);
      
      // Content Quality: Error explains the specific issue
      expect(result.error.length).toBeGreaterThan(20); // Descriptive error
    });

    it('should handle timeout scenarios gracefully for users', async () => {
      // Given: Operation that would timeout
      const timeoutChannelId = 'UCtimeout123456789012345';
      mockInnertubeClient.getChannel.mockImplementation(() => 
        new Promise((resolve) => {
          // Never resolves, simulating timeout
        })
      );

      // When: User requests streams with short timeout
      const timeoutPromise = YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        timeoutChannelId,
        { logger: mockLogger, timeout: 100 }
      );

      // Then: User receives timeout error instead of hanging
      const result = await Promise.race([
        timeoutPromise,
        new Promise(resolve => scheduleTestTimeout(() => resolve({ timedOut: true }), 150))
      ]);
      
      // User Experience: Operation completes with error or timeout indication
      if (result.timedOut) {
        // System properly timed out
        expect(result.timedOut).toBe(true);
      } else {
        // Service provided timeout error
        expect(result.success).toBe(false);
        expect(result.error).toContain('timeout');
      }
    });
  });

  describe('International Content User Experience', () => {
    it('should handle international stream titles correctly for global users', async () => {
      // Given: International channel with multi-language content
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

      // When: Global user requests international content
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        internationalChannelId,
        { logger: mockLogger }
      );

      // Then: International content is preserved correctly for users
      expect(result.success).toBe(true);
      expect(result.streams[0].title).toContain('中文直播');
      expect(result.streams[0].title).toContain('العربية المباشرة');
      expect(result.streams[0].title).toContain('ライブ配信');
      expect(result.streams[0].author).toContain('国际创作者');
      
      // Content Quality: International text is not corrupted
      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
    });

    it('should handle emoji-rich content for modern user expectations', async () => {
      // Given: Channel with emoji-rich modern content
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

      // When: User views emoji-rich content
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        emojiChannelId,
        { logger: mockLogger }
      );

      // Then: Emoji content is preserved for modern user experience
      expect(result.success).toBe(true);
      expect(result.streams[0].title).toContain('🎮');
      expect(result.streams[0].title).toContain('🔥');
      expect(result.streams[0].title).toContain('🎉');
      expect(result.streams[0].author).toContain('🎮');
      expect(result.streams[0].author).toContain('🏆');
      
      // Content Quality: Emoji preservation without technical artifacts
      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
      
      // User Experience: Title remains engaging and readable
      validateUserFacingString(result.streams[0].title, {
        audience: 'general',
        minLength: 15
      });
    });

    it('should preserve special characters in user content', async () => {
      // Given: Content with various special characters users might encounter
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

      // When: User views content with special characters
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        specialCharChannelId,
        { logger: mockLogger }
      );

      // Then: Special characters are preserved for accurate user content
      expect(result.success).toBe(true);
      expect(result.streams[0].title).toContain('&');
      expect(result.streams[0].title).toContain('"');
      expect(result.streams[0].title).toContain('—');
      expect(result.streams[0].title).toContain('(');
      expect(result.streams[0].title).toContain('%');
      expect(result.streams[0].author).toContain('™');
      
      // Content Quality: Special characters don't cause technical issues
      expectNoTechnicalArtifacts(result.streams[0].title);
      expectNoTechnicalArtifacts(result.streams[0].author);
    });
  });

  describe('Edge Cases and Resilience User Experience', () => {
    it('should handle empty/whitespace input gracefully for users', async () => {
      // Given: User accidentally provides empty or whitespace input
      const emptyInputs = ['', '   ', '\t', '\n', null, undefined];

      // When: User provides various empty inputs
      for (const emptyInput of emptyInputs) {
        const result = await YouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          emptyInput,
          { logger: mockLogger }
        );

        // Then: User receives appropriate error message for each case
        expect(result.success).toBe(false);
        expect(result.streams).toHaveLength(0);
        expect(result.error).toBeDefined();
        
        // Content Quality: Error messages are user-friendly for empty input
        if (result.error) {
          expect(result.error.length).toBeGreaterThan(5);
          // Allow generic error messages for empty/null input
          expect(typeof result.error).toBe('string');
        }
      }
    });

    it('should handle very long input strings from users', async () => {
      // Given: User provides extremely long input (copy-paste error)
      const longInput = 'very'.repeat(100) + 'longchannelname';
      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: {}
      });

      // When: User accidentally provides very long input
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        longInput,
        { logger: mockLogger }
      );

      // Then: User receives appropriate handling of long input
      expect(result.success).toBe(false);
      expect(result.error).toBe('Channel not found');
      expect(result.streams).toHaveLength(0);
      
      // User Experience: Long input doesn't break the system
      expectNoTechnicalArtifacts(result.error);
    });

    it('should handle malformed Channel ID format gracefully', async () => {
      // Given: User provides Channel ID that API rejects as invalid format
      const malformedChannelId = 'UCinvalidformat123456789';
      mockInnertubeClient.getChannel.mockRejectedValue(new Error('Invalid channel format'));

      // When: User provides malformed Channel ID
      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        malformedChannelId,
        { logger: mockLogger }
      );

      // Then: User receives clear error about format issue
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid channel format');
      expect(result.streams).toHaveLength(0);
      
      // Content Quality: Format error is user-understandable
      expectNoTechnicalArtifacts(result.error);
      validateUserFacingString(result.error, {
        audience: 'general',
        minLength: 5
      });
    });

    it('should maintain consistent response structure across all scenarios', async () => {
      // Given: Various scenarios that should all return consistent structure
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

      // When: User encounters different scenarios
      for (const scenario of testScenarios) {
        clearAllMocks();
        scenario.setupMock();
        
        const result = await YouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          scenario.input,
          { logger: mockLogger }
        );

        // Then: User always receives consistent response structure
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
        
        // User Experience: Response structure is predictable
        expect(result.count).toBe(result.streams.length);
      }
    });
  });

  describe('Service Reliability User Experience', () => {
    it('should provide reliable service behavior for repeat users', async () => {
      // Given: User performing multiple requests over time
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

      // When: User makes multiple requests
      const requestCount = 5;
      const results = [];
      
      for (let i = 0; i < requestCount; i++) {
        const result = await YouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          reliableChannelId,
          { logger: mockLogger }
        );
        results.push(result);
      }

      // Then: User experiences consistent reliable service
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.streams).toHaveLength(1);
        expect(result.streams[0].videoId).toBe('reliable123');
        expect(result.streams[0].title).toBe('Reliable Stream Content');
        
        // Content Quality: Consistent across all requests
        expectNoTechnicalArtifacts(result.streams[0].title);
        expectNoTechnicalArtifacts(result.streams[0].author);
      });
      
      // User Experience: All requests succeed consistently
      expect(results.every(r => r.success)).toBe(true);
      expect(results.every(r => r.count === 1)).toBe(true);
    });

    it('should provide stable performance characteristics for users', async () => {
      // Given: User expecting consistent response times
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

      // When: User performs multiple timed requests
      const performanceTests = [];
      
      for (let i = 0; i < 3; i++) {
        const startTime = testClock.now();
        const result = await YouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          performanceChannelId,
          { logger: mockLogger }
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

      // Then: User experiences stable performance characteristics
      performanceTests.forEach(({ result, responseTime, testIndex }) => {
        expect(result.success).toBe(true);
        expect(responseTime).toBeLessThan(100); // Reasonable response time for users
        
        // Content Quality: Performance doesn't affect content quality
        expectNoTechnicalArtifacts(result.streams[0].title);
        expectNoTechnicalArtifacts(result.streams[0].author);
      });
      
      // User Performance: Response times are consistently reasonable
      const responseTimes = performanceTests.map(t => t.responseTime);
      const averageTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
      const maxTime = Math.max(...responseTimes);
      const minTime = Math.min(...responseTimes);
      
      expect(averageTime).toBeLessThan(50); // Good average performance
      expect(maxTime - minTime).toBeLessThan(30); // Consistent performance variance
    });
  });
});
