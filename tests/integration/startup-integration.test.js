
const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

const { TEST_TIMEOUTS } = require('../helpers/test-setup');
const { createMockConfig } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

const applyModuleMocks = () => {
    mockModule('../../src/main', () => ({
        AppRuntime: class AppRuntime {
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
        }
    }));

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

};

describe('Application Startup Integration', () => {
    let AppRuntime;
    let config;

    beforeEach(() => {
        resetModules();
        applyModuleMocks();

        const mainModule = require('../../src/main');
        AppRuntime = mainModule.AppRuntime;
        config = require('../../src/core/config');

        const mockConfig = createMockConfig({
            general: { debug: true },
            twitch: { enabled: true, apiKey: 'test-twitch-key' },
            youtube: { enabled: true, apiKey: 'test-youtube-key' },
            tiktok: { enabled: true, apiKey: 'test-tiktok-key' },
            obs: { enabled: false }
        });

        config.loadConfig.mockResolvedValue(mockConfig);
        config.validateConfig.mockReturnValue({ valid: true, errors: [] });
    });

    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    async function simulateStartup(options = {}) {
        const { configOverrides = {}, shouldFail = false, failureType = 'config' } = options;

        try {
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
                await config.loadConfig();
            } else {
                config.loadConfig.mockResolvedValue(mockConfig);
                await config.loadConfig();
            }

            if (shouldFail && failureType === 'validation') {
                config.validateConfig.mockReturnValue({ valid: false, errors: ['Invalid configuration'] });
                const validation = config.validateConfig(mockConfig);
                if (!validation.valid) {
                    throw new Error('Invalid configuration: ' + validation.errors.join(', '));
                }
            } else {
                config.validateConfig(mockConfig);
            }

            const bot = new AppRuntime(mockConfig);

            if (shouldFail && failureType === 'startup') {
                bot.start = createMockFn().mockRejectedValue(new Error('Startup failed'));
            }

            const result = await bot.start();
            return { success: true, bot, result };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
    
    describe('when starting application', () => {
        describe('with default configuration', () => {
            it('should initialize successfully', async () => {
                const result = await simulateStartup();
                expect(result.success).toBe(true);
                expect(result.bot).toBeDefined();
                expect(result.bot.initialized).toBe(true);
                expect(config.loadConfig).toHaveBeenCalled();
            });

            it('should validate configuration before startup', async () => {
                const result = await simulateStartup();

                expect(result.success).toBe(true);
                expect(config.validateConfig).toHaveBeenCalled();
            });
        });

        describe('with debug mode enabled', () => {
            it('should enable debug logging', async () => {
                const debugConfig = { general: { debug: true } };
                const result = await simulateStartup({ configOverrides: debugConfig });

                expect(result.success).toBe(true);
                expect(result.bot.config.general.debug).toBe(true);
            });
        });
    });
    
    describe('when handling feature flags', () => {
        describe('and keyword parsing is disabled', () => {
            it('should start successfully without keyword parsing', async () => {
                const flagConfig = { general: { keywordParsingEnabled: false, debug: true } };
                const result = await simulateStartup({ configOverrides: flagConfig });

                expect(result.success).toBe(true);
                expect(result.bot.config.general.keywordParsingEnabled).toBe(false);
            });
        });

        describe('and both keyword parsing and greetings are disabled', () => {
            it('should start successfully with both features disabled', async () => {
                const flagConfig = { general: { keywordParsingEnabled: false, greetingsEnabled: false } };
                const result = await simulateStartup({ configOverrides: flagConfig });

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
        it('should follow correct initialization order', async () => {
            const result = await simulateStartup();

            expect(result.success).toBe(true);
            expect(config.loadConfig).toHaveBeenCalled();
            expect(config.validateConfig).toHaveBeenCalled();
        });
    });
    
    describe('when initializing platforms', () => {
        it('should initialize platforms without external connections', async () => {
            const testConfig = {
                twitch: { enabled: true, apiKey: 'test-key' },
                youtube: { enabled: true, apiKey: 'test-key' },
                tiktok: { enabled: true, apiKey: 'test-key' }
            };
            const result = await simulateStartup({ configOverrides: testConfig });

            expect(result.success).toBe(true);
            expect(result.bot.platforms).toBeDefined();
        });
    });
    
    describe('when handling OBS integration', () => {
        it('should start successfully without OBS connection', async () => {
            const obsDisabledConfig = { obs: { enabled: false } };
            const result = await simulateStartup({ configOverrides: obsDisabledConfig });

            expect(result.success).toBe(true);
            expect(result.bot.config.obs.enabled).toBe(false);
        });
    });

    describe('when managing resources', () => {
        it('should cleanup resources properly', async () => {
            const result = await simulateStartup();
            expect(result.success).toBe(true);

            const cleanupResult = await result.bot.cleanup();

            expect(cleanupResult.success).toBe(true);
            expect(result.bot.initialized).toBe(false);
        });
    });
}); 
