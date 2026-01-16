const { describe, test, expect, beforeEach, afterEach } = require('bun:test');

const { InnertubeFactory } = require('../../../src/factories/innertube-factory');

describe('InnertubeFactory behavior', () => {
    const restoreCache = () => {
        InnertubeFactory._innertubeClassCache = null;
        InnertubeFactory._importPromise = null;
        InnertubeFactory._importer = null;
    };

    beforeEach(() => {
        restoreCache();
    });

    afterEach(() => {
        restoreCache();
    });

    test('createInstance returns Innertube instance via configured importer', async () => {
        const mockInstance = { id: 'test-innertube-instance' };
        const mockInnertube = { create: async () => mockInstance };
        const mockImporter = async () => ({ Innertube: mockInnertube });

        InnertubeFactory.configure({ importer: mockImporter });

        const result = await InnertubeFactory.createInstance();

        expect(result).toEqual(mockInstance);
    });

    test('createInstance wraps errors with contextual message', async () => {
        const mockImporter = async () => ({
            Innertube: { create: async () => { throw new Error('network failure'); } }
        });

        InnertubeFactory.configure({ importer: mockImporter });

        await expect(InnertubeFactory.createInstance()).rejects.toThrow('Innertube creation failed: network failure');
    });

    test('createWithConfig passes configuration to Innertube.create', async () => {
        let receivedConfig = null;
        const mockInstance = { id: 'configured-instance' };
        const mockInnertube = {
            create: async (config) => {
                receivedConfig = config;
                return mockInstance;
            }
        };
        const mockImporter = async () => ({ Innertube: mockInnertube });

        InnertubeFactory.configure({ importer: mockImporter });

        const result = await InnertubeFactory.createWithConfig({ debug: true, cache: false });

        expect(result).toEqual(mockInstance);
        expect(receivedConfig).toEqual({ debug: true, cache: false });
    });

    test('caches Innertube class after first import', async () => {
        let importCount = 0;
        const mockInnertube = { create: async () => ({ id: 'instance' }) };
        const mockImporter = async () => {
            importCount++;
            return { Innertube: mockInnertube };
        };

        InnertubeFactory.configure({ importer: mockImporter });

        await InnertubeFactory.createInstance();
        await InnertubeFactory.createInstance();
        await InnertubeFactory.createInstance();

        expect(importCount).toBe(1);
    });

    test('getStats reflects cache state', async () => {
        const mockInnertube = { create: async () => ({ id: 'instance' }) };
        const mockImporter = async () => ({ Innertube: mockInnertube });

        InnertubeFactory.configure({ importer: mockImporter });

        const statsBefore = InnertubeFactory.getStats();
        expect(statsBefore.cached).toBe(false);

        await InnertubeFactory.createInstance();

        const statsAfter = InnertubeFactory.getStats();
        expect(statsAfter.cached).toBe(true);
        expect(statsAfter.supportedMethods).toContain('createWithTimeout');
    });

    test('createLazyReference returns function that resolves to cached class', async () => {
        const mockInnertube = { create: async () => ({ id: 'instance' }) };
        const mockImporter = async () => ({ Innertube: mockInnertube });

        InnertubeFactory.configure({ importer: mockImporter });
        await InnertubeFactory.createInstance();

        const lazyRef = InnertubeFactory.createLazyReference();
        const resolved = await lazyRef();

        expect(resolved).toBe(mockInnertube);
    });

    test('configure rejects non-function importer', () => {
        expect(() => InnertubeFactory.configure({ importer: 'not-a-function' }))
            .toThrow('InnertubeFactory importer must be a function');
    });
});
