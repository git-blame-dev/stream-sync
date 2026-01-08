const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');

describe('ViewerCountSystem polling interval validation', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = originalEnv;
    });

    const loadViewerCountSystem = () => {
        process.env.NODE_ENV = 'test';

        const safeSetInterval = jest.fn();

        jest.doMock('../../../src/utils/timeout-validator', () => ({
            safeSetInterval,
            safeDelay: jest.fn()
        }));

        const { ViewerCountSystem } = require('../../../src/utils/viewer-count');
        const runtimeConstants = createRuntimeConstantsFixture({
            VIEWER_COUNT_POLLING_INTERVAL_SECONDS: -5
        });
        return { ViewerCountSystem, safeSetInterval, runtimeConstants };
    };

    it('does not start polling when interval is zero or negative', () => {
        const { ViewerCountSystem, safeSetInterval, runtimeConstants } = loadViewerCountSystem();
        const system = new ViewerCountSystem({
            platforms: { twitch: {}, youtube: {} },
            runtimeConstants
        });
        const baselineCalls = safeSetInterval.mock.calls.length;

        system.startPolling();

        expect(system.isPolling).toBe(false);
        expect(Object.keys(system.pollingHandles)).toHaveLength(0);
        expect(safeSetInterval.mock.calls.length).toBe(baselineCalls);
    });
});
