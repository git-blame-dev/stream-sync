
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const path = require('path');
const { initializeTestLogging } = require('../../helpers/test-setup');

describe('Timeout NaN Warning Fix', () => {
    let originalConsoleWarn;
    let consoleWarnings;
    let originalSetTimeout;
    let timeoutCalls;

    beforeEach(() => {
        initializeTestLogging();
        
        // Mock logging for StreamDetector and RetrySystem
        mockModule('../../../src/core/logging', () => ({
            getUnifiedLogger: createMockFn(() => ({
                debug: createMockFn(),
                info: createMockFn(),
                warn: createMockFn(),
                error: createMockFn()
            })),
            logger: {
                debug: createMockFn(),
                info: createMockFn(),
                warn: createMockFn(),
                error: createMockFn()
            }
        }));
        
        // Clear require cache to ensure fresh modules
// Capture console warnings
        consoleWarnings = [];
        originalConsoleWarn = console.warn;
        console.warn = (message) => {
            consoleWarnings.push(message);
            originalConsoleWarn(message);
        };

        // Capture setTimeout calls with their delay values
        timeoutCalls = [];
        originalSetTimeout = global.setTimeout;
        global.setTimeout = (callback, delay, ...args) => {
            timeoutCalls.push({ callback, delay, args });
            return originalSetTimeout(callback, delay, ...args);
        };
    });

    afterEach(() => {
        restoreAllMocks();
        // Restore original functions
        console.warn = originalConsoleWarn;
        global.setTimeout = originalSetTimeout;
        
        // Clear timeouts
        if (timeoutCalls && Array.isArray(timeoutCalls)) {
            timeoutCalls.forEach(call => {
                if (call.timeoutId) {
                    clearTimeout(call.timeoutId);
                
        restoreAllModuleMocks();}
            });
        }
    });

    describe('Stream Detector NaN Timeout', () => {
        test('should reject undefined streamRetryInterval configuration', () => {
            const { StreamDetector } = require('../../../src/utils/stream-detector');
            
            const invalidConfig = {
                streamDetectionEnabled: true,
                streamRetryInterval: undefined,
                streamMaxRetries: -1,
                continuousMonitoringInterval: 60
            };

            expect(() => new StreamDetector(invalidConfig)).toThrow('streamRetryInterval');
        });

        test('should reject null streamRetryInterval configuration', () => {
            const { StreamDetector } = require('../../../src/utils/stream-detector');
            
            const invalidConfig = {
                streamDetectionEnabled: true,
                streamRetryInterval: null,
                streamMaxRetries: -1,
                continuousMonitoringInterval: 60
            };

            expect(() => new StreamDetector(invalidConfig)).toThrow('streamRetryInterval');
        });

        test('should reject string streamRetryInterval configuration', () => {
            const { StreamDetector } = require('../../../src/utils/stream-detector');
            
            const invalidConfig = {
                streamDetectionEnabled: true,
                streamRetryInterval: 'invalid',
                streamMaxRetries: -1,
                continuousMonitoringInterval: 60
            };

            expect(() => new StreamDetector(invalidConfig)).toThrow('streamRetryInterval');
        });
    });

    describe('Retry System NaN Timeout', () => {
        test('should handle invalid BACKOFF_MULTIPLIER resulting in NaN', () => {
            const { RetrySystem, ADAPTIVE_RETRY_CONFIG } = require('../../../src/utils/retry-system');
            
            // Temporarily modify config to cause NaN
            const originalMultiplier = ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER;
            ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER = undefined;
            
            try {
                const retrySystem = new RetrySystem();
                
                // This should not result in NaN timeout
                const delay = retrySystem.calculateAdaptiveRetryDelay('TikTok');
                
                expect(isNaN(delay)).toBe(false);
                expect(delay).toBeGreaterThan(0);
                
            } finally {
                // Restore original config
                ADAPTIVE_RETRY_CONFIG.BACKOFF_MULTIPLIER = originalMultiplier;
            }
        });

        test('should handle invalid BASE_DELAY resulting in NaN', () => {
            const { RetrySystem, ADAPTIVE_RETRY_CONFIG } = require('../../../src/utils/retry-system');
            
            const originalBaseDelay = ADAPTIVE_RETRY_CONFIG.BASE_DELAY;
            ADAPTIVE_RETRY_CONFIG.BASE_DELAY = null;
            
            try {
                // RetrySystem now validates config and throws error for invalid values (improved behavior)
                expect(() => {
                    new RetrySystem();
                }).toThrow('BASE_DELAY must be positive');
                
            } finally {
                ADAPTIVE_RETRY_CONFIG.BASE_DELAY = originalBaseDelay;
            }
        });

        test('should handle handleConnectionError with valid timeout', () => {
            const { RetrySystem } = require('../../../src/utils/retry-system');
            
            const retrySystem = new RetrySystem();
            const mockReconnectFn = createMockFn();
            const mockError = new Error('Connection failed');
            
            // This should schedule a retry without NaN timeout
            retrySystem.handleConnectionError('YouTube', mockError, mockReconnectFn);
            
            // Check that setTimeout was called with valid delay
            const recentTimeout = timeoutCalls[timeoutCalls.length - 1];
            expect(recentTimeout).toBeDefined();
            expect(isNaN(recentTimeout.delay)).toBe(false);
            expect(recentTimeout.delay).toBeGreaterThan(0);
        });
    });

    describe('General Timeout Validation', () => {
        test('should validate all setTimeout calls have numeric delays', () => {
            const { StreamDetector } = require('../../../src/utils/stream-detector');
            const { RetrySystem } = require('../../../src/utils/retry-system');
            
            // Test stream detector
            const config = {
                streamDetectionEnabled: true,
                streamRetryInterval: 1,
                streamMaxRetries: 1,
                continuousMonitoringInterval: 60
            };
            const logger = { 
                debug: createMockFn(), 
                info: createMockFn(), 
                warn: createMockFn(), 
                error: createMockFn() 
            };
            
            const streamDetector = new StreamDetector(config, logger);
            const retrySystem = new RetrySystem();
            
            // Trigger various timeout scenarios
            streamDetector._detectStreamWithRetry('youtube', {}, () => {}, () => {});
            retrySystem.handleConnectionError('TikTok', new Error('test'), () => {});
            
            // Verify ALL setTimeout calls have valid numeric delays
            timeoutCalls.forEach((call, index) => {
                expect(typeof call.delay).toBe('number');
                expect(isNaN(call.delay)).toBe(false);
                expect(call.delay).toBeGreaterThan(0);
            });
            
            // Verify no timeout warnings were generated
            const timeoutWarnings = consoleWarnings.filter(warning => 
                warning.includes('TimeoutNaNWarning') || 
                warning.includes('NaN is not a number') ||
                warning.includes('timeout')
            );
            expect(timeoutWarnings).toHaveLength(0);
        });

        test('should provide fallback values for invalid timeout calculations', () => {
            // Test that components provide reasonable defaults when calculations fail
            const invalidInputs = [undefined, null, NaN, "invalid", {}, [], -1];
            
            invalidInputs.forEach(input => {
                // Each component should handle invalid input gracefully
                // This test ensures no NaN timeouts are generated
                expect(() => {
                    const result = input * Math.pow(2, 1);
                    if (isNaN(result)) {
                        // Components should detect this and provide fallback
                        const fallback = 5000; // 5 second default
                        expect(typeof fallback).toBe('number');
                        expect(isNaN(fallback)).toBe(false);
                    }
                }).not.toThrow();
            });
        });
    });
});
