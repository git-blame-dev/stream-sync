const { describe, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { OBSConnectionManager } = require('../../../src/obs/connection');

describe('OBSConnectionManager', () => {
    let originalNodeEnv;

    beforeEach(() => {
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
        global.__TEST_RUNTIME_CONSTANTS__ = {
            OBS_CONNECTION_TIMEOUT: 50
        };
    });

    afterEach(() => {
        restoreAllMocks();
    });

    const createManager = (overrides = {}) => {
        return new OBSConnectionManager({
            mockOBS: overrides.mockOBS,
            OBSWebSocket: overrides.OBSWebSocket,
            config: overrides.config || {
                address: 'ws://localhost:4455',
                password: 'testPassword',
                enabled: true
            },
            isTestEnvironment: overrides.isTestEnvironment ?? true,
            testConnectionBehavior: overrides.testConnectionBehavior ?? true
        });
    };

    it('skips connect when already connected', async () => {
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
            once: createMockFn()
        };

        const manager = createManager({ mockOBS });
        manager._isConnected = true;

        await expect(manager.connect()).resolves.toBe(true);
        expect(connectSpy).not.toHaveBeenCalled();
    });

    it('returns existing promise when already connecting', async () => {
        const mockOBS = {
            connect: createMockFn(),
            disconnect: createMockFn(),
            call: createMockFn(),
            on: createMockFn(),
            off: createMockFn(),
            once: createMockFn()
        };

        const manager = createManager({ mockOBS });
        manager._isConnected = false;
        manager.isConnecting = true;
        const existingPromise = Promise.resolve(true);
        manager.connectionPromise = existingPromise;

        const promise = manager.connect();
        expect(promise).toBe(existingPromise);
        await expect(promise).resolves.toBe(true);
    });

    it('skips reconnect scheduling when disabled', () => {
        const manager = createManager({
            config: { enabled: false }
        });

        manager.scheduleReconnect('test');
        expect(manager.reconnectTimer).toBeNull();
    });

    it('does not double-schedule reconnect when already pending', () => {
        const mockOBS = {
            connect: createMockFn(),
            disconnect: createMockFn(),
            call: createMockFn(),
            on: createMockFn(),
            off: createMockFn(),
            once: createMockFn()
        };

        const manager = createManager({ mockOBS });
        manager.reconnectTimer = { id: 'existingTimer' };

        manager.scheduleReconnect('duplicate');
        expect(manager.reconnectTimer).toEqual({ id: 'existingTimer' });
    });

    it('caches and retrieves scene item IDs', () => {
        const manager = createManager();
        manager.cacheSceneItemId('testScene', '123');
        expect(manager.getCachedSceneItemId('testScene')).toBe('123');
    });

    it('clears scene item cache', () => {
        const manager = createManager();
        manager.cacheSceneItemId('testScene', '123');
        expect(manager.sceneItemIdCache.size).toBe(1);

        manager.clearSceneItemCache();
        expect(manager.sceneItemIdCache.size).toBe(0);
    });

    it('exposes connection state through getConnectionState', () => {
        const manager = createManager();
        manager._isConnected = true;

        const state = manager.getConnectionState();
        expect(state.isConnected).toBe(true);
        expect(state.config.address).toBe('ws://localhost:4455');
    });

    it('successfully completes connection when Identified event fires', async () => {
        const handlers = {};
        const mockOBS = {
            connect: createMockFn().mockResolvedValue({}),
            disconnect: createMockFn(),
            call: createMockFn(),
            on: createMockFn((event, cb) => {
                handlers[event] = cb;
            }),
            off: createMockFn(),
            once: createMockFn()
        };

        const manager = createManager({ mockOBS });
        const connectPromise = manager.connect();

        handlers.Identified?.();
        const result = await connectPromise;

        expect(result).toBe(true);
        expect(manager._isConnected).toBe(true);
    });
});
