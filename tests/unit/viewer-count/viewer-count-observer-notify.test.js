const { describe, test, expect, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

describe('ViewerCountSystem stream status observer notifications', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        restoreAllMocks();
process.env.NODE_ENV = originalEnv;
    
        restoreAllModuleMocks();});

    function createSystem() {
        process.env.NODE_ENV = 'test';
        mockModule('../../../src/core/config', () => ({
            configManager: {
                getNumber: createMockFn().mockReturnValue(30)
            }
        }));
        mockModule('../../../src/utils/timeout-validator', () => ({
            safeSetInterval: createMockFn(),
            safeDelay: createMockFn()
        }));

        const { ViewerCountSystem } = require('../../../src/utils/viewer-count');
        return new ViewerCountSystem({ platforms: { youtube: {} } });
    }

    it('notifies observers on stream status change for known platform', async () => {
        const system = createSystem();
        const statusEvents = [];
        const observer = {
            getObserverId: () => 'obs-1',
            onStreamStatusChange: createMockFn((payload) => statusEvents.push(payload))
        };

        system.addObserver(observer);

        await system.updateStreamStatus('youtube', true);

        expect(observer.onStreamStatusChange).toHaveBeenCalledTimes(1);
        expect(statusEvents[0]).toEqual(
            expect.objectContaining({ platform: 'youtube', isLive: true, wasLive: false })
        );
    });

    it('skips observer notification for unknown platform', async () => {
        const system = createSystem();
        const observer = {
            getObserverId: () => 'obs-2',
            onStreamStatusChange: createMockFn()
        };

        system.addObserver(observer);

        await system.updateStreamStatus('unknownPlatform', true);

        expect(observer.onStreamStatusChange).not.toHaveBeenCalled();
    });

    it('resets counts and notifies observers when stream goes offline', async () => {
        const system = createSystem();
        const statusEvents = [];
        const countEvents = [];
        const observer = {
            getObserverId: () => 'obs-3',
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

    it('ignores updates for unknown platform without mutating counts', async () => {
        const system = createSystem();
        const observer = {
            getObserverId: () => 'obs-4',
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
