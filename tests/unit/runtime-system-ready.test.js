const { describe, expect, it, afterEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { useFakeTimers, useRealTimers, runOnlyPendingTimers } = require('../helpers/bun-timers');
const { noOpLogger } = require('../helpers/mock-factories');

const { AppRuntime } = require('../../src/main');

describe('AppRuntime system readiness payload', () => {
    afterEach(() => {
        restoreAllMocks();
        useRealTimers();
    });

    const createAppRuntimeDouble = () => {
        const bot = Object.create(AppRuntime.prototype);
        bot.eventBus = null;
        bot.getReadyServices = createMockFn().mockReturnValue(['notificationManager', 'platformLifecycleService']);
        return bot;
    };

    it('omits monitoring metrics when building system readiness payload', () => {
        const runtime = createAppRuntimeDouble();
        runtime.platformLifecycleService = {
            getStatus: createMockFn().mockReturnValue({ initializedPlatforms: ['twitch'] })
        };
        runtime.commandCooldownService = {
            getStatus: createMockFn().mockReturnValue({ activeUsers: 3 })
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
            emit: createMockFn()
        };
        bot.logger = noOpLogger;
        return bot;
    };

    it('does not emit telemetry events when restart is requested', () => {
        const runtime = createAppRuntimeDouble();
        useFakeTimers();
        spyOn(process, 'exit').mockImplementation(() => {});
        runtime.emitSystemShutdown({ reason: 'test', restartRequested: true });

        expect(runtime.eventBus.emit).not.toHaveBeenCalled();
        runOnlyPendingTimers();
        useRealTimers();
        process.exit.mockRestore();
    });

    it('invokes viewer count status cleanup during shutdown', async () => {
        const runtime = createAppRuntimeDouble();
        runtime.platformLifecycleService = { disconnectAll: createMockFn().mockResolvedValue() };
        runtime.obsEventService = { disconnect: createMockFn().mockResolvedValue() };
        runtime.platformEventRouter = { dispose: createMockFn() };
        runtime.viewerCountSystem = { stopPolling: createMockFn() };
        runtime.streamDetector = { cleanup: createMockFn() };
        runtime.notificationManager = { stopSuppressionCleanup: createMockFn() };
        runtime.viewerCountStatusCleanup = createMockFn();
        runtime.emitSystemShutdown = createMockFn();
        runtime._handleAppRuntimeError = createMockFn();

        await runtime.shutdown();

        expect(runtime.viewerCountStatusCleanup).toHaveBeenCalledTimes(1);
    });
});
