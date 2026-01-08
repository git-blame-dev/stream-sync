
jest.mock('../../../src/obs/connection', () => ({
    ensureOBSConnected: jest.fn().mockResolvedValue()
}));
const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('../../../src/core/logging', () => ({
    logger: mockLogger,
    getUnifiedLogger: jest.fn(() => mockLogger)
}));
jest.mock('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: jest.fn(() => ({
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    }))
}));
jest.mock('../../../src/utils/timeout-validator', () => ({
    safeDelay: jest.fn().mockResolvedValue(),
    safeSetTimeout: jest.fn()
}));

let ensureOBSConnected;
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');

describe('handcam-glow', () => {
    let handcamGlow;
    let runtimeConstants;

    const flushPromises = async (iterations = 3) => {
        for (let i = 0; i < iterations; i += 1) {
            await new Promise(resolve => setImmediate(resolve));
        }
    };

    beforeEach(() => {
        jest.resetModules();
        handcamGlow = require('../../../src/obs/handcam-glow');
        ensureOBSConnected = require('../../../src/obs/connection').ensureOBSConnected;
        runtimeConstants = createRuntimeConstantsFixture();
        Object.values(mockLogger).forEach(fn => fn.mockClear && fn.mockClear());
    });

    it('skips initialization when disabled in config', async () => {
        const obs = { call: jest.fn() };

        await handcamGlow.initializeHandcamGlow(obs, { glowEnabled: false }, runtimeConstants);

        expect(obs.call).not.toHaveBeenCalled();
    });

    it('initializes glow filter to zero when enabled', async () => {
        const obs = {
            call: jest.fn(async (action) => {
                if (action === 'GetSourceFilter') {
                    return { filterSettings: { brightness: 10 } };
                }
                return {};
            })
        };

        await handcamGlow.initializeHandcamGlow(
            obs,
            { glowEnabled: true, sourceName: 'cam', filterName: 'Glow' },
            runtimeConstants
        );

        expect(ensureOBSConnected).toHaveBeenCalled();
        expect(obs.call).toHaveBeenCalledWith('SetSourceFilterSettings', {
            sourceName: 'cam',
            filterName: 'Glow',
            filterSettings: { brightness: 10, Size: 0, glow_size: 0 }
        });
    });

    it('logs and returns when initialization fails', async () => {
        const obs = { call: jest.fn().mockRejectedValue(new Error('fail')) };

        await handcamGlow.initializeHandcamGlow(
            obs,
            { glowEnabled: true, sourceName: 'cam', filterName: 'Glow' },
            runtimeConstants
        );

        const logged = mockLogger.debug.mock.calls.some(call => (call[0] || '').includes('Error initializing glow filter'));
        expect(logged).toBe(true);
    });

    it('applies dual size fields during glow animation', async () => {
        const settingsCalls = [];
        const obs = {
            call: jest.fn(async (action, payload) => {
                if (action === 'GetSourceFilter') {
                    return { filterSettings: { brightness: 10 } };
                }
                if (action === 'SetSourceFilterSettings') {
                    settingsCalls.push(payload.filterSettings);
                    return {};
                }
                return {};
            })
        };

        handcamGlow.triggerHandcamGlow(obs, { glowEnabled: true, totalSteps: 1 }, runtimeConstants);
        await flushPromises();

        const hasDualSizeFields = settingsCalls.some((settings) => (
            Number.isFinite(settings.Size)
            && Number.isFinite(settings.glow_size)
            && settings.Size === settings.glow_size
        ));

        expect(hasDualSizeFields).toBe(true);
    });

    it('resets glow properties after animation error without throwing', async () => {
        let setCallCount = 0;
        const obs = {
            call: jest.fn(async (action) => {
                if (action === 'GetSourceFilter') {
                    return { filterSettings: { brightness: 10 } };
                }
                if (action === 'SetSourceFilterSettings') {
                    setCallCount += 1;
                    if (setCallCount === 1) {
                        throw new Error('boom');
                    }
                    return {};
                }
                return {};
            })
        };

        handcamGlow.triggerHandcamGlow(obs, { glowEnabled: true, totalSteps: 1 }, runtimeConstants);
        await flushPromises(4);

        const resetLogged = mockLogger.debug.mock.calls.some(call => (call[0] || '').includes('Reset glow properties after error'));

        expect(setCallCount).toBeGreaterThanOrEqual(2);
        expect(resetLogged).toBe(true);
    });

    it('triggers fire-and-forget glow without throwing', async () => {
        handcamGlow.triggerHandcamGlow({ call: jest.fn() }, { glowEnabled: true }, runtimeConstants);
        await new Promise(resolve => setImmediate(resolve));

        const triggerLog = mockLogger.debug.mock.calls.some(call => (call[0] || '').includes('Triggering glow animation'));
        expect(triggerLog).toBe(true);
    });

    it('ignores trigger when disabled', () => {
        handcamGlow.triggerHandcamGlow({ call: jest.fn() }, { glowEnabled: false }, runtimeConstants);

        const ignoredMessage = mockLogger.debug.mock.calls.some(call => (call[0] || '').includes('Glow trigger ignored'));
        expect(ignoredMessage).toBe(true);
    });
});
