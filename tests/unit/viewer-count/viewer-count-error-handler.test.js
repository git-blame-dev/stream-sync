const { describe, expect, afterEach, it, beforeEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

describe('ViewerCountSystem observer error handling', () => {
    let ViewerCountSystem;

    beforeEach(() => {
        ({ ViewerCountSystem } = require('../../../src/utils/viewer-count'));
    });

    afterEach(() => {
        restoreAllMocks();
    });

    it('continues polling when observer throws error', async () => {
        const platform = { getViewerCount: createMockFn().mockResolvedValue(100) };
        const system = new ViewerCountSystem({
            logger: noOpLogger,
            platforms: { youtube: platform },
            runtimeConstants: { VIEWER_COUNT_POLLING_INTERVAL_SECONDS: 15 }
        });

        system.streamStatus.youtube = true;

        system.addObserver({
            getObserverId: () => 'testFailingObserver',
            onViewerCountUpdate: () => { throw new Error('observer boom'); }
        });

        await expect(system.pollPlatform('youtube')).resolves.toBeUndefined();

        expect(system.counts.youtube).toBe(100);
    });
});
