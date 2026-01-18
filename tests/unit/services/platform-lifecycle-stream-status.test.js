const { describe, test, expect, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const PlatformLifecycleService = require('../../../src/services/PlatformLifecycleService');

describe('PlatformLifecycleService stream status events', () => {
    afterEach(() => {
        clearAllMocks();
    });

    test('status callback emits stream-status platform:event payloads', async () => {
        let capturedStatusCallback;
        const eventBus = {
            emit: createMockFn()
        };
        const streamDetector = {
            startStreamDetection: createMockFn(async (_platform, _config, connectCallback, statusCallback) => {
                capturedStatusCallback = statusCallback;
                if (typeof connectCallback === 'function') {
                    await connectCallback();
                }
            })
        };

        const service = new PlatformLifecycleService({
            config: { custom: { enabled: true } },
            eventBus,
            streamDetector
        });

        const platformInstance = {
            initialize: createMockFn().mockResolvedValue(undefined)
        };

        await service.initializePlatformWithStreamDetection('custom', platformInstance, {}, { enabled: true });

        expect(typeof capturedStatusCallback).toBe('function');

        capturedStatusCallback('live', 'Stream detected');
        const firstCall = eventBus.emit.mock.calls.find(([eventName, payload]) => (
            eventName === 'platform:event' &&
            payload?.platform === 'custom' &&
            payload?.type === 'platform:stream-status' &&
            payload?.data?.isLive === true &&
            payload?.data?.status === 'live'
        ));
        expect(firstCall).toBeTruthy();
        expect(firstCall[1].data.timestamp).toEqual(expect.any(String));

        capturedStatusCallback('waiting', 'Still waiting');
        const secondCall = eventBus.emit.mock.calls.find(([eventName, payload]) => (
            eventName === 'platform:event' &&
            payload?.platform === 'custom' &&
            payload?.type === 'platform:stream-status' &&
            payload?.data?.isLive === false &&
            payload?.data?.status === 'waiting'
        ));
        expect(secondCall).toBeTruthy();
        expect(secondCall[1].data.timestamp).toEqual(expect.any(String));
    });
});
