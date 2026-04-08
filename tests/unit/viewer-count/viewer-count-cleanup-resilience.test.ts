import { describe, expect, afterEach, it, beforeEach } from 'bun:test';
import { createRequire } from 'node:module';

const load = createRequire(__filename);
const { createMockFn, restoreAllMocks } = load('../../helpers/bun-mock-utils');
const { noOpLogger } = load('../../helpers/mock-factories');

describe('ViewerCountSystem cleanup resilience', () => {
    let ViewerCountSystem;

    beforeEach(() => {
        ({ ViewerCountSystem } = load('../../../src/utils/viewer-count.ts'));
    });

    afterEach(() => {
        restoreAllMocks();
    });

    it('completes cleanup even when observer cleanup throws', async () => {
        const platform = { getViewerCount: createMockFn().mockResolvedValue(100) };
        const system = new ViewerCountSystem({
            logger: noOpLogger,
            platforms: { youtube: platform },
            config: { general: { viewerCountPollingIntervalMs: 15000 } }
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
            logger: noOpLogger,
            platforms: { youtube: platform },
            config: { general: { viewerCountPollingIntervalMs: 15000 } }
        });

        system.addObserver({
            getObserverId: () => 'testRejectingObserver',
            cleanup: () => Promise.reject(new Error('async cleanup fail'))
        });

        await expect(system.cleanup()).resolves.toBeUndefined();
        expect(system.observers.size).toBe(0);
    });
});
