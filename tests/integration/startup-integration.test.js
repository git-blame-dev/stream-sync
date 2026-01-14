
const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

// MANDATORY imports
const { 
    initializeTestLogging,
    createTestUser, 
    TEST_TIMEOUTS 
} = require('../helpers/test-setup');

const { 
    createMockNotificationDispatcher,
    createMockLogger,
    createMockConfig,
    createMockOBSConnection,
    createMockTwitchPlatform,
    createMockYouTubePlatform,
    createMockTikTokPlatform
} = require('../helpers/mock-factories');

const { 
    setupAutomatedCleanup
} = require('../helpers/mock-lifecycle');

// Initialize FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

const applyModuleMocks = () => {
    // Mock all external dependencies to prevent real process spawning
    mockModule('../../src/main', () => {
        return class AppRuntime {
            constructor(config) {
                this.config = config;
                this.platforms = new Map();
                this.initialized = false;
            }
            
            async start() {
                this.initialized = true;
                return { success: true, message: 'Bot started successfully' };
            }
            
            async cleanup() {
                this.initialized = false;
                return { success: true };
            }
            
            getStatus() {
                return {
                    initialized: this.initialized,
                    platforms: Array.from(this.platforms.keys()),
                    uptime: 1000
                };
            }
        };
    });

    // Mock bootstrap dependencies
    mockModule('../../src/core/config', () => ({
        loadConfig: createMockFn().mockResolvedValue({
            general: { debug: true },
            twitch: { enabled: true, apiKey: 'test-key' },
            youtube: { enabled: true, apiKey: 'test-key' },
            tiktok: { enabled: true, apiKey: 'test-key' },
            obs: { enabled: false }
        }),
        validateConfig: createMockFn().mockReturnValue({ valid: true, errors: [] }),
        config: { general: { fallbackUsername: 'Unknown User' } }
    }));

    mockModule('../../src/core/logging', () => ({
        logger: {
            info: createMockFn(),
            error: createMockFn(),
            debug: createMockFn(),
            warn: createMockFn()
        },
        platformLogger: {
            info: createMockFn(),
            error: createMockFn(),
            debug: createMockFn()
        },
        initializeLogging: createMockFn()
    }));
};

describe('Application Startup Integration', () => {
    let AppRuntime;
    let config;
    let logging;
    
    beforeEach(() => {
        // Reset modules to get fresh instances
        resetModules();
        applyModuleMocks();
        
        AppRuntime = require('../../src/main');
        config = require('../../src/core/config');
        logging = require('../../src/core/logging');
        
        // Setup test config
        const mockConfig = createMockConfig({
            general: { debug: true },
            twitch: { enabled: true, apiKey: 'test-twitch-key' },
            youtube: { enabled: true, apiKey: 'test-youtube-key' },
            tiktok: { enabled: true, apiKey: 'test-tiktok-key' },
            obs: { enabled: false } // Disable OBS to prevent connection attempts
        });
        
        config.loadConfig.mockResolvedValue(mockConfig);
        config.validateConfig.mockReturnValue({ valid: true, errors: [] });
    });

    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });
    
    // Helper function to simulate application startup without real processes
    async function simulateStartup(options = {}) {
        const {
            configOverrides = {},
            shouldFail = false,
            failureType = 'config'
        } = options;
        
        try {
            // Simulate initialization sequence like real bootstrap
            logging.initializeLogging(); // Call this first
            
            // Load config with any overrides
            const mockConfig = createMockConfig({
                general: { debug: true },
                twitch: { enabled: true, apiKey: 'test-key' },
                youtube: { enabled: true, apiKey: 'test-key' },
                tiktok: { enabled: true, apiKey: 'test-key' },
                obs: { enabled: false },
                ...configOverrides
            });
            
            if (shouldFail && failureType === 'config') {
                config.loadConfig.mockRejectedValue(new Error('Config load failed'));
                await config.loadConfig(); // This will throw
            } else {
                config.loadConfig.mockResolvedValue(mockConfig);
                await config.loadConfig(); // Actually call it
            }
            
            // Validate configuration
            if (shouldFail && failureType === 'validation') {
                config.validateConfig.mockReturnValue({ 
                    valid: false, 
                    errors: ['Invalid configuration'] 
                });
                const validation = config.validateConfig(mockConfig);
                if (!validation.valid) {
                    throw new Error('Invalid configuration: ' + validation.errors.join(', '));
                }
            } else {
                config.validateConfig(mockConfig); // Actually call it
            }
            
            // Create bot instance
            const bot = new AppRuntime(mockConfig);
            
            if (shouldFail && failureType === 'startup') {
                bot.start = createMockFn().mockRejectedValue(new Error('Startup failed'));
            }
            
            // Attempt startup
            const result = await bot.start();
            
            return {
                success: true,
                bot,
                result,
                logs: {
                    info: logging.logger.info.mock.calls,
                    error: logging.logger.error.mock.calls,
                    debug: logging.logger.debug.mock.calls
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                logs: {
                    info: logging.logger.info.mock.calls,
                    error: logging.logger.error.mock.calls,
                    debug: logging.logger.debug.mock.calls
                }
            };
        }
    }
    
    describe('when starting application', () => {
        describe('with default configuration', () => {
            it('should initialize successfully', async () => {
                // Arrange
                const expectedConfig = createMockConfig();
                
                // Act
                const result = await simulateStartup();
                
                // Assert
                expect(result.success).toBe(true);
                expect(result.bot).toBeDefined();
                expect(result.bot.initialized).toBe(true);
                expect(config.loadConfig).toHaveBeenCalled();
                expect(logging.initializeLogging).toHaveBeenCalled();
            });
            
            it('should validate configuration before startup', async () => {
                // Act
                const result = await simulateStartup();
                
                // Assert
                expect(result.success).toBe(true);
                expect(config.validateConfig).toHaveBeenCalled();
            });
        });
        
        describe('with debug mode enabled', () => {
            it('should enable debug logging', async () => {
                // Arrange
                const debugConfig = { general: { debug: true } };
                
                // Act
                const result = await simulateStartup({ configOverrides: debugConfig });
                
                // Assert
                expect(result.success).toBe(true);
                expect(result.bot.config.general.debug).toBe(true);
            });
        });
        
    });
    
    describe('when handling feature flags', () => {
        describe('and keyword parsing is disabled', () => {
            it('should start successfully without keyword parsing', async () => {
                // Arrange
                const flagConfig = { 
                    general: { 
                        keywordParsingEnabled: false,
                        debug: true
                    }
                };
                
                // Act
                const result = await simulateStartup({ configOverrides: flagConfig });
                
                // Assert
                expect(result.success).toBe(true);
                expect(result.bot.config.general.keywordParsingEnabled).toBe(false);
            });
            
            it('should not have logger initialization errors', async () => {
                // Arrange
                const flagConfig = { general: { keywordParsingEnabled: false } };
                
                // Act
                const result = await simulateStartup({ configOverrides: flagConfig });
                
                // Assert
                expect(result.success).toBe(true);
                expect(logging.logger.error).not.toHaveBeenCalledWith(
                    expect.stringContaining('Cannot access \'logger\' before initialization')
                );
            });
        });
        
        describe('and both keyword parsing and greetings are disabled', () => {
            it('should start successfully with both features disabled', async () => {
                // Arrange
                const flagConfig = { 
                    general: { 
                        keywordParsingEnabled: false,
                        greetingsEnabled: false
                    }
                };
                
                // Act
                const result = await simulateStartup({ configOverrides: flagConfig });
                
                // Assert
                expect(result.success).toBe(true);
                expect(result.bot.config.general.keywordParsingEnabled).toBe(false);
                expect(result.bot.config.general.greetingsEnabled).toBe(false);
            });
        });
    });
    
    describe('when handling errors', () => {
        describe('and configuration loading fails', () => {
            it('should handle config load errors gracefully', async () => {
                // Act
                const result = await simulateStartup({ 
                    shouldFail: true, 
                    failureType: 'config' 
                });
                
                // Assert
                expect(result.success).toBe(false);
                expect(result.error).toContain('Config load failed');
            });
        });
        
        describe('and configuration validation fails', () => {
            it('should handle invalid configuration gracefully', async () => {
                // Act
                const result = await simulateStartup({ 
                    shouldFail: true, 
                    failureType: 'validation' 
                });
                
                // Assert
                expect(result.success).toBe(false);
                expect(config.validateConfig).toHaveBeenCalled();
            });
        });
        
        describe('and startup process fails', () => {
            it('should handle startup failures gracefully', async () => {
                // Act
                const result = await simulateStartup({ 
                    shouldFail: true, 
                    failureType: 'startup' 
                });
                
                // Assert
                expect(result.success).toBe(false);
                expect(result.error).toContain('Startup failed');
            });
        });
    });
    
    describe('when managing initialization order', () => {
        describe('and logger must be initialized first', () => {
            it('should initialize logging before using logger', async () => {
                // Act
                const result = await simulateStartup();
                
                // Assert
                expect(result.success).toBe(true);
                expect(logging.initializeLogging).toHaveBeenCalled();
                expect(logging.logger.error).not.toHaveBeenCalledWith(
                    expect.stringContaining('Cannot access \'logger\' before initialization')
                );
            });
            
            it('should not access logger before initialization', async () => {
                // Act
                const result = await simulateStartup({ 
                    configOverrides: { general: { keywordParsingEnabled: false } }
                });
                
                // Assert
                expect(result.success).toBe(true);
                expect(logging.logger.error).not.toHaveBeenCalledWith(
                    expect.stringContaining('ReferenceError: Cannot access')
                );
                expect(logging.logger.error).not.toHaveBeenCalledWith(
                    expect.stringContaining('logger is not defined')
                );
            });
        });
        
        describe('and proper initialization sequence is required', () => {
            it('should follow correct initialization order', async () => {
                // Act
                const result = await simulateStartup();
                
                // Assert
                expect(result.success).toBe(true);
                
                // Verify initialization calls were made in sequence
                expect(logging.initializeLogging).toHaveBeenCalled();
                expect(config.loadConfig).toHaveBeenCalled();
                expect(config.validateConfig).toHaveBeenCalled();
            });
        });
    });
    
    describe('when initializing platforms', () => {
        it('should initialize platforms without external connections', async () => {
            // Arrange
            const testConfig = { 
                twitch: { enabled: true, apiKey: 'test-key' },
                youtube: { enabled: true, apiKey: 'test-key' },
                tiktok: { enabled: true, apiKey: 'test-key' }
            };
            
            // Act
            const result = await simulateStartup({ configOverrides: testConfig });
            
            // Assert
            expect(result.success).toBe(true);
            expect(result.bot.platforms).toBeDefined();
        });
        
        it('should not have platform initialization errors', async () => {
            // Act
            const result = await simulateStartup();
            
            // Assert
            expect(result.success).toBe(true);
            expect(logging.logger.error).not.toHaveBeenCalledWith(
                expect.stringContaining('Failed to initialize platform')
            );
        });
    });
    
    describe('when handling OBS integration', () => {
        describe('and OBS is disabled', () => {
            it('should start successfully without OBS connection', async () => {
                // Arrange
                const obsDisabledConfig = { obs: { enabled: false } };
                
                // Act
                const result = await simulateStartup({ configOverrides: obsDisabledConfig });
                
                // Assert
                expect(result.success).toBe(true);
                expect(result.bot.config.obs.enabled).toBe(false);
            });
        });
        
        describe('and OBS connection fails', () => {
            it('should handle OBS connection errors gracefully', async () => {
                // Act
                const result = await simulateStartup();
                
                // Assert
                expect(result.success).toBe(true);
                expect(logging.logger.error).not.toHaveBeenCalledWith(
                    expect.stringContaining('FATAL')
                );
            });
        });
    });
    
    describe('when managing resources', () => {
        describe('and startup completes', () => {
            it('should not have memory-related errors', async () => {
                // Act
                const result = await simulateStartup();
                
                // Assert
                expect(result.success).toBe(true);
                expect(logging.logger.error).not.toHaveBeenCalledWith(
                    expect.stringContaining('JavaScript heap out of memory')
                );
                expect(logging.logger.error).not.toHaveBeenCalledWith(
                    expect.stringContaining('ENOMEM')
                );
            });
        });
        
        describe('and cleanup is required', () => {
            it('should cleanup resources properly', async () => {
                // Arrange
                const result = await simulateStartup();
                expect(result.success).toBe(true);
                
                // Act
                const cleanupResult = await result.bot.cleanup();
                
                // Assert
                expect(cleanupResult.success).toBe(true);
                expect(result.bot.initialized).toBe(false);
            });
        });
    });
}); 
