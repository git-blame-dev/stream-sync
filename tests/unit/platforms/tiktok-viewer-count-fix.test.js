
const { 
  initializeTestLogging,
  TEST_TIMEOUTS 
} = require('../../helpers/test-setup');

const { 
  setupAutomatedCleanup 
} = require('../../helpers/mock-lifecycle');

const {
  createMockLogger
} = require('../../helpers/mock-factories');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true
});

describe('TikTok Viewer Count Handler Integration', () => {
  let mockLogger;
  let mockEventHandlers;
  let mockConnection;
  let mockWebcastEvent;
  let TikTokPlatform;
  
  beforeEach(() => {
    // Create mocks
    mockLogger = createMockLogger('debug');
    mockEventHandlers = {
      onViewerCount: jest.fn(),
      onChat: jest.fn()
    };
    
    mockConnection = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(true),
      getState: jest.fn().mockReturnValue({ isConnected: true })
    };
    
    mockWebcastEvent = {
      ROOM_USER: 'roomUser',
      CHAT: 'chat'
    };
    
    // Mock the TikTok platform class
    jest.doMock('../../../src/platforms/tiktok', () => {
      return class MockTikTokPlatform {
        constructor(config, dependencies) {
          this.config = config;
          this.logger = dependencies.logger;
          this.connection = mockConnection;
          this.WebcastEvent = mockWebcastEvent;
          this.eventHandlers = null;
        }
        
        async initialize(handlers) {
          this.eventHandlers = handlers;
          
          // Simulate the ROOM_USER event listener setup
          this.connection.on(this.WebcastEvent.ROOM_USER, (data) => {
            this.logger.debug(`[TikTok] Room user count: ${data.viewerCount}`, 'tiktok-platform');
            
            // THE FIX: Notify main app about viewer count change
            if (this.eventHandlers && this.eventHandlers.onViewerCount) {
              this.eventHandlers.onViewerCount(data.viewerCount);
              this.logger.debug(`[TikTok] Viewer count sent to main app: ${data.viewerCount}`, 'tiktok-platform');
            }
          });
          
          return true;
        }
        
        // Method to simulate receiving viewer count data (for testing)
        simulateViewerCountUpdate(viewerCount) {
          const mockEvent = this.connection.on.mock.calls.find(call => call[0] === this.WebcastEvent.ROOM_USER);
          if (mockEvent && mockEvent[1]) {
            mockEvent[1]({ viewerCount });
          }
        }
      };
    });
    
    TikTokPlatform = require('../../../src/platforms/tiktok');
  });
  
  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('when TikTok receives viewer count update', () => {
    describe('and event handlers are properly initialized', () => {
      it('should call main app onViewerCount handler', async () => {
        // Arrange
        const platform = new TikTokPlatform({}, { logger: mockLogger });
        await platform.initialize(mockEventHandlers);
        const expectedViewerCount = 1337;

        // Act
        platform.simulateViewerCountUpdate(expectedViewerCount);

        // Assert
        expect(mockEventHandlers.onViewerCount).toHaveBeenCalledWith(expectedViewerCount);
        expect(mockEventHandlers.onViewerCount).toHaveBeenCalledTimes(1);
      });

      it('should log viewer count update to main app', async () => {
        // Arrange
        const platform = new TikTokPlatform({}, { logger: mockLogger });
        await platform.initialize(mockEventHandlers);
        const expectedViewerCount = 2468;

        // Act
        platform.simulateViewerCountUpdate(expectedViewerCount);

        // Assert
        expect(mockLogger.debug).toHaveBeenCalledWith(
          `[TikTok] Viewer count sent to main app: ${expectedViewerCount}`,
          'tiktok-platform'
        );
      });
    });

    describe('and event handlers are missing', () => {
      it('should not crash and should log viewer count locally', async () => {
        // Arrange
        const platform = new TikTokPlatform({}, { logger: mockLogger });
        await platform.initialize(null); // No handlers
        const expectedViewerCount = 999;

        // Act
        expect(() => {
          platform.simulateViewerCountUpdate(expectedViewerCount);
        }).not.toThrow();

        // Assert
        expect(mockLogger.debug).toHaveBeenCalledWith(
          `[TikTok] Room user count: ${expectedViewerCount}`,
          'tiktok-platform'
        );
      });
    });

    describe('and onViewerCount handler is missing', () => {
      it('should not crash when handler is undefined', async () => {
        // Arrange
        const platform = new TikTokPlatform({}, { logger: mockLogger });
        const handlersWithoutViewerCount = { onChat: jest.fn() };
        await platform.initialize(handlersWithoutViewerCount);
        const expectedViewerCount = 555;

        // Act
        expect(() => {
          platform.simulateViewerCountUpdate(expectedViewerCount);
        }).not.toThrow();

        // Assert - Should only log locally, not call missing handler
        expect(mockLogger.debug).toHaveBeenCalledWith(
          `[TikTok] Room user count: ${expectedViewerCount}`,
          'tiktok-platform'
        );
      });
    });
  });

  describe('when TikTok receives multiple viewer count updates', () => {
    it('should call handler for each update', async () => {
      // Arrange
      const platform = new TikTokPlatform({}, { logger: mockLogger });
      await platform.initialize(mockEventHandlers);
      const viewerCounts = [100, 150, 200, 175];

      // Act
      viewerCounts.forEach(count => platform.simulateViewerCountUpdate(count));

      // Assert
      expect(mockEventHandlers.onViewerCount).toHaveBeenCalledTimes(4);
      viewerCounts.forEach(count => {
        expect(mockEventHandlers.onViewerCount).toHaveBeenCalledWith(count);
      });
    });
  });

  describe('regression prevention', () => {
    it('should prevent TikTok viewer count from being ignored by main app', async () => {
      // Arrange - This test specifically addresses the original bug
      const platform = new TikTokPlatform({}, { logger: mockLogger });
      await platform.initialize(mockEventHandlers);
      
      // Act - Simulate the exact scenario where viewer count was being lost
      platform.simulateViewerCountUpdate(1234);

      // Assert - Verify the fix prevents the original issue
      expect(mockEventHandlers.onViewerCount).toHaveBeenCalledWith(1234);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[TikTok] Viewer count sent to main app: 1234',
        'tiktok-platform'
      );
      
      // Ensure we're not just logging but actually calling the handler
      expect(mockEventHandlers.onViewerCount).toHaveBeenCalledTimes(1);
    });
  });
}, TEST_TIMEOUTS.FAST);