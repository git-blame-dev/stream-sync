
const { 
  initializeTestLogging,
  createTestUser, 
  TEST_TIMEOUTS 
} = require('../helpers/test-setup');

const { 
  createMockNotificationDispatcher,
  createMockLogger,
  createMockTikTokServices 
} = require('../helpers/mock-factories');

const { 
  setupAutomatedCleanup
} = require('../helpers/mock-lifecycle');

// Mock the logger-utils module
jest.mock('../../src/utils/logger-utils', () => ({
  getLazyLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }),
  createNoopLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }),
  getLoggerOrNoop: (logger) => logger || ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }),
  getLazyUnifiedLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

// Mock message normalization module
jest.mock('../../src/utils/message-normalization', () => ({
  normalizeTikTokMessage: jest.fn(() => ({
    message: 'test message',
    username: 'testuser',
    platform: 'tiktok'
  })),
  validateNormalizedMessage: jest.fn(() => ({ isValid: true, issues: [] }))
}));

// Initialize logging FIRST
initializeTestLogging();

// Override the global TikTokPlatform mock to use the real implementation for construction testing
jest.doMock('../../src/platforms/tiktok', () => {
    // Import the actual TikTokPlatform for construction tests
    const actualModule = jest.requireActual('../../src/platforms/tiktok');
    return {
        ...actualModule,
        // Keep the real TikTokPlatform constructor
        TikTokPlatform: actualModule.TikTokPlatform
    };
});

// Setup automated cleanup
setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true
});

const { TikTokPlatform } = require('../../src/platforms/tiktok');

describe('TikTok Platform Validation', () => {
  let mockLogger;
  let mockTikTokServices;

  beforeEach(() => {
    mockLogger = createMockLogger('debug');
    mockTikTokServices = createMockTikTokServices();
  });

  describe('Platform Construction and Basic Validation', () => {
    it('should be importable and constructible', () => {
      // Arrange & Act
      expect(TikTokPlatform).toBeDefined();
      expect(typeof TikTokPlatform).toBe('function');
      
      // Verify we can create an instance without errors
      const config = {
        enabled: true,
        username: 'test_user'
      };
      
      const dependencies = {
        logger: mockLogger,
        TikTokWebSocketClient: jest.fn(),
        WebcastEvent: { CHAT: 'chat', GIFT: 'gift', FOLLOW: 'follow' },
        ControlEvent: { CONNECTED: 'connected' },
        WebcastPushConnection: jest.fn(),
        constants: { GRACE_PERIODS: { TIKTOK: 5000 } }
      };
      
      let platform;
      expect(() => {
        platform = new TikTokPlatform(config, dependencies);
      }).not.toThrow();
      
      // Verify the platform was actually created
      expect(platform).toBeDefined();
      expect(platform instanceof TikTokPlatform).toBe(true);
    });
    
    it('should validate platform instance structure', () => {
      // Arrange
      const config = { enabled: true, username: 'test_user' };
      const dependencies = {
        logger: mockLogger,
        TikTokWebSocketClient: jest.fn(),
        WebcastEvent: { CHAT: 'chat', GIFT: 'gift', FOLLOW: 'follow' },
        ControlEvent: { CONNECTED: 'connected' },
        WebcastPushConnection: jest.fn(),
        constants: { GRACE_PERIODS: { TIKTOK: 5000 } }
      };
      
      // Act
      const platform = new TikTokPlatform(config, dependencies);
      
      // Assert - Check if it's a valid object instance
      expect(platform).toBeDefined();
      expect(typeof platform).toBe('object');
      expect(platform.constructor.name).toBe('TikTokPlatform');
    });

    it('should validate available method enumeration', () => {
      // Arrange
      const config = { enabled: true, username: 'test_user' };
      const dependencies = {
        logger: mockLogger,
        TikTokWebSocketClient: jest.fn(),
        WebcastEvent: { CHAT: 'chat' },
        ControlEvent: { CONNECTED: 'connected' },
        WebcastPushConnection: jest.fn(),
        constants: { GRACE_PERIODS: { TIKTOK: 5000 } }
      };
      
      // Act
      const platform = new TikTokPlatform(config, dependencies);
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(platform))
        .filter(name => typeof platform[name] === 'function' && name !== 'constructor');
      
      // Assert - Should have some methods defined
      expect(methods).toBeDefined();
      expect(Array.isArray(methods)).toBe(true);
      expect(methods.length).toBeGreaterThan(0);
      
      // Log available methods for debugging
      console.log('Available TikTok Platform methods:', methods);
    });

    it('should validate test environment setup', () => {
      // Arrange
      const config = { enabled: true, username: 'test_user' };
      const dependencies = {
        logger: mockLogger,
        TikTokWebSocketClient: jest.fn(),
        WebcastEvent: { CHAT: 'chat' },
        ControlEvent: { CONNECTED: 'connected' },
        WebcastPushConnection: jest.fn(),
        constants: { GRACE_PERIODS: { TIKTOK: 5000 } }
      };
      
      // Act
      const platform = new TikTokPlatform(config, dependencies);
      
      // Assert - Test environment should be working
      expect(mockLogger).toBeDefined();
      expect(mockTikTokServices).toBeDefined();
      expect(platform).toBeDefined();
    });

    it('should validate TikTok Platform prototype structure', () => {
      // Arrange & Act
      const prototype = TikTokPlatform.prototype;
      const prototypeMethodNames = Object.getOwnPropertyNames(prototype);
      
      // Assert
      expect(prototype).toBeDefined();
      expect(prototypeMethodNames).toBeDefined();
      expect(Array.isArray(prototypeMethodNames)).toBe(true);
      
      // Log prototype methods for debugging
      console.log('TikTok Platform prototype methods:', prototypeMethodNames);
    });

    it('should validate test environment configuration', () => {
      // Arrange
      const config = { enabled: true, username: 'test_user' };
      const dependencies = {
        logger: mockLogger,
        TikTokWebSocketClient: jest.fn(),
        WebcastEvent: { CHAT: 'chat' },
        ControlEvent: { CONNECTED: 'connected' },
        WebcastPushConnection: jest.fn(),
        constants: { GRACE_PERIODS: { TIKTOK: 5000 } }
      };
      
      // Act
      const platform = new TikTokPlatform(config, dependencies);
      
      // Assert - Basic platform validation in test environment
      expect(platform).toBeTruthy();
      expect(config.enabled).toBe(true);
      expect(dependencies.logger).toBe(mockLogger);
    });
  });
});
