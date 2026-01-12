const { EventEmitter } = require('events');
const PlatformLifecycleService = require('../../../src/services/PlatformLifecycleService');

describe('PlatformLifecycleService stream status events', () => {
    test('status callback emits stream-status platform:event payloads', async () => {
        let capturedStatusCallback;
        const eventBus = {
            emit: jest.fn()
        };
        const streamDetector = {
            startStreamDetection: jest.fn(async (_platform, _config, connectCallback, statusCallback) => {
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
            initialize: jest.fn().mockResolvedValue(undefined)
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
