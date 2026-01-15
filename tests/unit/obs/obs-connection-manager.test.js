
const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, spyOn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');
const { useFakeTimers, useRealTimers, runOnlyPendingTimers } = require('../../helpers/bun-timers');

mockModule('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: createMockFn(() => ({
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn()
    }))
}));

const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const { OBSConnectionManager } = require('../../../src/obs/connection');

describe('OBSConnectionManager', () => {
    const logger = {
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn()
    };

    const createManager = (overrides = {}) => {
        return new OBSConnectionManager({
            logger,
            mockOBS: overrides.mockOBS,
            OBSWebSocket: overrides.OBSWebSocket,
            config: overrides.config || {
                address: 'ws://localhost:4455',
                password: 'test-password',
                enabled: true
            },
            isTestEnvironment: overrides.isTestEnvironment ?? true,
            testConnectionBehavior: overrides.testConnectionBehavior ?? true
        });
    };

    const runPendingTimers = async () => {
        if (typeof jest.runOnlyPendingTimersAsync === 'function') {
            await runOnlyPendingTimers();
        } else {
            runOnlyPendingTimers();
            await Promise.resolve();
        }
    };

    beforeEach(() => {
        useFakeTimers();
    });

    afterEach(() => {
        restoreAllMocks();
        useRealTimers();
    
        restoreAllModuleMocks();});

    it('skips connect when already connected or connecting', async () => {
        const connectSpy = createMockFn().mockResolvedValue({
            obsWebSocketVersion: '5',
            negotiatedRpcVersion: 1
        });
        const mockOBS = {
            connect: connectSpy,
            disconnect: createMockFn(),
            call: createMockFn(),
            on: createMockFn(),
            off: createMockFn(),
            once: createMockFn(),
            addEventListener: createMockFn(),
            removeEventListener: createMockFn()
        };

        const manager = createManager({ mockOBS });
        manager._isConnected = true;

        await expect(manager.connect()).resolves.toBe(true);
        expect(connectSpy).not.toHaveBeenCalled();

        manager._isConnected = false;
        manager.isConnecting = true;
        const existingPromise = Promise.resolve(true);
        manager.connectionPromise = existingPromise;

        const promise = manager.connect();
        expect(promise).toBe(existingPromise);
        await expect(promise).resolves.toBe(true);
        expect(connectSpy).not.toHaveBeenCalled();
    });

    it('schedules reconnect once and skips when already connected/connecting', async () => {
        spyOn(global, 'setTimeout');
        const mockOBS = {
            connect: createMockFn(),
            disconnect: createMockFn(),
            call: createMockFn(),
            on: createMockFn(),
            off: createMockFn(),
            once: createMockFn(),
            addEventListener: createMockFn(),
            removeEventListener: createMockFn()
        };
        const manager = createManager({ mockOBS });

        manager.scheduleReconnect('first');
        manager.scheduleReconnect('duplicate');
        expect(global.setTimeout).toHaveBeenCalledTimes(1);

        manager.isConnecting = true;
        await runPendingTimers();
        expect(mockOBS.connect).not.toHaveBeenCalled();

        mockOBS.connect.mockClear();
        manager.isConnecting = false;
        manager._isConnected = true;
        manager.scheduleReconnect('connected');
        await runPendingTimers();
        expect(mockOBS.connect).not.toHaveBeenCalled();
    });

    it('routes connection errors through platform error handler', async () => {
        const connectSpy = createMockFn().mockRejectedValue(new Error('connect failed'));
        class FailingOBS {
            constructor() {
                this.connect = connectSpy;
                this.disconnect = createMockFn();
                this.call = createMockFn();
                this.on = createMockFn();
                this.off = createMockFn();
                this.once = createMockFn();
                this.addEventListener = createMockFn();
                this.removeEventListener = createMockFn();
            }
        }

        const manager = createManager({
            OBSWebSocket: FailingOBS,
            isTestEnvironment: false,
            testConnectionBehavior: true
        });

        const errorHandler = createPlatformErrorHandler(logger, 'obs-connection') || {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
        manager.errorHandler = errorHandler;

        await expect(manager.connect()).rejects.toThrow('connect failed');

        expect(createPlatformErrorHandler).toHaveBeenCalled();
        expect(errorHandler.handleEventProcessingError).toHaveBeenCalled();
        const [errorArg, source, payload, message, context] = errorHandler.handleEventProcessingError.mock.calls[0];
        expect(errorArg).toBeInstanceOf(Error);
        expect(errorArg.message).toContain('connect failed');
        expect(source).toBe('obs-connection');
        expect(message).toContain('connect failed');
        expect(context).toBe('obs-connection');
        expect(payload).toEqual(expect.objectContaining({ requestType: 'Connect' }));
    });

    it('clears reconnect timer on successful connect and completion handler', async () => {
        const connectSpy = createMockFn().mockResolvedValue({});
        const handlers = {};
        const mockOBS = {
            connect: connectSpy,
            disconnect: createMockFn(),
            call: createMockFn(),
            on: createMockFn((event, cb) => {
                handlers[event] = cb;
            }),
            off: createMockFn(),
            once: createMockFn(),
            addEventListener: createMockFn(),
            removeEventListener: createMockFn()
        };

        const manager = createManager({ mockOBS });
        const connectPromise = manager.connect();
        handlers.Identified?.();
        const result = await connectPromise;
        expect(result).toBe(true);

        manager.scheduleReconnect('after-success');
        await runPendingTimers();
        expect(manager.reconnectTimer).toBeNull();

        manager.clearReconnectTimer();
        expect(manager.reconnectTimer).toBeNull();
    });

    it('caches and retrieves scene item IDs', () => {
        const manager = createManager();
        manager.cacheSceneItemId('chat', '123');
        expect(manager.getCachedSceneItemId('chat')).toBe('123');
    });
});
