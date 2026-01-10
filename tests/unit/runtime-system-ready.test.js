jest.mock('../../src/core/logging', () => ({
    setConfigValidator: jest.fn(),
    setDebugMode: jest.fn(),
    initializeLoggingConfig: jest.fn(),
    initializeConsoleOverride: jest.fn(),
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    },
    getLogger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

const { AppRuntime } = require('../../src/main');

describe('AppRuntime system readiness payload', () => {
    const createAppRuntimeDouble = () => {
        const bot = Object.create(AppRuntime.prototype);
        bot.eventBus = null;
        bot.getReadyServices = jest.fn().mockReturnValue(['notificationManager', 'platformLifecycleService']);
        return bot;
    };

    it('omits monitoring metrics when building system readiness payload', () => {
        const runtime = createAppRuntimeDouble();
        runtime.platformLifecycleService = {
            getStatus: jest.fn().mockReturnValue({ initializedPlatforms: ['twitch'] })
        };
        runtime.commandCooldownService = {
            getStatus: jest.fn().mockReturnValue({ activeUsers: 3 })
        };

        const payload = runtime.emitSystemReady({ correlationId: 'startup-1' });

        expect(payload).toEqual(expect.objectContaining({
            services: ['notificationManager', 'platformLifecycleService'],
            platforms: { initializedPlatforms: ['twitch'] },
            cooldowns: { activeUsers: 3 },
            correlationId: 'startup-1'
        }));
        expect(payload.monitoring).toBeUndefined();
    });

    it('builds readiness payload without EventBus', () => {
        const runtime = createAppRuntimeDouble();
        runtime.eventBus = null;

        const payload = runtime.emitSystemReady({ correlationId: 'noop' });
        expect(payload).toEqual(expect.objectContaining({
            services: ['notificationManager', 'platformLifecycleService'],
            correlationId: 'noop'
        }));
    });
});

describe('AppRuntime shutdown lifecycle', () => {
    const createAppRuntimeDouble = () => {
        const bot = Object.create(AppRuntime.prototype);
        bot.eventBus = {
            emit: jest.fn()
        };
        bot.logger = {
            info: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn()
        };
        return bot;
    };

    it('does not emit telemetry events when restart is requested', () => {
        const runtime = createAppRuntimeDouble();
        jest.useFakeTimers();
        jest.spyOn(process, 'exit').mockImplementation(() => {});
        runtime.emitSystemShutdown({ reason: 'test', restartRequested: true });

        expect(runtime.eventBus.emit).not.toHaveBeenCalled();
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        process.exit.mockRestore();
    });

    it('invokes viewer count status cleanup during shutdown', async () => {
        const runtime = createAppRuntimeDouble();
        runtime.platformLifecycleService = { disconnectAll: jest.fn().mockResolvedValue() };
        runtime.obsEventService = { disconnect: jest.fn().mockResolvedValue() };
        runtime.platformEventRouter = { dispose: jest.fn() };
        runtime.viewerCountSystem = { stopPolling: jest.fn() };
        runtime.streamDetector = { cleanup: jest.fn() };
        runtime.notificationManager = { stopSuppressionCleanup: jest.fn() };
        runtime.viewerCountStatusCleanup = jest.fn();
        runtime.emitSystemShutdown = jest.fn();
        runtime._handleAppRuntimeError = jest.fn();

        await runtime.shutdown();

        expect(runtime.viewerCountStatusCleanup).toHaveBeenCalledTimes(1);
    });
});
