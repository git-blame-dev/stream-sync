const { describe, expect, afterEach, it, beforeEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../src/core/secrets');

const {
    OBSConnectionManager,
    getOBSConnectionManager,
    resetOBSConnectionManager,
    obsCall,
    ensureOBSConnected
} = require('../../../src/obs/connection.ts');

describe('OBSConnectionManager behavior', () => {
    let originalNodeEnv;

    beforeEach(() => {
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        restoreAllMocks();
        _resetForTesting();
        initializeStaticSecrets();
        resetOBSConnectionManager();
    });

    const createMockOBS = () => ({
        connect: createMockFn().mockResolvedValue({ obsWebSocketVersion: '5', negotiatedRpcVersion: 1 }),
        disconnect: createMockFn().mockResolvedValue(),
        call: createMockFn().mockResolvedValue({}),
        on: createMockFn(),
        off: createMockFn(),
        once: createMockFn()
    });

    const createDeps = (overrides: {
        obs?: ReturnType<typeof createMockOBS>;
        config?: Record<string, unknown>;
        constants?: Record<string, unknown>;
    } = {}) => ({
        config: { address: 'ws://localhost:4455', password: 'testPass', enabled: true, connectionTimeoutMs: 50 },
        obs: overrides.obs || createMockOBS(),
        constants: {
            ERROR_MESSAGES: { OBS_CONNECTION_TIMEOUT: 'Timed out' }
        },
        ...overrides
    });

    it('returns true immediately when already connected', async () => {
        const mockOBS = createMockOBS();
        const deps = createDeps({ obs: mockOBS });
        const manager = new OBSConnectionManager(deps);
        manager._isConnected = true;

        const result = await manager.connect();

        expect(result).toBe(true);
        expect(mockOBS.connect).not.toHaveBeenCalled();
    });

    it('returns existing promise when connection already in progress', async () => {
        const deps = createDeps();
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

    it('uses secrets password when config password is undefined', () => {
        _resetForTesting();
        secrets.obs.password = 'secret-from-env';

        const deps = createDeps({ config: { address: 'ws://localhost:4455', enabled: true, connectionTimeoutMs: 50 } });
        const manager = new OBSConnectionManager(deps);

        expect(manager.getConfig().password).toBe('secret-from-env');
    });

    it('isConnected returns internal connection state', () => {
        const deps = createDeps();
        const manager = new OBSConnectionManager(deps);

        expect(manager.isConnected()).toBe(false);

        manager._isConnected = true;
        expect(manager.isConnected()).toBe(true);
    });

    it('reuses singleton manager and applies config updates for subsequent dependency config', () => {
        const mockOBS = createMockOBS();

        const first = getOBSConnectionManager({
            obs: mockOBS,
            config: { address: 'ws://first:4455', password: 'first-pass', enabled: true, connectionTimeoutMs: 50 },
            constants: { ERROR_MESSAGES: { OBS_CONNECTION_TIMEOUT: 'Timed out' } }
        });
        const second = getOBSConnectionManager({
            config: { address: 'ws://second:4455' }
        });

        expect(second).toBe(first);
        expect(second.getConfig().address).toBe('ws://second:4455');
    });

    it('routes obsCall and ensureOBSConnected through the singleton manager', async () => {
        const mockOBS = createMockOBS();
        mockOBS.call.mockResolvedValue({ ok: true });
        const manager = getOBSConnectionManager({
            obs: mockOBS,
            config: { address: 'ws://helper:4455', password: 'helper-pass', enabled: true, connectionTimeoutMs: 50 },
            constants: { ERROR_MESSAGES: { OBS_CONNECTION_TIMEOUT: 'Timed out' } }
        });

        manager._isConnected = true;
        let observedMaxWait: number | null = null;
        manager.ensureConnected = createMockFn().mockImplementation(async (maxWait: number) => {
            observedMaxWait = maxWait;
        });

        const response = await obsCall('GetSceneList', {});
        await ensureOBSConnected(1234);

        expect(response).toEqual({ ok: true });
        expect(observedMaxWait).toBe(1234);
    });

    it('forwards event listener registration helpers to obs client methods', () => {
        const mockOBS = createMockOBS();
        const registeredHandlers = new Map<string, (...args: unknown[]) => void>();
        mockOBS.on.mockImplementation((eventName: string, handler: (...args: unknown[]) => void) => {
            registeredHandlers.set(eventName, handler);
        });
        mockOBS.off.mockImplementation((eventName: string, handler: (...args: unknown[]) => void) => {
            if (registeredHandlers.get(eventName) === handler) {
                registeredHandlers.delete(eventName);
            }
        });

        const manager = new OBSConnectionManager(createDeps({ obs: mockOBS }));
        const handler = () => {};

        manager.addEventListener('ConnectionClosed', handler);
        expect(registeredHandlers.get('ConnectionClosed')).toBe(handler);

        manager.removeEventListener('ConnectionClosed', handler);
        expect(registeredHandlers.has('ConnectionClosed')).toBe(false);
    });

    it('caches and clears scene item ids via helper methods', () => {
        const manager = new OBSConnectionManager(createDeps());

        manager.cacheSceneItemId('scene:source', 42);
        expect(manager.getCachedSceneItemId('scene:source')).toBe(42);

        manager.clearSceneItemCache();
        expect(manager.getCachedSceneItemId('scene:source')).toBeUndefined();
    });
});
