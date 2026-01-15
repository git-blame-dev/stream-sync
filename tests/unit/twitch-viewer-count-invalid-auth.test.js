
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { 
  initializeTestLogging,
  createTestUser, 
  TEST_TIMEOUTS 
} = require('../helpers/test-setup');

const { 
  createMockLogger
} = require('../helpers/mock-factories');

const { TwitchViewerCountProvider } = require('../../src/utils/viewer-count-providers');

// Initialize FIRST
initializeTestLogging();

describe('Twitch Viewer Count with Invalid Authentication', () => {
    afterEach(() => {
        restoreAllMocks();
    });

  let mockApiClient;
  let mockConnectionStateFactory;
  let mockConfig;
  let viewerCountProvider;
  let mockLogger;
  
  beforeEach(() => {
    // Mock API client that simulates auth failure
    mockApiClient = {
      getStreamInfo: createMockFn()
    };
    
    // Mock connection state factory
    mockConnectionStateFactory = {
      createTwitchState: createMockFn()
    };
    
    // Mock config with invalid tokens (like in the issue)
    mockConfig = {
      channel: 'hero_stream',
      username: 'hero_stream',
      apiKey: 'new_key_123456789', // Invalid placeholder token
      accessToken: 'new_access_123456789', // Invalid placeholder token
    };
    
    // Create mock logger using the factory
    mockLogger = createMockLogger();
  });

  describe('when authentication is invalid but channel is configured', () => {
    beforeEach(() => {
      // Mock API client to simulate auth failure (but viewer count should still work)
      mockApiClient.getStreamInfo.mockResolvedValue({
        isLive: true,
        viewerCount: 15 // Public stream info should work despite auth issues
      });
      
      viewerCountProvider = new TwitchViewerCountProvider(
        mockApiClient,
        mockConnectionStateFactory, 
        mockConfig,
        null, // getCurrentEventSub
        mockLogger // Pass mock logger
      );
    });

    it('should report ready when channel is configured (auth independent)', () => {
      // NEW BEHAVIOR: Viewer count should work independently of EventSub auth
      expect(viewerCountProvider.isReady()).toBe(true);
    });

    it('should return actual viewer count even with auth issues', async () => {
      const viewerCount = await viewerCountProvider.getViewerCount();
      expect(viewerCount).toBe(15);
    });

    it('should call API even when EventSub auth fails', async () => {
      await viewerCountProvider.getViewerCount();
      expect(mockApiClient.getStreamInfo).toHaveBeenCalledWith('hero_stream');
    });
  });

  describe('when channel is not configured', () => {
    beforeEach(() => {
      const invalidConfig = {
        channel: '', // Missing channel
        username: 'hero_stream',
        apiKey: 'new_key_123456789'
      };
      
      viewerCountProvider = new TwitchViewerCountProvider(
        mockApiClient,
        mockConnectionStateFactory,
        invalidConfig,
        null, // getCurrentEventSub
        mockLogger // Pass mock logger
      );
    });

    it('should report not ready when channel is missing', () => {
      expect(viewerCountProvider.isReady()).toBe(false);
    });

    it('should return 0 when channel is not configured', async () => {
      const viewerCount = await viewerCountProvider.getViewerCount();
      expect(viewerCount).toBe(0);
    });
  });

  describe('when authentication is valid but API call fails', () => {
    beforeEach(() => {
      // Mock connection state that reports ready (auth OK)
      const mockState = {
        isApiReady: createMockFn().mockReturnValue(true), // Auth OK
        isConnected: true,
        channel: 'hero_stream', 
        username: 'hero_stream'
      };
      
      mockConnectionStateFactory.createTwitchState.mockReturnValue(mockState);
      
      // Mock API client to simulate API call failure
      mockApiClient.getStreamInfo.mockRejectedValue(new Error('Network error'));
      
      viewerCountProvider = new TwitchViewerCountProvider(
        mockApiClient,
        mockConnectionStateFactory,
        mockConfig,
        null, // getCurrentEventSub
        mockLogger // Pass mock logger
      );
    });

    it('should report ready when authentication is valid', () => {
      expect(viewerCountProvider.isReady()).toBe(true);
    });

    it('should return 0 when API call fails', async () => {
      const viewerCount = await viewerCountProvider.getViewerCount();
      expect(viewerCount).toBe(0);
    });

    it('should call API when provider is ready', async () => {
      await viewerCountProvider.getViewerCount();
      expect(mockApiClient.getStreamInfo).toHaveBeenCalledWith('hero_stream');
    });
  });

  describe('when authentication is valid and API returns data', () => {
    beforeEach(() => {
      // Mock connection state that reports ready
      const mockState = {
        isApiReady: createMockFn().mockReturnValue(true),
        isConnected: true,
        channel: 'hero_stream',
        username: 'hero_stream'
      };
      
      mockConnectionStateFactory.createTwitchState.mockReturnValue(mockState);
      
      // Mock successful API response
      mockApiClient.getStreamInfo.mockResolvedValue({
        isLive: true,
        viewerCount: 42
      });
      
      viewerCountProvider = new TwitchViewerCountProvider(
        mockApiClient,
        mockConnectionStateFactory,
        mockConfig,
        null, // getCurrentEventSub
        mockLogger // Pass mock logger
      );
    });

    it('should return actual viewer count when API succeeds', async () => {
      const viewerCount = await viewerCountProvider.getViewerCount();
      expect(viewerCount).toBe(42);
    });
  });

  describe('REGRESSION TEST: Real-world invalid token scenario', () => {
    it('should handle the exact configuration causing the issue', () => {
      // This reproduces the exact problem from the user's logs
      const realWorldConfig = {
        channel: 'hero_stream', // Channel is configured
        username: 'hero_stream', 
        apiKey: 'new_key_123456789', // These are the actual placeholder tokens from config.ini
        accessToken: 'new_access_123456789',
        refreshToken: 'new_refresh_123456789'
      };
      
      const provider = new TwitchViewerCountProvider(
        mockApiClient,
        mockConnectionStateFactory,
        realWorldConfig,
        null, // getCurrentEventSub
        mockLogger // Pass mock logger
      );
      
      // Expected behavior: Should be ready since channel is configured
      // Viewer count is independent of EventSub auth status
      expect(provider.isReady()).toBe(true);
    });
    
    it('should work even when EventSub fails to initialize', async () => {
      const realWorldConfig = {
        channel: 'hero_stream',
        username: 'hero_stream', 
        apiKey: 'new_key_123456789'
      };
      
      // Mock successful stream info API call (public API, no auth needed)
      mockApiClient.getStreamInfo.mockResolvedValue({
        isLive: true,
        viewerCount: 25
      });
      
      const provider = new TwitchViewerCountProvider(
        mockApiClient,
        mockConnectionStateFactory,
        realWorldConfig,
        null, // getCurrentEventSub
        mockLogger // Pass mock logger
      );
      
      const viewerCount = await provider.getViewerCount();
      expect(viewerCount).toBe(25);
    });
  });
});
