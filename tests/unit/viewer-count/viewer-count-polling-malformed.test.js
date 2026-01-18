const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');

describe('ViewerCountSystem polling with malformed payloads', () => {
    let ViewerCountSystem;

    beforeEach(() => {
        ({ ViewerCountSystem } = require('../../../src/utils/viewer-count'));
    });

    afterEach(() => {
        restoreAllMocks();
    });

    function createSystemWithPlatformReturning(value) {
        const platform = {
            getViewerCount: createMockFn().mockResolvedValue(value)
        };

        const system = new ViewerCountSystem({
            platforms: { youtube: platform },
            logger: noOpLogger,
            runtimeConstants: createRuntimeConstantsFixture()
        });

        system.streamStatus.youtube = true;

        return { system };
    }

    test('preserves previous count when platform returns non-numeric value', async () => {
        const { system } = createSystemWithPlatformReturning('not-a-number');
        const observerUpdates = [];
        const observer = {
            getObserverId: () => 'testObserver1',
            onViewerCountUpdate: (payload) => observerUpdates.push(payload)
        };
        system.addObserver(observer);

        await system.pollPlatform('youtube');

        expect(system.counts.youtube).toBe(0);
        expect(observerUpdates).toHaveLength(0);
    });

    test('skips update when platform returns object payload without numeric count', async () => {
        const { system } = createSystemWithPlatformReturning({ count: 'unknown' });
        const observerUpdates = [];
        const observer = {
            getObserverId: () => 'testObserver2',
            onViewerCountUpdate: (payload) => observerUpdates.push(payload)
        };
        system.addObserver(observer);

        await system.pollPlatform('youtube');

        expect(system.counts.youtube).toBe(0);
        expect(observerUpdates).toHaveLength(0);
    });
});
