const { describe, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { useFakeTimers, useRealTimers, runOnlyPendingTimers } = require('../../helpers/bun-timers');

const { OBSConnectionManager, getOBSConnectionManager, resetOBSConnectionManager } = require('../../../src/obs/connection.ts');

describe('OBSConnectionManager reconnection behavior', () => {
    let mockOBS;
    let manager;
    let identifiedCallback;
    let connectionClosedCallback;

    const advanceTimers = async () => {
        runOnlyPendingTimers();
        await Promise.resolve();
    };

    beforeEach(() => {
        resetOBSConnectionManager();
        useFakeTimers();
        identifiedCallback = null;
        connectionClosedCallback = null;

        mockOBS = {
            connect: createMockFn(),
            disconnect: createMockFn().mockResolvedValue(),
            call: createMockFn(),
            on: createMockFn((event, cb) => {
                if (event === 'Identified') identifiedCallback = cb;
                if (event === 'ConnectionClosed') connectionClosedCallback = cb;
            }),
            once: createMockFn(),
            off: createMockFn()
        };

        manager = new OBSConnectionManager({
            obs: mockOBS,
            config: {
                address: 'ws://localhost:4455',
                password: 'test-password',
                enabled: true,
                connectionTimeoutMs: 5000
            }
        });
    });

    afterEach(() => {
        resetOBSConnectionManager();
        restoreAllMocks();
        useRealTimers();
        clearAllMocks();
    });

    it('schedules a reconnect after a failed connect attempt', async () => {
        mockOBS.connect
            .mockRejectedValueOnce(new Error('fail-first'))
            .mockResolvedValue({ obsWebSocketVersion: '5', negotiatedRpcVersion: 1 });

        await manager.connect().catch(() => {});

        await advanceTimers();

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

        await advanceTimers();

        expect(mockOBS.connect).toHaveBeenCalledTimes(2);
    });

    it('does not reconnect after intentional disconnect', async () => {
        mockOBS.disconnect.mockImplementation(async () => {
            if (connectionClosedCallback) {
                connectionClosedCallback({ code: 1000, reason: 'intentional-disconnect' });
            }
        });
        mockOBS.connect.mockResolvedValue({ obsWebSocketVersion: '5', negotiatedRpcVersion: 1 });

        const connectPromise = manager.connect();
        if (identifiedCallback) {
            identifiedCallback();
        }
        await connectPromise;

        manager.reconnectIntervalMs = 10;
        await manager.disconnect();
        await advanceTimers();

        expect(mockOBS.connect).toHaveBeenCalledTimes(1);
    });

    it('clears pending reconnect work when singleton manager resets', async () => {
        const singletonOBS = {
            connect: createMockFn().mockResolvedValue({ obsWebSocketVersion: '5', negotiatedRpcVersion: 1 }),
            disconnect: createMockFn().mockResolvedValue(),
            call: createMockFn(),
            on: createMockFn(),
            off: createMockFn(),
            once: createMockFn()
        };

        const singletonManager = getOBSConnectionManager({
            obs: singletonOBS,
            config: {
                address: 'ws://localhost:4455',
                password: 'singleton-password',
                enabled: true,
                connectionTimeoutMs: 5000
            }
        });

        singletonManager.reconnectIntervalMs = 10;
        singletonManager.scheduleReconnect('test-singleton-reset');

        resetOBSConnectionManager();
        await advanceTimers();

        expect(singletonOBS.connect).not.toHaveBeenCalled();
    });
});
