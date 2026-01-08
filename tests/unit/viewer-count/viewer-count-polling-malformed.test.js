describe('ViewerCountSystem polling with malformed payloads', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = originalEnv;
    });

    function createSystemReturning(value, warnSpy = null) {
        process.env.NODE_ENV = 'test';

        jest.doMock('../../../src/core/config', () => ({
            configManager: {
                getNumber: jest.fn().mockReturnValue(15)
            }
        }));

        jest.doMock('../../../src/utils/timeout-validator', () => ({
            safeSetInterval: jest.fn(),
            safeDelay: jest.fn()
        }));

        jest.doMock('../../../src/core/logging', () => ({
            logger: {
                debug: jest.fn(),
                info: jest.fn(),
                warn: warnSpy || jest.fn(),
                error: jest.fn()
            }
        }));

        const platform = {
            getViewerCount: jest.fn().mockResolvedValue(value)
        };

        const { ViewerCountSystem } = require('../../../src/utils/viewer-count');
        const system = new ViewerCountSystem({ platforms: { youtube: platform } });

        // Mark stream live so polling proceeds
        system.streamStatus.youtube = true;

        return { system, platform };
    }

    it('warns and preserves previous count when platform returns non-numeric value', async () => {
        const { system } = createSystemReturning('not-a-number');
        const warnSpy = jest.spyOn(system.logger, 'warn');

        const observer = { getObserverId: () => 'obs', onViewerCountUpdate: jest.fn() };
        system.addObserver(observer);

        await system.pollPlatform('youtube');

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid viewer count'), expect.anything());
        expect(system.counts.youtube).toBe(0);
        expect(observer.onViewerCountUpdate).not.toHaveBeenCalled();
    });

    it('warns and skips update when platform returns object payload without numeric count', async () => {
        const { system } = createSystemReturning({ count: 'unknown' });
        const warnSpy = jest.spyOn(system.logger, 'warn');

        const observer = { getObserverId: () => 'obs2', onViewerCountUpdate: jest.fn() };
        system.addObserver(observer);

        await system.pollPlatform('youtube');

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('invalid viewer count'), expect.anything());
        expect(system.counts.youtube).toBe(0);
        expect(observer.onViewerCountUpdate).not.toHaveBeenCalled();
    });
});
