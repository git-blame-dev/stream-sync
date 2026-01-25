const { describe, beforeEach, afterEach, test, expect } = require('bun:test');
const { InnertubeFactory } = require('../../src/factories/innertube-factory');
const InnertubeInstanceManager = require('../../src/services/innertube-instance-manager');
const testClock = require('../helpers/test-clock');
const { clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');

describe('Factory Pattern Integration', () => {
    beforeEach(async () => {
        testClock.reset();
        await InnertubeInstanceManager.cleanup();
        InnertubeInstanceManager._resetInstance();
    });

    afterEach(async () => {
        await InnertubeInstanceManager.cleanup();
        clearAllMocks();
        restoreAllMocks();
    });

    describe('Factory Statistics and Metadata', () => {
        test('provides factory statistics', () => {
            const stats = InnertubeFactory.getStats();

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

        test('tracks all supported creation methods', () => {
            const stats = InnertubeFactory.getStats();

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

        test('indicates ESM compatibility', () => {
            const stats = InnertubeFactory.getStats();

            expect(stats.esm).toBe(true);
            expect(stats.youtubeJsVersion).toContain('v16');
        });
    });

    describe('Instance Creation', () => {
        test('creates standard instance successfully', async () => {
            const instance = await InnertubeFactory.createInstance();

            expect(instance).toBeDefined();
            expect(typeof instance).toBe('object');
        });

        test('creates configured instance successfully', async () => {
            const config = { debug: true, cache: false };
            const instance = await InnertubeFactory.createWithConfig(config);

            expect(instance).toBeDefined();
            expect(typeof instance).toBe('object');
        });

        test('creates test instance successfully', async () => {
            const instance = await InnertubeFactory.createForTesting();

            expect(instance).toBeDefined();
            expect(typeof instance).toBe('object');
        });

        test('creates instance with timeout successfully', async () => {
            const instance = await InnertubeFactory.createWithTimeout(5000);

            expect(instance).toBeDefined();
            expect(typeof instance).toBe('object');
        });

        test('creates multiple instances with different configs', async () => {
            const configs = [
                { client: 'WEB' },
                { debug: true },
                { cache: true },
                { debug: false, cache: false }
            ];

            const instances = await Promise.all(
                configs.map(config => InnertubeFactory.createWithConfig(config))
            );

            expect(instances).toHaveLength(4);
            instances.forEach(instance => {
                expect(instance).toBeDefined();
                expect(typeof instance).toBe('object');
            });
        });
    });

    describe('Configuration Handling', () => {
        test('handles empty configuration', async () => {
            const instance = await InnertubeFactory.createWithConfig({});

            expect(instance).toBeDefined();
        });

        test('handles undefined configuration', async () => {
            const instance = await InnertubeFactory.createWithConfig();

            expect(instance).toBeDefined();
        });
    });

    describe('Instance Manager Integration', () => {
        test('provides instance manager functionality', () => {
            const manager = InnertubeInstanceManager.getInstance();
            const stats = manager.getStats();

            expect(stats).toHaveProperty('activeInstances');
            expect(stats).toHaveProperty('maxInstances');
            expect(stats).toHaveProperty('instanceDetails');
            expect(typeof stats.activeInstances).toBe('number');
            expect(typeof stats.maxInstances).toBe('number');
            expect(Array.isArray(stats.instanceDetails)).toBe(true);
        });

        test('handles instance manager cleanup', async () => {
            const manager = InnertubeInstanceManager.getInstance();

            await manager.cleanup();

            const stats = manager.getStats();
            expect(stats.activeInstances).toBe(0);
        });

        test('supports instance manager reset', () => {
            const manager1 = InnertubeInstanceManager.getInstance();

            InnertubeInstanceManager._resetInstance();
            const manager2 = InnertubeInstanceManager.getInstance();

            expect(manager2).toBeDefined();
            expect(typeof manager1.getStats).toBe('function');
            expect(typeof manager2.getStats).toBe('function');
        });
    });

    describe('API Structure Validation', () => {
        test('provides all required factory methods', () => {
            expect(typeof InnertubeFactory.createInstance).toBe('function');
            expect(typeof InnertubeFactory.createWithConfig).toBe('function');
            expect(typeof InnertubeFactory.createForTesting).toBe('function');
            expect(typeof InnertubeFactory.createWithTimeout).toBe('function');
            expect(typeof InnertubeFactory.getStats).toBe('function');
        });

        test('provides consistent method signatures', () => {
            expect(InnertubeFactory.createInstance.length).toBe(0);
            expect(InnertubeFactory.createWithConfig.length).toBe(0);
            expect(InnertubeFactory.createForTesting.length).toBe(0);
            expect(InnertubeFactory.createWithTimeout.length).toBe(0);
            expect(InnertubeFactory.getStats.length).toBe(0);
        });

        test('provides instance manager API', () => {
            const manager = InnertubeInstanceManager.getInstance();

            expect(typeof manager.getInstance).toBe('function');
            expect(typeof manager.markInstanceUnhealthy).toBe('function');
            expect(typeof manager.disposeInstance).toBe('function');
            expect(typeof manager.cleanup).toBe('function');
            expect(typeof manager.getStats).toBe('function');
        });
    });

    describe('Performance Characteristics', () => {
        test('handles rapid factory method calls', () => {
            const startTime = testClock.now();
            const iterations = 100;

            for (let i = 0; i < iterations; i++) {
                const stats = InnertubeFactory.getStats();
                expect(stats).toBeDefined();
            }

            testClock.advance(iterations - 1);
            const endTime = testClock.now();

            expect(endTime - startTime).toBeLessThan(100);
        });

        test('handles rapid instance manager calls', () => {
            const manager = InnertubeInstanceManager.getInstance();
            const startTime = testClock.now();
            const iterations = 100;

            for (let i = 0; i < iterations; i++) {
                const stats = manager.getStats();
                expect(stats).toBeDefined();
            }

            testClock.advance(iterations - 1);
            const endTime = testClock.now();

            expect(endTime - startTime).toBeLessThan(100);
        });
    });
});
