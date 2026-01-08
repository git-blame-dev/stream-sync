jest.mock('../../../src/utils/timeout-validator', () => ({
    safeSetTimeout: jest.fn((fn) => fn())
}));

jest.mock('../../../src/utils/timeout-wrapper', () => ({
    withTimeout: jest.fn((promise) => promise)
}));

jest.mock('../../../src/utils/platform-error-handler', () => {
    const handler = {
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    };
    return {
        createPlatformErrorHandler: jest.fn(() => handler)
    };
});

const { safeSetTimeout } = require('../../../src/utils/timeout-validator');
const { withTimeout } = require('../../../src/utils/timeout-wrapper');
const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const { OBSConnectionManager } = require('../../../src/obs/connection');

const mockLogger = () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
});

const baseDependencies = () => ({
    config: { address: 'ws://localhost:4455', password: 'pass', enabled: true },
    mockOBS: {
        connect: jest.fn().mockResolvedValue({ obsWebSocketVersion: '5', negotiatedRpcVersion: 1 }),
        disconnect: jest.fn().mockResolvedValue(),
        call: jest.fn().mockResolvedValue({}),
        on: jest.fn(),
        off: jest.fn(),
        once: jest.fn()
    },
    constants: {
        OBS_CONNECTION_TIMEOUT: 50,
        ERROR_MESSAGES: { OBS_CONNECTION_TIMEOUT: 'Timed out' }
    },
    isTestEnvironment: true,
    logger: mockLogger()
});

describe('OBSConnectionManager behavior', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('skips connect when already connected or connecting', async () => {
        const deps = baseDependencies();
        const manager = new OBSConnectionManager(deps);
        manager._isConnected = true;

        const result = await manager.connect();

        expect(result).toBe(true);
        expect(deps.mockOBS.connect).not.toHaveBeenCalled();

        manager._isConnected = false;
        manager.isConnecting = true;
        manager.connectionPromise = Promise.resolve('inflight');
        await expect(manager.connect()).resolves.toBe(true);
    });

    it('uses withTimeout when ensuring connection readiness', async () => {
        const deps = baseDependencies();
        const manager = new OBSConnectionManager(deps);
        manager.isConnected = jest.fn().mockReturnValue(false);
        manager.connectionPromise = Promise.resolve(true);

        await manager.ensureConnected(123);

        expect(withTimeout).toHaveBeenCalledWith(
            manager.connectionPromise,
            123,
            expect.objectContaining({ operationName: 'OBS connection readiness' })
        );
    });

    it('schedules reconnect only when enabled and not already pending', () => {
        const depsDisabled = baseDependencies();
        depsDisabled.config.enabled = false;
        const disabledManager = new OBSConnectionManager(depsDisabled);
        disabledManager.scheduleReconnect('disabled');
        expect(safeSetTimeout).not.toHaveBeenCalled();

        const depsEnabled = baseDependencies();
        const enabledManager = new OBSConnectionManager(depsEnabled);
        enabledManager.scheduleReconnect('first');
        expect(safeSetTimeout).toHaveBeenCalled();
    });

    it('routes errors through platform error handler', () => {
        const deps = baseDependencies();
        const manager = new OBSConnectionManager(deps);
        const handler = { handleEventProcessingError: jest.fn(), logOperationalError: jest.fn() };
        createPlatformErrorHandler.mockReturnValue(handler);

        manager._handleConnectionError('boom', new Error('err'), { ctx: true });
        expect(handler.handleEventProcessingError).toHaveBeenCalled();

        handler.handleEventProcessingError.mockClear();
        manager.errorHandler = handler;
        manager._handleConnectionError('op', 'non-error', { foo: 'bar' });
        expect(handler.logOperationalError).toHaveBeenCalled();
    });
});
