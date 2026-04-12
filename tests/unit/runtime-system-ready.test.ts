import { describe, expect, it, afterEach } from 'bun:test';
import { createRequire } from 'node:module';

const load = createRequire(__filename);
const { createMockFn, restoreAllMocks } = load('../helpers/bun-mock-utils');
const { useFakeTimers, useRealTimers, runOnlyPendingTimers } = load('../helpers/bun-timers');
const { noOpLogger } = load('../helpers/mock-factories');

const { AppRuntime } = require('../../src/runtime/AppRuntime');

describe('AppRuntime system readiness payload', () => {
    afterEach(() => {
        restoreAllMocks();
        useRealTimers();
    });

    const createAppRuntimeDouble = () => {
        const bot = Object.create(AppRuntime.prototype);
        bot.eventBus = null;
        bot.getReadyServices = createMockFn().mockReturnValue(['notificationManager', 'platformLifecycleService']);
        bot.logger = noOpLogger;
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

        const payload = runtime.emitSystemReady({ correlationId: 'test-startup-1' });

        expect(payload).toEqual(expect.objectContaining({
            services: ['notificationManager', 'platformLifecycleService'],
            platforms: { initializedPlatforms: ['twitch'] },
            cooldowns: { activeUsers: 3 },
            correlationId: 'test-startup-1'
        }));
        expect(payload.monitoring).toBeUndefined();
    });

    it('builds readiness payload without EventBus', () => {
        const runtime = createAppRuntimeDouble();
        runtime.eventBus = null;

        const payload = runtime.emitSystemReady({ correlationId: 'test-noop' });
        expect(payload).toEqual(expect.objectContaining({
            services: ['notificationManager', 'platformLifecycleService'],
            correlationId: 'test-noop'
        }));
    });

    it('marks readiness as degraded when platform lifecycle status reports failures', () => {
        const runtime = createAppRuntimeDouble();
        const emitCalls: unknown[][] = [];
        runtime.eventBus = {
            emit: (...args: unknown[]) => emitCalls.push(args)
        };
        runtime.platformLifecycleService = {
            getStatus: createMockFn().mockReturnValue({
                failedPlatforms: [{ name: 'twitch', lastError: 'auth failed' }],
                platformHealth: {
                    twitch: { state: 'failed', lastError: 'auth failed' }
                }
            })
        };

        const payload = runtime.emitSystemReady({ correlationId: 'test-degraded-ready' });

        expect(payload).toEqual(expect.objectContaining({
            correlationId: 'test-degraded-ready',
            degraded: true,
            degradationReasons: expect.arrayContaining(['platform-initialization-failed'])
        }));
        expect(emitCalls).toEqual([
            ['system:ready', payload]
        ]);
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

    it('emits shutdown lifecycle event with restart mode when restart is requested', () => {
        const runtime = createAppRuntimeDouble();
        const emitCalls: unknown[][] = [];
        runtime.eventBus.emit = (...args) => emitCalls.push(args);
        useFakeTimers();
        const originalExit = process.exit;
        process.exit = (() => undefined as never) as typeof process.exit;
        try {
            runtime.emitSystemShutdown({ reason: 'test', restartRequested: true });

            expect(emitCalls).toEqual([
                ['system:shutdown', { reason: 'test', mode: 'restart' }]
            ]);
            runOnlyPendingTimers();
        } finally {
            process.exit = originalExit;
            useRealTimers();
        }
    });

    it('emits shutdown lifecycle event before exiting on normal shutdown', () => {
        const runtime = createAppRuntimeDouble();
        const emitCalls: unknown[][] = [];
        runtime.eventBus.emit = (...args: unknown[]) => emitCalls.push(args);
        useFakeTimers();
        const originalExit = process.exit;
        process.exit = (() => undefined as never) as typeof process.exit;
        try {
            runtime.emitSystemShutdown({ reason: 'manual' });

            expect(emitCalls).toEqual([
                ['system:shutdown', { reason: 'manual', mode: 'exit' }]
            ]);
            runOnlyPendingTimers();
        } finally {
            process.exit = originalExit;
            useRealTimers();
        }
    });

    it('invokes viewer count status cleanup during shutdown', async () => {
        const runtime = createAppRuntimeDouble();
        const cleanupCalls: string[] = [];
        runtime.platformLifecycleService = { disconnectAll: createMockFn().mockResolvedValue() };
        runtime.obsEventService = { disconnect: createMockFn().mockResolvedValue() };
        runtime.platformEventRouter = { dispose: createMockFn() };
        runtime.viewerCountSystem = { stopPolling: createMockFn() };
        runtime.notificationManager = { stopSuppressionCleanup: createMockFn() };
        runtime.viewerCountStatusCleanup = () => cleanupCalls.push('cleanup');
        const originalExit = process.exit;
        process.exit = (() => undefined as never) as typeof process.exit;

        try {
            await runtime.shutdown();

            expect(cleanupCalls).toEqual(['cleanup']);
        } finally {
            process.exit = originalExit;
        }
    });
});
