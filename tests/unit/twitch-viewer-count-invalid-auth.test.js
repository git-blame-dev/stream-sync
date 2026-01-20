
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { noOpLogger } = require('../helpers/mock-factories');

const { TwitchViewerCountProvider } = require('../../src/utils/viewer-count-providers');

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
    mockApiClient = {
      getStreamInfo: createMockFn()
    };

    mockConnectionStateFactory = {
      createTwitchState: createMockFn()
    };

    mockConfig = {
      channel: 'hero_stream',
      username: 'hero_stream',
      accessToken: 'new_access_123456789',
    };

    mockLogger = noOpLogger;
  });

  describe('when authentication is invalid but channel is configured', () => {
    beforeEach(() => {
      mockApiClient.getStreamInfo.mockResolvedValue({
        isLive: true,
        viewerCount: 15
      });

      viewerCountProvider = new TwitchViewerCountProvider(
        mockApiClient,
        mockConnectionStateFactory,
        mockConfig,
        null,
        mockLogger
      );
    });

    it('should report ready when channel is configured (auth independent)', () => {
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
        channel: '',
        username: 'hero_stream',
        accessToken: 'new_access_123456789'
      };

      viewerCountProvider = new TwitchViewerCountProvider(
        mockApiClient,
        mockConnectionStateFactory,
        invalidConfig,
        null,
        mockLogger
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
      const mockState = {
        isApiReady: createMockFn().mockReturnValue(true),
        isConnected: true,
        channel: 'hero_stream',
        username: 'hero_stream'
      };
      mockConnectionStateFactory.createTwitchState.mockReturnValue(mockState);
      mockApiClient.getStreamInfo.mockRejectedValue(new Error('Network error'));

      viewerCountProvider = new TwitchViewerCountProvider(
        mockApiClient,
        mockConnectionStateFactory,
        mockConfig,
        null,
        mockLogger
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
      const mockState = {
        isApiReady: createMockFn().mockReturnValue(true),
        isConnected: true,
        channel: 'hero_stream',
        username: 'hero_stream'
      };
      mockConnectionStateFactory.createTwitchState.mockReturnValue(mockState);
      mockApiClient.getStreamInfo.mockResolvedValue({
        isLive: true,
        viewerCount: 42
      });

      viewerCountProvider = new TwitchViewerCountProvider(
        mockApiClient,
        mockConnectionStateFactory,
        mockConfig,
        null,
        mockLogger
      );
    });

    it('should return actual viewer count when API succeeds', async () => {
      const viewerCount = await viewerCountProvider.getViewerCount();
      expect(viewerCount).toBe(42);
    });
  });

  describe('REGRESSION TEST: Real-world invalid token scenario', () => {
    it('should handle the exact configuration causing the issue', () => {
      const realWorldConfig = {
        channel: 'hero_stream',
        username: 'hero_stream',
        accessToken: 'new_access_123456789',
        refreshToken: 'new_refresh_123456789'
      };

      const provider = new TwitchViewerCountProvider(
        mockApiClient,
        mockConnectionStateFactory,
        realWorldConfig,
        null,
        mockLogger
      );

      expect(provider.isReady()).toBe(true);
    });

    it('should work even when EventSub fails to initialize', async () => {
      const realWorldConfig = {
        channel: 'hero_stream',
        username: 'hero_stream'
      };
      mockApiClient.getStreamInfo.mockResolvedValue({
        isLive: true,
        viewerCount: 25
      });

      const provider = new TwitchViewerCountProvider(
        mockApiClient,
        mockConnectionStateFactory,
        realWorldConfig,
        null,
        mockLogger
      );

      const viewerCount = await provider.getViewerCount();
      expect(viewerCount).toBe(25);
    });
  });
});
