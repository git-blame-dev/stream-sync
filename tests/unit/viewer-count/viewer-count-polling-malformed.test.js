const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');

const noOpLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

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

        return { system, platform };
    }

    test('warns and preserves previous count when platform returns non-numeric value', async () => {
        const { system } = createSystemWithPlatformReturning('not-a-number');
        const warnSpy = spyOn(system.logger, 'warn');

        const observer = { getObserverId: () => 'testObserver1', onViewerCountUpdate: createMockFn() };
        system.addObserver(observer);

        await system.pollPlatform('youtube');

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid viewer count'), expect.anything());
        expect(system.counts.youtube).toBe(0);
        expect(observer.onViewerCountUpdate).not.toHaveBeenCalled();
    });

    test('warns and skips update when platform returns object payload without numeric count', async () => {
        const { system } = createSystemWithPlatformReturning({ count: 'unknown' });
        const warnSpy = spyOn(system.logger, 'warn');

        const observer = { getObserverId: () => 'testObserver2', onViewerCountUpdate: createMockFn() };
        system.addObserver(observer);

        await system.pollPlatform('youtube');

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid viewer count'), expect.anything());
        expect(system.counts.youtube).toBe(0);
        expect(observer.onViewerCountUpdate).not.toHaveBeenCalled();
    });
});
