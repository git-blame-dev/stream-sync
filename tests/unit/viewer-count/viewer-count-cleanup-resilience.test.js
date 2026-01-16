const { describe, expect, afterEach, it, beforeEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

describe('ViewerCountSystem cleanup resilience', () => {
    let ViewerCountSystem;
    let mockLogger;

    beforeEach(() => {
        mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
        ({ ViewerCountSystem } = require('../../../src/utils/viewer-count'));
    });

    afterEach(() => {
        restoreAllMocks();
    });

    it('completes cleanup even when observer cleanup throws', async () => {
        const platform = { getViewerCount: createMockFn().mockResolvedValue(100) };
        const system = new ViewerCountSystem({
            logger: mockLogger,
            platforms: { youtube: platform },
            runtimeConstants: { VIEWER_COUNT_POLLING_INTERVAL_SECONDS: 15 }
        });

        system.addObserver({
            getObserverId: () => 'testFailingObserver',
            cleanup: () => { throw new Error('cleanup fail'); }
        });

        await expect(system.cleanup()).resolves.toBeUndefined();
        expect(system.observers.size).toBe(0);
    });

    it('completes cleanup even when observer cleanup rejects', async () => {
        const platform = { getViewerCount: createMockFn().mockResolvedValue(100) };
        const system = new ViewerCountSystem({
            logger: mockLogger,
            platforms: { youtube: platform },
            runtimeConstants: { VIEWER_COUNT_POLLING_INTERVAL_SECONDS: 15 }
        });

        system.addObserver({
            getObserverId: () => 'testRejectingObserver',
            cleanup: () => Promise.reject(new Error('async cleanup fail'))
        });

        await expect(system.cleanup()).resolves.toBeUndefined();
        expect(system.observers.size).toBe(0);
    });
});
