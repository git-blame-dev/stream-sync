const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createHandcamConfigFixture } = require('../../helpers/config-fixture');

const {
    triggerHandcamGlow,
    initializeHandcamGlow,
    setTestingDependencies,
    resetTestingDependencies
} = require('../../../src/obs/handcam-glow.ts');
const handcamGlowCompatModule = require('../../../src/obs/handcam-glow.js');

describe('handcam-glow', () => {
    let mockLogger;
    let mockEnsureConnected;
    let mockDelay;

    beforeEach(() => {
        mockLogger = noOpLogger;
        mockEnsureConnected = createMockFn().mockResolvedValue();
        mockDelay = createMockFn().mockResolvedValue();

        setTestingDependencies({
            logger: mockLogger,
            ensureConnected: mockEnsureConnected,
            delay: mockDelay
        });
    });

    afterEach(() => {
        resetTestingDependencies();
    });

    it('skips initialization when disabled in config', async () => {
        const obs = { call: createMockFn() };

        await initializeHandcamGlow(obs, createHandcamConfigFixture({ enabled: false }));

        expect(obs.call).not.toHaveBeenCalled();
    });

    it('initializes glow filter to zero when enabled', async () => {
        const obs = {
            call: createMockFn(async (action) => {
                if (action === 'GetSourceFilter') {
                    return { filterSettings: { brightness: 10 } };
                }
                return {};
            })
        };

        await initializeHandcamGlow(
            obs,
            createHandcamConfigFixture({ sourceName: 'testCam', glowFilterName: 'testGlow' })
        );

        expect(obs.call).toHaveBeenCalledWith('SetSourceFilterSettings', {
            sourceName: 'testCam',
            filterName: 'testGlow',
            filterSettings: { brightness: 10, Size: 0, glow_size: 0 }
        });
    });

    it('handles initialization failure gracefully without throwing', async () => {
        const obs = { call: createMockFn().mockRejectedValue(new Error('OBS filter not found')) };

        await expect(initializeHandcamGlow(
            obs,
            createHandcamConfigFixture({ sourceName: 'testCam', glowFilterName: 'testGlow' })
        )).resolves.toBeUndefined();
    });

    it('applies dual size fields during glow animation', async () => {
        const settingsCalls = [];
        const obs = {
            call: createMockFn(async (action, payload) => {
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

        triggerHandcamGlow(obs, createHandcamConfigFixture({ totalSteps: 1 }));
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));

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
            call: createMockFn(async (action) => {
                if (action === 'GetSourceFilter') {
                    return { filterSettings: { brightness: 10 } };
                }
                if (action === 'SetSourceFilterSettings') {
                    setCallCount += 1;
                    if (setCallCount === 1) {
                        throw new Error('First call fails');
                    }
                    return {};
                }
                return {};
            })
        };

        triggerHandcamGlow(obs, createHandcamConfigFixture({ totalSteps: 1 }));
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));

        expect(setCallCount).toBeGreaterThanOrEqual(2);
    });

    it('triggers fire-and-forget glow without throwing', async () => {
        const obs = { call: createMockFn() };
        expect(() => triggerHandcamGlow(obs, createHandcamConfigFixture())).not.toThrow();
        await new Promise(resolve => setImmediate(resolve));
    });

    it('ignores trigger when disabled', () => {
        const obs = { call: createMockFn() };
        triggerHandcamGlow(obs, createHandcamConfigFixture({ enabled: false }));
        expect(obs.call).not.toHaveBeenCalled();
    });

    it('preserves named exports through the commonjs compatibility wrapper', () => {
        expect(handcamGlowCompatModule.triggerHandcamGlow).toBe(triggerHandcamGlow);
        expect(handcamGlowCompatModule.initializeHandcamGlow).toBe(initializeHandcamGlow);
        expect(handcamGlowCompatModule.setTestingDependencies).toBe(setTestingDependencies);
        expect(handcamGlowCompatModule.resetTestingDependencies).toBe(resetTestingDependencies);
    });
});
