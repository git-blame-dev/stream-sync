const { describe, expect, afterEach, it, beforeEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { OBSConnectionManager } = require('../../../src/obs/connection');

describe('OBSConnectionManager behavior', () => {
    let originalNodeEnv;

    beforeEach(() => {
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
        global.__TEST_RUNTIME_CONSTANTS__ = {
            OBS_CONNECTION_TIMEOUT: 50
        };
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        delete global.__TEST_RUNTIME_CONSTANTS__;
        restoreAllMocks();
    });

    const createDeps = (overrides = {}) => ({
        config: { address: 'ws://localhost:4455', password: 'testPass', enabled: true },
        mockOBS: {
            connect: createMockFn().mockResolvedValue({ obsWebSocketVersion: '5', negotiatedRpcVersion: 1 }),
            disconnect: createMockFn().mockResolvedValue(),
            call: createMockFn().mockResolvedValue({}),
            on: createMockFn(),
            off: createMockFn(),
            once: createMockFn()
        },
        constants: {
            OBS_CONNECTION_TIMEOUT: 50,
            ERROR_MESSAGES: { OBS_CONNECTION_TIMEOUT: 'Timed out' }
        },
        isTestEnvironment: true,
        ...overrides
    });

    it('returns true immediately when already connected', async () => {
        const deps = createDeps();
        const manager = new OBSConnectionManager(deps);
        manager._isConnected = true;

        const result = await manager.connect();

        expect(result).toBe(true);
        expect(deps.mockOBS.connect).not.toHaveBeenCalled();
    });

    it('returns existing promise when connection already in progress', async () => {
        const deps = createDeps({ testConnectionBehavior: true });
        const manager = new OBSConnectionManager(deps);
        manager._isConnected = false;
        manager.isConnecting = true;
        const existingPromise = Promise.resolve('existing');
        manager.connectionPromise = existingPromise;

        const result = await manager.connect();

        expect(result).toBe('existing');
    });

    it('skips reconnect scheduling when OBS is disabled', () => {
        const deps = createDeps({ config: { enabled: false } });
        const manager = new OBSConnectionManager(deps);

        manager.scheduleReconnect('test');

        expect(manager.reconnectTimer).toBeNull();
    });

    it('does not double-schedule reconnect when already pending', () => {
        const deps = createDeps();
        const manager = new OBSConnectionManager(deps);
        manager.reconnectTimer = { id: 'existing' };

        manager.scheduleReconnect('test');

        expect(manager.reconnectTimer).toEqual({ id: 'existing' });
    });

    it('exposes connection state via getConnectionState', () => {
        const deps = createDeps();
        const manager = new OBSConnectionManager(deps);
        manager._isConnected = true;

        const state = manager.getConnectionState();

        expect(state.isConnected).toBe(true);
        expect(state.config.address).toBe('ws://localhost:4455');
    });

    it('exposes config via getConfig', () => {
        const deps = createDeps();
        const manager = new OBSConnectionManager(deps);

        const config = manager.getConfig();

        expect(config.address).toBe('ws://localhost:4455');
        expect(config.password).toBe('testPass');
        expect(config.enabled).toBe(true);
    });

    it('isConnected returns internal connection state when testConnectionBehavior enabled', () => {
        const deps = createDeps({ testConnectionBehavior: true });
        const manager = new OBSConnectionManager(deps);

        expect(manager.isConnected()).toBe(false);

        manager._isConnected = true;
        expect(manager.isConnected()).toBe(true);
    });

    it('isConnected returns true by default in test environment for convenience', () => {
        const deps = createDeps();
        const manager = new OBSConnectionManager(deps);

        expect(manager.isConnected()).toBe(true);
    });
});
