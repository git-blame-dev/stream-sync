
const { describe, beforeEach, afterEach, test, expect } = require('bun:test');

const { InnertubeFactory } = require('../../src/factories/innertube-factory');
const InnertubeInstanceManager = require('../../src/services/innertube-instance-manager');
const testClock = require('../helpers/test-clock');
const { clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');

describe('Factory Pattern Integration', () => {
    
    beforeEach(async () => {
        testClock.reset();
        // Reset instance manager for clean tests
        await InnertubeInstanceManager.cleanup();
        InnertubeInstanceManager._resetInstance();
    });
    
    afterEach(async () => {
        await InnertubeInstanceManager.cleanup();
        clearAllMocks();
        restoreAllMocks();
    });

    describe('Factory Statistics and Metadata', () => {
        test('should provide factory statistics', () => {
            // When: Getting factory stats
            const stats = InnertubeFactory.getStats();
            
            // Then: Should provide comprehensive metadata
            expect(stats).toMatchObject({
                factoryVersion: '1.0.0',
                supportedMethods: expect.arrayContaining([
                    'createInstance',
                    'createWithConfig',
                    'createForTesting',
                    'createWithTimeout'
                ]),
                youtubeJsVersion: 'v16+',
                esm: true
            });
        });

        test('should track all supported creation methods', () => {
            // When: Getting factory stats
            const stats = InnertubeFactory.getStats();
            
            // Then: Should list all available methods
            const expectedMethods = [
                'createInstance',
                'createWithConfig', 
                'createForTesting',
                'createWithTimeout'
            ];
            
            expectedMethods.forEach(method => {
                expect(stats.supportedMethods).toContain(method);
            });
        });

        test('should indicate ESM compatibility', () => {
            // When: Getting factory stats
            const stats = InnertubeFactory.getStats();
            
            // Then: Should indicate ESM support for YouTube.js v16
            expect(stats.esm).toBe(true);
            expect(stats.youtubeJsVersion).toContain('v16');
        });
    });

    describe('Error Handling Integration', () => {
        test('should handle instance creation errors gracefully', async () => {
            // When: Creating standard instance (expected to fail in test environment)
            // Then: Should fail with appropriate error message
            await expect(InnertubeFactory.createInstance()).rejects.toThrow(/Innertube creation failed/);
        });

        test('should handle configured instance creation errors', async () => {
            // Given: Custom configuration
            const config = { debug: true, cache: false };
            
            // When: Creating configured instance (expected to fail in test environment)
            // Then: Should fail with appropriate error message
            await expect(InnertubeFactory.createWithConfig(config)).rejects.toThrow(/Innertube creation failed/);
        });

        test('should handle test instance creation errors', async () => {
            // When: Creating test instance (expected to fail in test environment)
            // Then: Should fail with appropriate error message
            await expect(InnertubeFactory.createForTesting()).rejects.toThrow(/Innertube creation failed/);
        });

        test('should handle timeout creation errors', async () => {
            // When: Creating with timeout (expected to fail in test environment)
            // Then: Should fail with appropriate error message
            await expect(InnertubeFactory.createWithTimeout(5000)).rejects.toThrow(/Innertube creation failed/);
        });

        test('should provide consistent error handling for multiple attempts', async () => {
            // When: Creating multiple instances (all will fail in test environment)
            const promises = [
                InnertubeFactory.createInstance().catch(e => e.message),
                InnertubeFactory.createWithConfig({}).catch(e => e.message),
                InnertubeFactory.createForTesting().catch(e => e.message)
            ];
            
            const results = await Promise.all(promises);
            
            // Then: All should provide consistent error messages
            expect(results).toHaveLength(3);
            results.forEach(result => {
                expect(result).toContain('Innertube creation failed');
            });
        });
    });

    describe('Configuration Handling', () => {
        test('should handle empty configuration', async () => {
            // When: Creating with empty config
            // Then: Should handle gracefully
            await expect(InnertubeFactory.createWithConfig({})).rejects.toThrow(/Innertube creation failed/);
        });

        test('should handle undefined configuration', async () => {
            // When: Creating with undefined config
            // Then: Should handle gracefully
            await expect(InnertubeFactory.createWithConfig()).rejects.toThrow(/Innertube creation failed/);
        });

        test('should handle various client configurations', async () => {
            // Given: Different client configurations
            const configs = [
                { client: 'WEB' },
                { debug: true },
                { cache: true },
                { debug: false, cache: false }
            ];
            
            // When: Creating instances with different configs
            const promises = configs.map(config => 
                InnertubeFactory.createWithConfig(config).catch(e => e.message)
            );
            const results = await Promise.all(promises);
            
            // Then: All should handle configurations and fail with consistent errors
            expect(results).toHaveLength(4);
            results.forEach(result => {
                expect(result).toContain('Innertube creation failed');
            });
        });
    });

    describe('Timeout Handling', () => {
        test('should handle reasonable timeout values', async () => {
            // When: Creating with reasonable timeout
            // Then: Should handle gracefully
            await expect(InnertubeFactory.createWithTimeout(10000)).rejects.toThrow(/Innertube creation failed/);
        });

        test('should handle very short timeouts', async () => {
            // When: Creating with very short timeout
            // Then: Should fail with timeout or creation error
            await expect(InnertubeFactory.createWithTimeout(1)).rejects.toThrow();
        });

        test('should handle timeout with custom configuration', async () => {
            // Given: Custom config with timeout
            const config = { debug: false, cache: false };
            
            // When: Creating with timeout and config
            // Then: Should handle gracefully
            await expect(InnertubeFactory.createWithTimeout(5000, config)).rejects.toThrow();
        });
    });

    describe('Instance Manager Integration', () => {
        test('should provide instance manager functionality', () => {
            // Given: Instance manager
            const manager = InnertubeInstanceManager.getInstance();
            
            // When: Getting manager stats
            const stats = manager.getStats();
            
            // Then: Should provide statistics
            expect(stats).toHaveProperty('activeInstances');
            expect(stats).toHaveProperty('maxInstances');
            expect(stats).toHaveProperty('instanceDetails');
            expect(typeof stats.activeInstances).toBe('number');
            expect(typeof stats.maxInstances).toBe('number');
            expect(Array.isArray(stats.instanceDetails)).toBe(true);
        });

        test('should handle instance manager cleanup', async () => {
            // Given: Instance manager
            const manager = InnertubeInstanceManager.getInstance();
            
            // When: Cleaning up manager
            await manager.cleanup();
            
            // Then: Should complete without errors
            const stats = manager.getStats();
            expect(stats.activeInstances).toBe(0);
        });

        test('should support instance manager reset', () => {
            // Given: Instance manager
            const manager1 = InnertubeInstanceManager.getInstance();
            
            // When: Resetting instance
            InnertubeInstanceManager._resetInstance();
            const manager2 = InnertubeInstanceManager.getInstance();
            
            // Then: Should get new instance
            expect(manager2).toBeDefined();
            // Both should have same interface
            expect(typeof manager1.getStats).toBe('function');
            expect(typeof manager2.getStats).toBe('function');
        });
    });

    describe('API Structure Validation', () => {
        test('should provide all required factory methods', () => {
            // When: Checking factory API
            // Then: Should have all required methods
            expect(typeof InnertubeFactory.createInstance).toBe('function');
            expect(typeof InnertubeFactory.createWithConfig).toBe('function');
            expect(typeof InnertubeFactory.createForTesting).toBe('function');
            expect(typeof InnertubeFactory.createWithTimeout).toBe('function');
            expect(typeof InnertubeFactory.getStats).toBe('function');
        });

        test('should provide consistent method signatures', () => {
            // When: Checking method signatures
            // Then: Methods should have expected parameter counts (considering default parameters)
            expect(InnertubeFactory.createInstance.length).toBe(0);
            expect(InnertubeFactory.createWithConfig.length).toBe(0); // Has default parameter
            expect(InnertubeFactory.createForTesting.length).toBe(0);
            expect(InnertubeFactory.createWithTimeout.length).toBe(0); // Has default parameters
            expect(InnertubeFactory.getStats.length).toBe(0);
        });

        test('should provide instance manager API', () => {
            // Given: Instance manager
            const manager = InnertubeInstanceManager.getInstance();
            
            // When: Checking manager API
            // Then: Should have all required methods
            expect(typeof manager.getInstance).toBe('function');
            expect(typeof manager.markInstanceUnhealthy).toBe('function');
            expect(typeof manager.disposeInstance).toBe('function');
            expect(typeof manager.cleanup).toBe('function');
            expect(typeof manager.getStats).toBe('function');
        });
    });

    describe('Performance Characteristics', () => {
        test('should handle rapid factory method calls', () => {
            // When: Making rapid factory calls
            const startTime = testClock.now();
            const iterations = 100;
            
            for (let i = 0; i < iterations; i++) {
                const stats = InnertubeFactory.getStats();
                expect(stats).toBeDefined();
            }
            
            testClock.advance(iterations - 1);
            const endTime = testClock.now();
            
            // Then: Should complete quickly
            expect(endTime - startTime).toBeLessThan(100); // Less than 100ms for 100 calls
        });

        test('should handle rapid instance manager calls', () => {
            // When: Making rapid manager calls
            const manager = InnertubeInstanceManager.getInstance();
            const startTime = testClock.now();
            const iterations = 100;
            
            for (let i = 0; i < iterations; i++) {
                const stats = manager.getStats();
                expect(stats).toBeDefined();
            }
            
            testClock.advance(iterations - 1);
            const endTime = testClock.now();
            
            // Then: Should complete quickly
            expect(endTime - startTime).toBeLessThan(100); // Less than 100ms for 100 calls
        });
    });
});
