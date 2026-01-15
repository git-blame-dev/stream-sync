const { describe, test, expect, afterEach, it } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

describe('ViewerCountSystem polling with malformed payloads', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        restoreAllMocks();
process.env.NODE_ENV = originalEnv;
    
        restoreAllModuleMocks();});

    function createSystemReturning(value, warnSpy = null) {
        process.env.NODE_ENV = 'test';

        mockModule('../../../src/core/config', () => ({
            configManager: {
                getNumber: createMockFn().mockReturnValue(15)
            }
        }));

        mockModule('../../../src/utils/timeout-validator', () => ({
            safeSetInterval: createMockFn(),
            safeDelay: createMockFn()
        }));

        mockModule('../../../src/core/logging', () => ({
            logger: {
                debug: createMockFn(),
                info: createMockFn(),
                warn: warnSpy || createMockFn(),
                error: createMockFn()
            }
        }));

        const platform = {
            getViewerCount: createMockFn().mockResolvedValue(value)
        };

        const { ViewerCountSystem } = require('../../../src/utils/viewer-count');
        const system = new ViewerCountSystem({ platforms: { youtube: platform } });

        // Mark stream live so polling proceeds
        system.streamStatus.youtube = true;

        return { system, platform };
    }

    it('warns and preserves previous count when platform returns non-numeric value', async () => {
        const { system } = createSystemReturning('not-a-number');
        const warnSpy = spyOn(system.logger, 'warn');

        const observer = { getObserverId: () => 'obs', onViewerCountUpdate: createMockFn() };
        system.addObserver(observer);

        await system.pollPlatform('youtube');

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid viewer count'), expect.anything());
        expect(system.counts.youtube).toBe(0);
        expect(observer.onViewerCountUpdate).not.toHaveBeenCalled();
    });

    it('warns and skips update when platform returns object payload without numeric count', async () => {
        const { system } = createSystemReturning({ count: 'unknown' });
        const warnSpy = spyOn(system.logger, 'warn');

        const observer = { getObserverId: () => 'obs2', onViewerCountUpdate: createMockFn() };
        system.addObserver(observer);

        await system.pollPlatform('youtube');

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid viewer count'), expect.anything());
        expect(system.counts.youtube).toBe(0);
        expect(observer.onViewerCountUpdate).not.toHaveBeenCalled();
    });
});
