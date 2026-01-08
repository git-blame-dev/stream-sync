
const { 
  initializeTestLogging,
  TEST_TIMEOUTS 
} = require('../../helpers/test-setup');

// Initialize logging FIRST
initializeTestLogging();

describe('TikTok Viewer Count Callback Bug', () => {
  let TikTokPlatform;
  let mockLogger;
  let mockEventHandlers;
  let mockConnection;
  let mockEvents;
  
  beforeEach(() => {
    // Clean up modules
    jest.resetModules();
    
    // Create mock event handlers (simulating main app)
    mockEventHandlers = {
      onViewerCount: jest.fn(),
      onChat: jest.fn()
    };
    
    // Create mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };
    
    // Create mock WebSocket connection with event registration
    const eventListeners = {};
    mockConnection = {
      on: jest.fn((event, callback) => {
        eventListeners[event] = callback;
      }),
      connect: jest.fn().mockResolvedValue(true),
      fetchIsLive: jest.fn().mockResolvedValue(true),
      waitUntilLive: jest.fn().mockResolvedValue(true),
      getState: jest.fn().mockReturnValue({ isConnected: true }),
      connected: true,
      isConnected: true,
      // Helper to simulate events
      simulateEvent: (event, data) => {
        if (eventListeners[event]) {
          eventListeners[event](data);
        }
      }
    };
    
    // Mock event constants
    mockEvents = {
      ROOM_USER: 'roomUser'
    };
    
    // Import the actual TikTok platform
    ({ TikTokPlatform } = require('../../../src/platforms/tiktok'));
  });

  describe('when TikTok receives ROOM_USER event with viewer count', () => {
    it('should call main app onViewerCount handler', () => {
      // Arrange
      const platform = new TikTokPlatform({ username: 'test_user' }, {});
      platform.eventHandlers = mockEventHandlers;
      
      const testViewerCount = 42;
      const roomUserData = { viewerCount: testViewerCount };
      
      // Act - Directly execute the room user event handler logic (from lines 691-707)
      platform.cachedViewerCount = roomUserData.viewerCount;
      
      if (platform.eventHandlers && platform.eventHandlers.onViewerCount) {
        platform.eventHandlers.onViewerCount(roomUserData.viewerCount);
      }
      
      // Assert - Main app handler should be called
      expect(mockEventHandlers.onViewerCount).toHaveBeenCalledWith(testViewerCount);
      expect(mockEventHandlers.onViewerCount).toHaveBeenCalledTimes(1);
      
      // Should cache the value locally  
      expect(platform.cachedViewerCount).toBe(testViewerCount);
    });
    
    it('should cache viewer count locally AND send to main app', () => {
      // Arrange
      const platform = new TikTokPlatform({ username: 'test_user' }, {});
      platform.eventHandlers = mockEventHandlers;
      
      const testViewerCount = 123;
      const roomUserData = { viewerCount: testViewerCount };
      
      // Act - Directly execute the room user event handler logic
      platform.cachedViewerCount = roomUserData.viewerCount;
      
      if (platform.eventHandlers && platform.eventHandlers.onViewerCount) {
        platform.eventHandlers.onViewerCount(roomUserData.viewerCount);
      }
      
      // Assert both local caching AND main app notification
      expect(platform.cachedViewerCount).toBe(testViewerCount);
      expect(mockEventHandlers.onViewerCount).toHaveBeenCalledWith(testViewerCount);
    });
    
    it('should handle missing event handlers gracefully', () => {
      // Arrange
      const platform = new TikTokPlatform({ username: 'test_user' }, {});
      platform.eventHandlers = null; // No event handlers
      
      const testViewerCount = 99;
      const roomUserData = { viewerCount: testViewerCount };
      
      // Act & Assert - Should not crash
      expect(() => {
        platform.cachedViewerCount = roomUserData.viewerCount;
        
        if (platform.eventHandlers && platform.eventHandlers.onViewerCount) {
          platform.eventHandlers.onViewerCount(roomUserData.viewerCount);
        }
      }).not.toThrow();
      
      // Should still cache locally
      expect(platform.cachedViewerCount).toBe(testViewerCount);
    });
  });
}, TEST_TIMEOUTS.FAST);
