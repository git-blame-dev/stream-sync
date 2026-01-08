const { OBSConnectionManager } = require('../../src/obs/connection');

describe('OBSConnectionManager reconnection behavior', () => {
    let mockOBS;
    let manager;
    let identifiedCallback;
    let connectionClosedCallback;

    const runPendingTimers = async () => {
        if (typeof jest.runOnlyPendingTimersAsync === 'function') {
            await jest.runOnlyPendingTimersAsync();
        } else {
            jest.runOnlyPendingTimers();
            await Promise.resolve();
        }
    };

    beforeEach(() => {
        jest.useFakeTimers();
        identifiedCallback = null;
        connectionClosedCallback = null;

        mockOBS = {
            connect: jest.fn(),
            disconnect: jest.fn().mockResolvedValue(),
            call: jest.fn(),
            on: jest.fn((event, cb) => {
                if (event === 'Identified') identifiedCallback = cb;
                if (event === 'ConnectionClosed') connectionClosedCallback = cb;
            }),
            once: jest.fn(),
            off: jest.fn()
        };

        manager = new OBSConnectionManager({
            mockOBS,
            isTestEnvironment: true,
            testConnectionBehavior: true,
            config: {
                address: 'ws://localhost:4455',
                password: 'test-password',
                enabled: true
            }
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it('schedules a reconnect after a failed connect attempt', async () => {
        mockOBS.connect
            .mockRejectedValueOnce(new Error('fail-first'))
            .mockResolvedValue({ obsWebSocketVersion: '5', negotiatedRpcVersion: 1 });

        await manager.connect().catch(() => {});

        await runPendingTimers();

        expect(mockOBS.connect).toHaveBeenCalledTimes(2);

        if (identifiedCallback) {
            identifiedCallback();
        }
    });

    it('schedules reconnect on ConnectionClosed events', async () => {
        mockOBS.connect.mockResolvedValue({ obsWebSocketVersion: '5', negotiatedRpcVersion: 1 });

        const connectPromise = manager.connect();
        if (identifiedCallback) identifiedCallback();
        await connectPromise;

        if (connectionClosedCallback) {
            connectionClosedCallback({ code: 1006, reason: 'test' });
        }

        await runPendingTimers();

        expect(mockOBS.connect).toHaveBeenCalledTimes(2);
    });
});
