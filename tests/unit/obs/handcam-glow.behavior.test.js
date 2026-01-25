const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createHandcamConfigFixture } = require('../../helpers/config-fixture');

const handcamGlow = require('../../../src/obs/handcam-glow');

describe('handcam-glow', () => {
    let mockLogger;
    let mockEnsureConnected;
    let mockDelay;

    beforeEach(() => {
        mockLogger = noOpLogger;
        mockEnsureConnected = createMockFn().mockResolvedValue();
        mockDelay = createMockFn().mockResolvedValue();

        handcamGlow._testing.setDependencies({
            logger: mockLogger,
            ensureConnected: mockEnsureConnected,
            delay: mockDelay
        });
    });

    afterEach(() => {
        handcamGlow._testing.resetDependencies();
    });

    it('skips initialization when disabled in config', async () => {
        const obs = { call: createMockFn() };

        await handcamGlow.initializeHandcamGlow(obs, createHandcamConfigFixture({ enabled: false }));

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

        await handcamGlow.initializeHandcamGlow(
            obs,
            createHandcamConfigFixture({ enabled: true, sourceName: 'testCam', glowFilterName: 'testGlow' })
        );

        expect(obs.call).toHaveBeenCalledWith('SetSourceFilterSettings', {
            sourceName: 'testCam',
            filterName: 'testGlow',
            filterSettings: { brightness: 10, Size: 0, glow_size: 0 }
        });
    });

    it('handles initialization failure gracefully without throwing', async () => {
        const obs = { call: createMockFn().mockRejectedValue(new Error('OBS filter not found')) };

        await expect(handcamGlow.initializeHandcamGlow(
            obs,
            createHandcamConfigFixture({ enabled: true, sourceName: 'testCam', glowFilterName: 'testGlow' })
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

        handcamGlow.triggerHandcamGlow(obs, createHandcamConfigFixture({ enabled: true, totalSteps: 1 }));
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

        handcamGlow.triggerHandcamGlow(obs, createHandcamConfigFixture({ enabled: true, totalSteps: 1 }));
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));

        expect(setCallCount).toBeGreaterThanOrEqual(2);
    });

    it('triggers fire-and-forget glow without throwing', async () => {
        const obs = { call: createMockFn() };
        expect(() => handcamGlow.triggerHandcamGlow(obs, createHandcamConfigFixture({ enabled: true }))).not.toThrow();
        await new Promise(resolve => setImmediate(resolve));
    });

    it('ignores trigger when disabled', () => {
        const obs = { call: createMockFn() };
        handcamGlow.triggerHandcamGlow(obs, createHandcamConfigFixture({ enabled: false }));
        expect(obs.call).not.toHaveBeenCalled();
    });
});
