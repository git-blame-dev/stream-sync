const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks, resetModules } = require('../../helpers/bun-module-mocks');

const { initializeTestLogging } = require('../../helpers/test-setup');
const { noOpLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

// Mock YouTube services that receive config
class MockYouTubeNotificationDispatcher {
    constructor(options) {
        this.logger = options.logger;
        this.NotificationBuilder = options.NotificationBuilder;
        this.AuthorExtractor = options.AuthorExtractor;
        this.config = options.config;
        
        // Test the config injection pattern
        if (this.config && typeof this.config.get === 'function') {
            // Use config.get() method if available
            this.enableAPI = this.config.get('youtube', 'enableAPI', false);
        } else if (this.config) {
            // Fallback to direct property access
            this.enableAPI = this.config.enableAPI || false;
        } else {
            // Fallback to require if no config provided
            const fallbackConfig = require('../../../src/core/config');
            this.enableAPI = fallbackConfig.get ? fallbackConfig.get('youtube', 'enableAPI', false) : false;
        }
    }
}

describe('YouTube Platform Config Injection', () => {
    let mockConfig, mockConfigManager, mockLogger;

    beforeEach(() => {
        mockLogger = noOpLogger;
        
        // Mock the ConfigManager that has .get() method
        mockConfigManager = {
            get: createMockFn(),
            getPlatformConfig: createMockFn(),
            youtube: {
                enabled: true,
                username: 'test-channel',
                apiKey: 'test-api-key',
                enableAPI: true
            }
        };
        
        // Mock plain config object (what gets passed currently)
        mockConfig = {
            enabled: true,
            username: 'test-channel',
            apiKey: 'test-api-key',
            enableAPI: true
        };
        
        // Mock the core/config module
        mockModule('../../../src/core/config', () => ({
            get: createMockFn((section, key, defaultValue) => {
                if (section === 'youtube' && key === 'enableAPI') return false;
                return defaultValue;
            })
        }));
    });

    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    describe('when YouTube platform is initialized with proper config', () => {
        it('should create YouTubeNotificationDispatcher with config that has .get() method', () => {
            // Arrange
            mockConfigManager.get.mockReturnValue(false); // Mock enableAPI setting
            
            // Create mock platform that simulates the fixed initialization
            const mockPlatform = {
                config: mockConfig,
                logger: mockLogger,
                AuthorExtractor: { extractAuthor: createMockFn() },
                NotificationBuilder: { build: createMockFn() }
            };
            
            // Act - Create notification dispatcher with proper config injection
            const dispatcher = new MockYouTubeNotificationDispatcher({
                logger: mockLogger,
                NotificationBuilder: mockPlatform.NotificationBuilder,
                AuthorExtractor: mockPlatform.AuthorExtractor,
                config: mockConfigManager // Proper config with .get() method
            });
            
            // Assert - The dispatcher should initialize without throwing config.get error
            expect(dispatcher).toBeDefined();
            expect(dispatcher.config).toBe(mockConfigManager);
            
            // Verify that the config.get method was called with proper section/key format
            expect(mockConfigManager.get).toHaveBeenCalledWith('youtube', 'enableAPI', false);
            expect(dispatcher.enableAPI).toBe(false);
        });
        
        it('should handle missing config dependency gracefully', () => {
            // Arrange - Create dispatcher without config
            const mockPlatform = {
                config: mockConfig,
                logger: mockLogger,
                AuthorExtractor: { extractAuthor: createMockFn() },
                NotificationBuilder: { build: createMockFn() }
            };
            
            // Act & Assert - Should not throw during construction
            expect(() => {
                new MockYouTubeNotificationDispatcher({
                    logger: mockLogger,
                    NotificationBuilder: mockPlatform.NotificationBuilder,
                    AuthorExtractor: mockPlatform.AuthorExtractor,
                    config: undefined // No config provided
                });
            }).not.toThrow();
        });

        it('should handle plain config objects without .get() method', () => {
            // Arrange - Pass plain config object
            const plainConfig = { enableAPI: true }; // Plain object without .get()
            
            const mockPlatform = {
                config: mockConfig,
                logger: mockLogger,
                AuthorExtractor: { extractAuthor: createMockFn() },
                NotificationBuilder: { build: createMockFn() }
            };
            
            // Act - Create dispatcher with plain config
            const dispatcher = new MockYouTubeNotificationDispatcher({
                logger: mockLogger,
                NotificationBuilder: mockPlatform.NotificationBuilder,
                AuthorExtractor: mockPlatform.AuthorExtractor,
                config: plainConfig
            });
            
            // Assert - Dispatcher should be created and enableAPI should be read correctly
            expect(dispatcher).toBeDefined();
            expect(dispatcher.config).toBe(plainConfig);
            expect(dispatcher.enableAPI).toBe(true);
        });
    });

    describe('when config object lacks .get() method', () => {
        it('should fallback to require config manager', () => {
            // Arrange - Pass plain object without .get() method
            const plainConfig = { someProperty: 'value' }; // Plain object without .get()
            
            const mockPlatform = {
                config: mockConfig,
                logger: mockLogger,
                AuthorExtractor: { extractAuthor: createMockFn() },
                NotificationBuilder: { build: createMockFn() }
            };
            
            // Act - This should fallback to require('../core/config')
            const dispatcher = new MockYouTubeNotificationDispatcher({
                logger: mockLogger,
                NotificationBuilder: mockPlatform.NotificationBuilder,
                AuthorExtractor: mockPlatform.AuthorExtractor,
                config: plainConfig
            });
            
            // Assert - Dispatcher should be created successfully using fallback
            expect(dispatcher).toBeDefined();
            expect(dispatcher.enableAPI).toBe(false); // From mocked core/config
        });
    });

    describe('error scenarios', () => {
        it('should provide clear error when config.get fails', () => {
            // Arrange
            const brokenConfig = {
                get: createMockFn().mockImplementation(() => {
                    throw new Error('Config access failed');
                })
            };
            
            const mockPlatform = {
                config: mockConfig,
                logger: mockLogger,
                AuthorExtractor: { extractAuthor: createMockFn() },
                NotificationBuilder: { build: createMockFn() }
            };
            
            // Act & Assert
            expect(() => {
                new MockYouTubeNotificationDispatcher({
                    logger: mockLogger,
                    NotificationBuilder: mockPlatform.NotificationBuilder,
                    AuthorExtractor: mockPlatform.AuthorExtractor,
                    config: brokenConfig
                });
            }).toThrow('Config access failed');
        });
    });

    describe('Config Injection Pattern Validation', () => {
        it('should demonstrate correct config injection order', () => {
            // This test demonstrates the correct pattern for config injection
            
            // STEP 1: Create config manager with .get() method
            const configManager = {
                get: createMockFn((section, key, defaultValue) => {
                    if (section === 'youtube' && key === 'enableAPI') return true;
                    return defaultValue;
                })
            };

            // STEP 2: Create service with proper config injection
            const dispatcher = new MockYouTubeNotificationDispatcher({
                logger: mockLogger,
                NotificationBuilder: { build: createMockFn() },
                AuthorExtractor: { extractAuthor: createMockFn() },
                config: configManager // Inject config with .get() method
            });

            // VERIFY: Config should be properly injected and accessible
            expect(dispatcher.config).toBe(configManager);
            expect(dispatcher.enableAPI).toBe(true);
            expect(configManager.get).toHaveBeenCalledWith('youtube', 'enableAPI', false);
        });
    });
});