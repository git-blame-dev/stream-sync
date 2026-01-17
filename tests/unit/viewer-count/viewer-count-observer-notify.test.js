const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');

describe('ViewerCountSystem stream status observer notifications', () => {
    let ViewerCountSystem;

    beforeEach(() => {
        ({ ViewerCountSystem } = require('../../../src/utils/viewer-count'));
    });

    afterEach(() => {
        restoreAllMocks();
    });

    function createSystem() {
        return new ViewerCountSystem({
            platforms: { youtube: {} },
            logger: noOpLogger,
            runtimeConstants: createRuntimeConstantsFixture()
        });
    }

    test('notifies observers on stream status change for known platform', async () => {
        const system = createSystem();
        const statusEvents = [];
        const observer = {
            getObserverId: () => 'testObserver1',
            onStreamStatusChange: createMockFn((payload) => statusEvents.push(payload))
        };

        system.addObserver(observer);

        await system.updateStreamStatus('youtube', true);

        expect(observer.onStreamStatusChange).toHaveBeenCalledTimes(1);
        expect(statusEvents[0]).toEqual(
            expect.objectContaining({ platform: 'youtube', isLive: true, wasLive: false })
        );
    });

    test('skips observer notification for unknown platform', async () => {
        const system = createSystem();
        const observer = {
            getObserverId: () => 'testObserver2',
            onStreamStatusChange: createMockFn()
        };

        system.addObserver(observer);

        await system.updateStreamStatus('unknownPlatform', true);

        expect(observer.onStreamStatusChange).not.toHaveBeenCalled();
    });

    test('resets counts and notifies observers when stream goes offline', async () => {
        const system = createSystem();
        const statusEvents = [];
        const countEvents = [];
        const observer = {
            getObserverId: () => 'testObserver3',
            onStreamStatusChange: createMockFn((payload) => statusEvents.push(payload)),
            onViewerCountUpdate: createMockFn((payload) => countEvents.push(payload))
        };

        system.addObserver(observer);

        await system.updateStreamStatus('youtube', true);
        await system.updateStreamStatus('youtube', false);

        expect(statusEvents).toEqual([
            expect.objectContaining({ platform: 'youtube', isLive: true, wasLive: false }),
            expect.objectContaining({ platform: 'youtube', isLive: false, wasLive: true })
        ]);

        expect(countEvents.some((evt) => evt.platform === 'youtube' && evt.count === 0)).toBe(true);
        expect(system.counts.youtube).toBe(0);
    });

    test('ignores updates for unknown platform without mutating counts', async () => {
        const system = createSystem();
        const observer = {
            getObserverId: () => 'testObserver4',
            onStreamStatusChange: createMockFn(),
            onViewerCountUpdate: createMockFn()
        };

        system.addObserver(observer);

        await system.updateStreamStatus('unknownPlatform', false);

        expect(observer.onStreamStatusChange).not.toHaveBeenCalled();
        expect(observer.onViewerCountUpdate).not.toHaveBeenCalled();
        expect(system.counts).toEqual(
            expect.objectContaining({ youtube: 0, twitch: 0, tiktok: 0 })
        );
    });
});
