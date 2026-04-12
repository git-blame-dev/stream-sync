const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { useFakeTimers, runOnlyPendingTimers, useRealTimers } = require('../../helpers/bun-timers');
const { createConfigFixture } = require('../../helpers/config-fixture');
const { noOpLogger, createMockDisplayQueue, createMockNotificationManager } = require('../../helpers/mock-factories');
const testClock = require('../../helpers/test-clock');
const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');
const { DEFAULT_AVATAR_URL } = require('../../../src/constants/avatar');

const createDeps = (overrides = {}) => ({
    logging: overrides.logging || noOpLogger,
    displayQueue: overrides.displayQueue || createMockDisplayQueue(),
    notificationManager: overrides.notificationManager !== undefined
        ? overrides.notificationManager
        : createMockNotificationManager(),
    eventBus: overrides.eventBus !== undefined
        ? overrides.eventBus
        : { subscribe: createMockFn(), emit: createMockFn(), unsubscribe: createMockFn() },
    vfxCommandService: overrides.vfxCommandService || {
        executeCommand: createMockFn(),
        executeCommandForKey: createMockFn(),
        getVFXConfig: createMockFn()
    },
    userTrackingService: overrides.userTrackingService || { isFirstMessage: createMockFn() },
    obsEventService: overrides.obsEventService || { disconnect: createMockFn().mockResolvedValue() },
    sceneManagementService: overrides.sceneManagementService || {},
    guiTransportService: overrides.guiTransportService,
    commandCooldownService: overrides.commandCooldownService || {
        checkUserCooldown: createMockFn().mockReturnValue({ allowed: true }),
        updateUserCooldown: createMockFn(),
        getStatus: createMockFn().mockReturnValue({ commands: {} })
    },
    platformLifecycleService: overrides.platformLifecycleService || {
        getAllPlatforms: createMockFn().mockReturnValue({}),
        getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
        recordPlatformConnection: createMockFn(),
        initializeAllPlatforms: createMockFn().mockResolvedValue(),
        disconnectAll: createMockFn().mockResolvedValue()
    },
    gracefulExitService: overrides.gracefulExitService || {
        isEnabled: createMockFn().mockReturnValue(false),
        getTargetMessageCount: createMockFn().mockReturnValue(0)
    },
    commandParser: overrides.commandParser !== undefined
        ? overrides.commandParser
        : { getVFXConfig: createMockFn() }
});

const createRuntime = (depsOverrides = {}, configOverrides = {}) => {
    const { AppRuntime } = require('../../../src/runtime/AppRuntime.ts');
    const config = createConfigFixture(configOverrides);
    const deps = createDeps(depsOverrides);
    return new AppRuntime(config, deps);
};

const createRecordingNotificationManager = (calls) => ({
    handleNotification: async (...args) => {
        calls.push(args);
        return { success: true };
    }
});

describe('AppRuntime behavior', () => {
    beforeEach(() => {
        testClock.reset();
    });

    afterEach(() => {
        testClock.useRealTime();
        useRealTimers();
    });

    it('rejects construction when a required dependency is missing', () => {
        expect(() => createRuntime({ eventBus: null }))
            .toThrow('AppRuntime missing required dependencies');
    });

    it('rejects construction when event bus contract is invalid', () => {
        expect(() => createRuntime({
            eventBus: {
                subscribe: null,
                emit: createMockFn(),
                unsubscribe: createMockFn()
            }
        })).toThrow('AppRuntime requires eventBus.subscribe function');
    });

    it('rejects construction when platform lifecycle contract is invalid', () => {
        expect(() => createRuntime({
            platformLifecycleService: {
                getAllPlatforms: null,
                getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
                recordPlatformConnection: createMockFn(),
                initializeAllPlatforms: createMockFn().mockResolvedValue(),
                disconnectAll: createMockFn().mockResolvedValue()
            }
        })).toThrow('AppRuntime requires platformLifecycleService.getAllPlatforms function');
    });

    it('does not require a command parser dependency', () => {
        expect(() => createRuntime({ commandParser: null })).not.toThrow();
    });

    it('builds system-ready payload with services, timestamp, and statuses', () => {
        const runtime = createRuntime();
        const payload = runtime.emitSystemReady({ correlationId: 'test-ready-1' });

        expect(Array.isArray(payload.services)).toBe(true);
        expect(payload.services.length).toBeGreaterThan(0);
        expect(typeof payload.timestamp).toBe('string');
        expect(payload.platforms).toBeDefined();
        expect(payload.cooldowns).toBeDefined();
        expect(payload.correlationId).toBe('test-ready-1');
    });

    it('throws when unified notification options are missing', async () => {
        const runtime = createRuntime();
        await expect(runtime.handleUnifiedNotification('platform:follow', 'twitch', 'test-user'))
            .rejects.toThrow('handleUnifiedNotification requires options');
    });

    it('delegates unified notifications to the manager', async () => {
        const calls = [];
        const notificationManager = createRecordingNotificationManager(calls);
        const runtime = createRuntime({ notificationManager });

        await runtime.handleUnifiedNotification('platform:follow', 'twitch', 'test-user', {
            userId: 'test-user-id',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(calls.length).toBe(1);
        expect(calls[0][0]).toBe('platform:follow');
        expect(calls[0][1]).toBe('twitch');
        expect(calls[0][2].username).toBe('test-user');
    });

    it('accepts anonymous gift notifications without username', async () => {
        const calls = [];
        const notificationManager = createRecordingNotificationManager(calls);
        const runtime = createRuntime({ notificationManager });

        await runtime.handleUnifiedNotification('platform:gift', 'tiktok', '', {
            isAnonymous: true,
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(calls.length).toBe(1);
        expect(calls[0][2].platform).toBe('tiktok');
    });

    it('routes unified notification errors through runtime error handler', async () => {
        const runtime = createRuntime();
        runtime.notificationManager = null;
        const handled = [];
        runtime.errorHandler = {
            handleEventProcessingError: (...args) => handled.push(args),
            logOperationalError: createMockFn()
        };

        await runtime.handleUnifiedNotification('platform:follow', 'twitch', 'test-user', {
            userId: 'test-user-id',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(handled.length).toBe(1);
    });

    it('returns failed result when notification manager reports failure', async () => {
        const runtime = createRuntime({
            notificationManager: {
                handleNotification: createMockFn().mockResolvedValue({ success: false, error: 'Notifications disabled' })
            }
        });

        const result = await runtime.handleUnifiedNotification('farewell', 'twitch', 'test-user', {
            userId: 'test-user-id',
            command: '!bye',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(result).toEqual(expect.objectContaining({
            success: false,
            error: 'Notifications disabled'
        }));
    });

    it('returns failed result when notification manager throws', async () => {
        const runtime = createRuntime({
            notificationManager: {
                handleNotification: createMockFn().mockRejectedValue(new Error('notification manager exploded'))
            }
        });

        const result = await runtime.handleUnifiedNotification('farewell', 'twitch', 'test-user', {
            userId: 'test-user-id',
            command: '!bye',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(result).toEqual(expect.objectContaining({
            success: false,
            error: 'notification manager exploded'
        }));
    });

    it('returns failed result when notification manager returns invalid result shape', async () => {
        const runtime = createRuntime({
            notificationManager: {
                handleNotification: createMockFn().mockResolvedValue(undefined)
            }
        });

        const result = await runtime.handleUnifiedNotification('farewell', 'twitch', 'test-user', {
            userId: 'test-user-id',
            command: '!bye',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(result).toEqual(expect.objectContaining({
            success: false,
            error: 'Notification manager returned invalid result shape'
        }));
    });

    it('enforces required fields for gift notifications', async () => {
        const runtime = createRuntime();

        await expect(runtime.handleGiftNotification('twitch', 'test-user', {
            type: 'platform:gift',
            userId: 'test-user-id'
        })).rejects.toThrow('handleGiftNotification requires timestamp');
    });

    it('forwards gift notifications with VFX config', async () => {
        const calls = [];
        const notificationManager = createRecordingNotificationManager(calls);
        const runtime = createRuntime({
            notificationManager,
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue({ key: 'gifts' }) }
        });

        await runtime.handleGiftNotification('tiktok', 'test-user', {
            type: 'platform:gift',
            userId: 'test-gift-user-id',
            timestamp: '2024-01-01T00:00:00.000Z',
            giftType: 'Rose',
            giftCount: 2,
            amount: 10,
            currency: 'coins',
            id: 'test-gift-1'
        });

        expect(calls.length).toBe(1);
        expect(calls[0][0]).toBe('platform:gift');
        expect(calls[0][2].vfxConfig).toEqual({ key: 'gifts' });
        expect(Object.prototype.hasOwnProperty.call(calls[0][2], 'repeatCount')).toBe(false);
    });

    it('normalizes gift notification error payloads', async () => {
        const calls = [];
        const notificationManager = createRecordingNotificationManager(calls);
        const runtime = createRuntime({
            notificationManager,
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue({ key: 'gifts' }) }
        });

        await runtime.handleGiftNotification('twitch', 'test-user', {
            type: 'platform:gift',
            isError: true,
            giftType: '',
            giftCount: -2,
            amount: -5,
            currency: '',
            userId: 'test-user-id',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(calls.length).toBe(1);
        expect(calls[0][2].giftType).toBeUndefined();
    });

    it('validates giftpaypiggy event requirements', async () => {
        const runtime = createRuntime();

        await expect(runtime.handleGiftPaypiggyEvent('twitch', 'test-user', {
            giftCount: 2,
            userId: 'test-user-id',
            timestamp: '2024-01-01T00:00:00.000Z'
        })).rejects.toThrow('handleGiftPaypiggyEvent requires tier and giftCount');
    });

    it('routes giftpaypiggy events through unified handler', async () => {
        const calls = [];
        const notificationManager = createRecordingNotificationManager(calls);
        const runtime = createRuntime({ notificationManager });

        await runtime.handleGiftPaypiggyEvent('youtube', 'test-user', {
            giftCount: 1,
            userId: 'test-user-id',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(calls.length).toBe(1);
        expect(calls[0][0]).toBe('platform:giftpaypiggy');
    });

    it('preserves explicit avatarUrl for giftpaypiggy notifications', async () => {
        const calls = [];
        const notificationManager = createRecordingNotificationManager(calls);
        const runtime = createRuntime({ notificationManager });

        await runtime.handleGiftPaypiggyEvent('youtube', 'test-user', {
            giftCount: 1,
            userId: 'test-user-id',
            timestamp: '2024-01-01T00:00:00.000Z',
            avatarUrl: 'https://example.invalid/runtime-giftpaypiggy-avatar.png'
        });

        expect(calls.length).toBe(1);
        expect(calls[0][0]).toBe('platform:giftpaypiggy');
        expect(calls[0][2].avatarUrl).toBe('https://example.invalid/runtime-giftpaypiggy-avatar.png');
    });

    it('preserves explicit avatarUrl for paypiggy notifications', async () => {
        const calls = [];
        const notificationManager = createRecordingNotificationManager(calls);
        const runtime = createRuntime({ notificationManager });

        await runtime.handlePaypiggyNotification('twitch', 'test-user', {
            userId: 'test-user-id',
            timestamp: '2024-01-01T00:00:00.000Z',
            tier: '1000',
            months: 10,
            avatarUrl: 'https://example.invalid/runtime-paypiggy-avatar.png'
        });

        expect(calls.length).toBe(1);
        expect(calls[0][0]).toBe('platform:paypiggy');
        expect(calls[0][2].avatarUrl).toBe('https://example.invalid/runtime-paypiggy-avatar.png');
    });

    it('validates resub events require tier, months, and message', async () => {
        const runtime = createRuntime();

        await expect(runtime.handleResubEvent('twitch', 'test-user', {
            tier: '1000',
            months: 3
        })).rejects.toThrow('handleResubEvent requires tier, months, and message');
    });

    it('routes resub notifications through error handler on failure', async () => {
        const runtime = createRuntime();
        const handled = [];
        runtime.errorHandler = {
            handleEventProcessingError: (...args) => handled.push(args),
            logOperationalError: createMockFn()
        };

        await runtime.handleResubNotification('twitch', 'test-user', { tier: '1000', months: 3 });

        expect(handled.length).toBe(1);
    });

    it('validates raid inputs', async () => {
        const runtime = createRuntime();

        await expect(runtime.handleRaidNotification('twitch', 'test-raider', {}))
            .rejects.toThrow('handleRaidNotification requires viewerCount');
    });

    it('routes envelope notifications with required payload', async () => {
        const calls = [];
        const notificationManager = createRecordingNotificationManager(calls);
        const runtime = createRuntime({ notificationManager });

        await runtime.handleEnvelopeNotification('tiktok', {
            username: 'test-envelope-user',
            userId: 'test-env-user-id',
            giftType: 'Coins',
            giftCount: 1,
            amount: 5,
            currency: 'USD',
            timestamp: '2024-01-01T00:00:00.000Z',
            id: 'test-env-1'
        });

        expect(calls.length).toBe(1);
        expect(calls[0][0]).toBe('platform:envelope');
        expect(calls[0][2].avatarUrl).toBe(DEFAULT_AVATAR_URL);
        expect(Object.prototype.hasOwnProperty.call(calls[0][2], 'repeatCount')).toBe(false);
    });

    it('preserves explicit avatarUrl for envelope notifications', async () => {
        const calls = [];
        const notificationManager = createRecordingNotificationManager(calls);
        const runtime = createRuntime({ notificationManager });

        await runtime.handleEnvelopeNotification('tiktok', {
            username: 'test-envelope-user',
            userId: 'test-env-user-id',
            giftType: 'Coins',
            giftCount: 1,
            amount: 5,
            currency: 'USD',
            timestamp: '2024-01-01T00:00:00.000Z',
            id: 'test-env-2',
            avatarUrl: 'https://example.invalid/runtime-envelope-avatar.png'
        });

        expect(calls.length).toBe(1);
        expect(calls[0][0]).toBe('platform:envelope');
        expect(calls[0][2].avatarUrl).toBe('https://example.invalid/runtime-envelope-avatar.png');
    });

    it('routes envelope errors through runtime handler', async () => {
        const runtime = createRuntime();
        const handled = [];
        runtime.errorHandler = {
            handleEventProcessingError: (...args) => handled.push(args),
            logOperationalError: createMockFn()
        };

        await runtime.handleEnvelopeNotification('tiktok', null);

        expect(handled.length).toBe(1);
    });

    it('triggers youtube reconnect on stream detection', async () => {
        const runtime = createRuntime();
        const called = [];
        runtime.youtube = { initialize: async (...args) => called.push(args) };

        await runtime.handleStreamDetected('youtube', {
            eventType: 'stream-detected',
            newStreamIds: ['test-stream-1']
        });

        expect(called.length).toBe(1);
    });

    it('ignores non-stream-detected events', async () => {
        const runtime = createRuntime();
        const called = [];
        runtime.youtube = { initialize: async (...args) => called.push(args) };

        await runtime.handleStreamDetected('youtube', {
            eventType: 'ignored-event',
            newStreamIds: ['test-stream-1']
        });

        expect(called.length).toBe(0);
    });

    it('throws when user tracking service is unavailable', () => {
        const runtime = createRuntime();
        runtime.userTrackingService = null;

        expect(() => runtime.isFirstMessage('test-user-1')).toThrow('UserTrackingService not available for first message check');
    });

    it('updates viewer count and swallows observer errors', async () => {
        const runtime = createRuntime();
        runtime.viewerCountSystem = {
            counts: { twitch: 1 },
            notifyObservers: () => Promise.reject(new Error('observer failed'))
        };

        runtime.updateViewerCount('twitch', 5);
        await Promise.resolve();

        expect(runtime.viewerCountSystem.counts.twitch).toBe(5);
    });

    it('routes chat messages through the chat router', async () => {
        const runtime = createRuntime();
        const calls = [];
        runtime.chatNotificationRouter = {
            handleChatMessage: async (...args) => calls.push(args)
        };

        await runtime.handleChatMessage('twitch', { username: 'test-user', message: 'Hello' });

        expect(calls.length).toBe(1);
        expect(calls[0][0]).toBe('twitch');
    });

    it('handles VFX command events from the event bus', async () => {
        let handler;
        const eventBus = {
            subscribe: createMockFn((eventName, callback) => {
                if (eventName === PlatformEvents.VFX_COMMAND_RECEIVED) {
                    handler = callback;
                }
                return createMockFn();
            })
        };
        const vfxCalls = [];
        createRuntime({
            eventBus,
            vfxCommandService: {
                executeCommand: async (...args) => vfxCalls.push(args),
                executeCommandForKey: async (...args) => vfxCalls.push(args)
            }
        });

        await handler({
            command: '!spark',
            username: 'test-user',
            platform: 'twitch',
            userId: 'test-user-1',
            context: { skipCooldown: true, correlationId: 'test-corr-1' }
        });

        await handler({
            commandKey: 'spark',
            username: 'test-user',
            platform: 'twitch',
            userId: 'test-user-1',
            context: { skipCooldown: true, correlationId: 'test-corr-2' }
        });

        expect(vfxCalls.length).toBe(2);
    });

    it('captures handler errors for invalid VFX events', async () => {
        let handler;
        const eventBus = {
            subscribe: createMockFn((eventName, callback) => {
                if (eventName === PlatformEvents.VFX_COMMAND_RECEIVED) {
                    handler = callback;
                }
                return createMockFn();
            })
        };
        const runtime = createRuntime({ eventBus });
        const handled = [];
        runtime.errorHandler = {
            handleEventProcessingError: (...args) => handled.push(args),
            logOperationalError: createMockFn()
        };

        await handler({
            command: '!spark',
            username: 'test-user',
            platform: 'twitch',
            userId: 'test-user-1'
        });

        expect(handled.length).toBe(1);
    });

    it('records platform connections via lifecycle service', () => {
        const calls = [];
        const runtime = createRuntime({
            platformLifecycleService: {
                getAllPlatforms: createMockFn().mockReturnValue({}),
                getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
                recordPlatformConnection: (platform) => calls.push(platform),
                disconnectAll: createMockFn().mockResolvedValue()
            }
        });
        runtime.recordPlatformConnection('twitch');

        expect(calls).toEqual(['twitch']);
    });

    it('handles early viewer count initialization failures', async () => {
        const runtime = createRuntime();
        runtime.viewerCountSystem = {
            initialize: createMockFn().mockRejectedValue(new Error('init failed')),
            startPolling: createMockFn()
        };
        const handled = [];
        runtime.errorHandler = {
            handleEventProcessingError: (...args) => handled.push(args),
            logOperationalError: createMockFn()
        };

        await runtime.startViewerCountSystemEarly();

        expect(handled.length).toBe(1);
    });

    it('uses the OBS connection manager when event service is unavailable', async () => {
        const notificationManager = {
            stopSuppressionCleanup: createMockFn()
        };
        const runtime = createRuntime({ notificationManager });
        let disconnectCalls = 0;
        runtime.obsEventService = null;
        runtime.dependencies.obs = {
            connectionManager: { isConnected: () => true, disconnect: async () => { disconnectCalls += 1; } }
        };
        runtime.viewerCountSystem = { stopPolling: createMockFn() };
        runtime.viewerCountStatusCleanup = createMockFn();
        const originalExit = process.exit;
        process.exit = createMockFn();

        try {
            await runtime.shutdown();

            expect(disconnectCalls).toBe(1);
        } finally {
            process.exit = originalExit;
        }
    });

    it('shuts down services and calls cleanup hooks', async () => {
        const calls = { disconnectAll: 0, cleanup: 0 };
        const runtime = createRuntime({
            notificationManager: {},
            platformLifecycleService: {
                getAllPlatforms: createMockFn().mockReturnValue({}),
                getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
                recordPlatformConnection: createMockFn(),
                disconnectAll: async () => { calls.disconnectAll += 1; }
            }
        });
        runtime.viewerCountSystem = { stopPolling: createMockFn() };
        runtime.viewerCountStatusCleanup = () => { calls.cleanup += 1; };
        const originalExit = process.exit;
        process.exit = createMockFn();

        try {
            await runtime.shutdown();

            expect(calls.disconnectAll).toBe(1);
            expect(calls.cleanup).toBe(1);
        } finally {
            process.exit = originalExit;
        }
    });

    it('calls disconnect and destroy on OBS-facing services during shutdown', async () => {
        const obsEventService = {
            disconnect: createMockFn().mockResolvedValue(),
            destroy: createMockFn()
        };
        const sceneManagementService = {
            destroy: createMockFn()
        };
        const runtime = createRuntime({ obsEventService, sceneManagementService });
        runtime.viewerCountSystem = { stopPolling: createMockFn(), cleanup: createMockFn().mockResolvedValue() };
        runtime.viewerCountStatusCleanup = createMockFn();
        const originalExit = process.exit;
        process.exit = createMockFn();

        try {
            await runtime.shutdown();
            expect(obsEventService.disconnect.mock.calls.length).toBe(1);
            expect(obsEventService.destroy.mock.calls.length).toBe(1);
            expect(sceneManagementService.destroy.mock.calls.length).toBe(1);
        } finally {
            process.exit = originalExit;
        }
    });

    it('unsubscribes VFX command listener during shutdown', async () => {
        const unsubscribeByEvent = new Map();
        const eventBus = {
            subscribe: createMockFn((eventName) => {
                const unsubscribe = createMockFn();
                unsubscribeByEvent.set(eventName, unsubscribe);
                return unsubscribe;
            })
        };
        const runtime = createRuntime({ eventBus });
        runtime.viewerCountSystem = { stopPolling: createMockFn(), cleanup: createMockFn().mockResolvedValue() };
        runtime.viewerCountStatusCleanup = createMockFn();
        const originalExit = process.exit;
        process.exit = createMockFn();

        try {
            await runtime.shutdown();

            const vfxUnsubscribe = unsubscribeByEvent.get(PlatformEvents.VFX_COMMAND_RECEIVED);
            expect(typeof vfxUnsubscribe).toBe('function');
            expect(vfxUnsubscribe.mock.calls.length).toBe(1);
        } finally {
            process.exit = originalExit;
        }
    });

    it('cleans up viewer count observers on shutdown when cleanup is available', async () => {
        const runtime = createRuntime();
        runtime.viewerCountSystem = {
            stopPolling: createMockFn(),
            cleanup: createMockFn().mockResolvedValue()
        };
        runtime.viewerCountStatusCleanup = createMockFn();
        const originalExit = process.exit;
        process.exit = createMockFn();

        try {
            await runtime.shutdown();
            expect(runtime.viewerCountSystem.cleanup.mock.calls.length).toBe(1);
        } finally {
            process.exit = originalExit;
        }
    });

    it('continues shutdown cleanup after platform disconnect failures', async () => {
        const obsEventService = {
            disconnect: createMockFn().mockResolvedValue(),
            destroy: createMockFn()
        };
        const runtime = createRuntime({
            obsEventService,
            platformLifecycleService: {
                getAllPlatforms: createMockFn().mockReturnValue({}),
                getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
                recordPlatformConnection: createMockFn(),
                initializeAllPlatforms: createMockFn().mockResolvedValue(),
                disconnectAll: createMockFn().mockRejectedValue(new Error('disconnect failed'))
            }
        });
        runtime.viewerCountSystem = { stopPolling: createMockFn(), cleanup: createMockFn().mockResolvedValue() };
        runtime.viewerCountStatusCleanup = createMockFn();
        const originalExit = process.exit;
        process.exit = createMockFn();

        try {
            await runtime.shutdown();
            expect(obsEventService.disconnect.mock.calls.length).toBe(1);
        } finally {
            process.exit = originalExit;
        }
    });

    it('emits system shutdown and forces exit on timeout', () => {
        const runtime = createRuntime();
        const exitCalls = [];
        const logged = [];
        const originalExit = process.exit;
        process.exit = (code) => exitCalls.push(code);
        runtime.errorHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: (...args) => logged.push(args)
        };
        useFakeTimers();

        try {
            runtime.emitSystemShutdown({ reason: 'test' });
            runOnlyPendingTimers();

            expect(exitCalls.length).toBe(2);
            expect(logged.length).toBe(1);
        } finally {
            process.exit = originalExit;
        }
    });

    it('starts runtime with viewer count wiring and readiness', async () => {
        const runtime = createRuntime();
        const goalsCalls = [];
        runtime.dependencies.obs = {
            goalsManager: { initializeGoalDisplay: async () => goalsCalls.push('init') },
            connectionManager: { isConnected: () => false }
        };
        const viewerCountCalls = { add: 0, init: 0, start: 0 };
        runtime.viewerCountSystem = {
            addObserver: () => { viewerCountCalls.add += 1; },
            initialize: async () => { viewerCountCalls.init += 1; },
            startPolling: async () => { viewerCountCalls.start += 1; }
        };

        await runtime.start();

        expect(viewerCountCalls).toEqual({ add: 1, init: 1, start: 1 });
        expect(goalsCalls).toEqual(['init']);
    });

    it('rolls back initialized services when startup fails after platform initialization', async () => {
        const disconnectAll = createMockFn().mockResolvedValue();
        const runtime = createRuntime({
            platformLifecycleService: {
                getAllPlatforms: createMockFn().mockReturnValue({}),
                getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
                recordPlatformConnection: createMockFn(),
                initializeAllPlatforms: createMockFn().mockResolvedValue(),
                disconnectAll
            }
        });
        runtime.dependencies.obs = {
            goalsManager: { initializeGoalDisplay: async () => {} },
            connectionManager: { isConnected: () => false }
        };
        runtime.viewerCountSystem = {
            addObserver: createMockFn(),
            initialize: createMockFn().mockRejectedValue(new Error('viewer count init failed')),
            startPolling: createMockFn().mockResolvedValue()
        };

        await expect(runtime.start()).rejects.toThrow('viewer count init failed');
        expect(disconnectAll.mock.calls.length).toBe(1);
    });

    it('rolls back gui transport when startup fails', async () => {
        const eventBus = {
            subscribe: createMockFn(() => createMockFn())
        };
        const guiTransportService = {
            start: createMockFn().mockResolvedValue(),
            stop: createMockFn().mockResolvedValue(),
            isActive: createMockFn().mockReturnValue(true)
        };
        const runtime = createRuntime(
            { eventBus, guiTransportService },
            { gui: { enableDock: true, enableOverlay: false } }
        );
        runtime.dependencies.obs = {
            goalsManager: { initializeGoalDisplay: async () => {} },
            connectionManager: { isConnected: () => false }
        };
        runtime.viewerCountSystem = {
            addObserver: createMockFn(),
            initialize: createMockFn().mockRejectedValue(new Error('viewer count init failed')),
            startPolling: createMockFn().mockResolvedValue(),
            stopPolling: createMockFn(),
            cleanup: createMockFn().mockResolvedValue()
        };

        await expect(runtime.start()).rejects.toThrow('viewer count init failed');
        expect(guiTransportService.stop.mock.calls.length).toBe(1);
    });

    it('rejects repeated start calls once runtime has already started', async () => {
        const runtime = createRuntime();
        runtime.dependencies.obs = {
            goalsManager: { initializeGoalDisplay: async () => {} },
            connectionManager: { isConnected: () => false }
        };
        runtime.viewerCountSystem = {
            addObserver: createMockFn(),
            initialize: createMockFn().mockResolvedValue(),
            startPolling: createMockFn().mockResolvedValue()
        };

        await runtime.start();
        await expect(runtime.start()).rejects.toThrow(/already started|start in progress/i);
    });

    it('fails startup when VFX command service is unavailable at startup time', async () => {
        const runtime = createRuntime();
        runtime.dependencies.obs = {
            goalsManager: { initializeGoalDisplay: async () => {} },
            connectionManager: { isConnected: () => false }
        };
        runtime.viewerCountSystem = {
            addObserver: createMockFn(),
            initialize: createMockFn().mockResolvedValue(),
            startPolling: createMockFn().mockResolvedValue()
        };
        runtime.vfxCommandService = null;

        await expect(runtime.start()).rejects.toThrow('VFXCommandService unavailable for runtime startup');
    });

    it('emits degraded readiness when platform initialization reports failures', async () => {
        const runtime = createRuntime({
            platformLifecycleService: {
                getAllPlatforms: createMockFn().mockReturnValue({}),
                getStatus: createMockFn().mockReturnValue({
                    platformHealth: {
                        twitch: { state: 'failed', lastError: 'auth failed' }
                    },
                    failedPlatforms: [{ name: 'twitch', lastError: 'auth failed' }]
                }),
                recordPlatformConnection: createMockFn(),
                initializeAllPlatforms: createMockFn().mockResolvedValue(),
                disconnectAll: createMockFn().mockResolvedValue()
            }
        });
        runtime.dependencies.obs = {
            goalsManager: { initializeGoalDisplay: async () => {} },
            connectionManager: { isConnected: () => false }
        };
        runtime.viewerCountSystem = {
            addObserver: createMockFn(),
            initialize: createMockFn().mockResolvedValue(),
            startPolling: createMockFn().mockResolvedValue()
        };
        let readyPayload = null;
        const emitSystemReady = runtime.emitSystemReady.bind(runtime);
        runtime.emitSystemReady = createMockFn((options) => {
            const payload = emitSystemReady(options);
            readyPayload = payload;
            return payload;
        });

        await runtime.start();
        expect(readyPayload?.degraded).toBe(true);
        expect(readyPayload?.degradationReasons).toEqual(expect.arrayContaining(['platform-initialization-failed']));
    });

    it('starts gui transport when gui is active', async () => {
        const guiTransportService = {
            start: createMockFn().mockResolvedValue(),
            stop: createMockFn().mockResolvedValue(),
            isActive: createMockFn().mockReturnValue(true)
        };
        const runtime = createRuntime(
            { guiTransportService },
            { gui: { enableDock: true, enableOverlay: false } }
        );

        runtime.dependencies.obs = {
            goalsManager: { initializeGoalDisplay: async () => {} },
            connectionManager: { isConnected: () => false }
        };
        runtime.viewerCountSystem = {
            addObserver: async () => {},
            initialize: async () => {},
            startPolling: async () => {}
        };

        await runtime.start();

        expect(guiTransportService.start.mock.calls.length).toBe(1);
    });

    it('does not start gui transport when gui is inactive', async () => {
        const guiTransportService = {
            start: createMockFn().mockResolvedValue(),
            stop: createMockFn().mockResolvedValue(),
            isActive: createMockFn().mockReturnValue(false)
        };
        const runtime = createRuntime(
            { guiTransportService },
            { gui: { enableDock: false, enableOverlay: false } }
        );

        runtime.dependencies.obs = {
            goalsManager: { initializeGoalDisplay: async () => {} },
            connectionManager: { isConnected: () => false }
        };
        runtime.viewerCountSystem = {
            addObserver: async () => {},
            initialize: async () => {},
            startPolling: async () => {}
        };

        await runtime.start();

        expect(guiTransportService.start.mock.calls.length).toBe(0);
    });

    it('stops gui transport on runtime shutdown', async () => {
        const guiTransportService = {
            start: createMockFn().mockResolvedValue(),
            stop: createMockFn().mockResolvedValue(),
            isActive: createMockFn().mockReturnValue(true)
        };
        const runtime = createRuntime({ guiTransportService });
        runtime.viewerCountSystem = { stopPolling: createMockFn() };
        runtime.viewerCountStatusCleanup = createMockFn();
        const originalExit = process.exit;
        process.exit = createMockFn();

        try {
            await runtime.shutdown();
            expect(guiTransportService.stop.mock.calls.length).toBe(1);
        } finally {
            process.exit = originalExit;
        }
    });

    it('requires options when emitting system ready', () => {
        const runtime = createRuntime();

        expect(() => runtime.emitSystemReady()).toThrow('emitSystemReady requires options');
    });

    it('rejects invalid stream detection payloads', async () => {
        const runtime = createRuntime();

        await expect(runtime.handleStreamDetected(null, {}))
            .rejects.toThrow('Stream detection event requires platform');
        await expect(runtime.handleStreamDetected('youtube', null))
            .rejects.toThrow('Stream detection event requires data');
        await expect(runtime.handleStreamDetected('youtube', { eventType: 'stream-detected', newStreamIds: 'nope' }))
            .rejects.toThrow('Stream detection event requires newStreamIds array');
    });

    it('ignores empty stream detection updates', async () => {
        const runtime = createRuntime();
        const called = [];
        runtime.youtube = { initialize: async () => called.push(true) };

        await runtime.handleStreamDetected('youtube', { eventType: 'stream-detected', newStreamIds: [] });

        expect(called.length).toBe(0);
    });

    it('keeps running when youtube reconnect fails', async () => {
        const runtime = createRuntime();
        runtime.youtube = { initialize: async () => { throw new Error('reconnect failed'); } };

        await runtime.handleStreamDetected('youtube', {
            eventType: 'stream-detected',
            newStreamIds: ['test-stream-1']
        });
    });

    it('routes follow/share/paypiggy notifications through unified handler', async () => {
        const calls = [];
        const notificationManager = createRecordingNotificationManager(calls);
        const runtime = createRuntime({ notificationManager });

        await runtime.handleFollowNotification('twitch', 'test-user', { userId: 'test-user-id', timestamp: '2024-01-01T00:00:00.000Z' });
        await runtime.handleShareNotification('twitch', 'test-user', { userId: 'test-user-id', timestamp: '2024-01-01T00:00:00.000Z' });
        await runtime.handlePaypiggyNotification('twitch', 'test-user', { userId: 'test-user-id', timestamp: '2024-01-01T00:00:00.000Z' });

        expect(calls.length).toBe(3);
        expect(calls[0][0]).toBe('platform:follow');
        expect(calls[1][0]).toBe('platform:share');
        expect(calls[2][0]).toBe('platform:paypiggy');
    });

    it('requires a command for farewell notifications', async () => {
        const runtime = createRuntime();

        await expect(runtime.handleFarewellNotification('twitch', 'test-user', {}))
            .rejects.toThrow('handleFarewellNotification requires command');
    });

    it('fails gift notifications when VFX service is missing', async () => {
        const runtime = createRuntime();
        runtime.vfxCommandService = null;

        await expect(runtime.handleGiftNotification('twitch', 'test-user', {
            type: 'platform:gift',
            isError: true,
            userId: 'test-user-id',
            timestamp: '2024-01-01T00:00:00.000Z'
        })).rejects.toThrow('VFXCommandService unavailable for gift notification');
    });

    it('continues gift notifications when VFX lookup fails', async () => {
        const calls = [];
        const notificationManager = createRecordingNotificationManager(calls);
        const runtime = createRuntime({
            notificationManager,
            vfxCommandService: { getVFXConfig: createMockFn().mockRejectedValue(new Error('vfx lookup failed')) }
        });
        const handled = [];
        runtime.errorHandler = {
            handleEventProcessingError: (...args) => handled.push(args),
            logOperationalError: createMockFn()
        };

        await runtime.handleGiftNotification('twitch', 'test-user', {
            type: 'platform:gift',
            userId: 'test-user-id',
            timestamp: '2024-01-01T00:00:00.000Z',
            giftType: 'Rose',
            giftCount: 1,
            amount: 5,
            currency: 'USD',
            id: 'test-gift-1'
        });

        expect(handled.length).toBe(1);
        expect(calls.length).toBe(1);
    });

    it('routes giftpaypiggy notifications through error handler on failure', async () => {
        const runtime = createRuntime();
        const handled = [];
        runtime.errorHandler = {
            handleEventProcessingError: (...args) => handled.push(args),
            logOperationalError: createMockFn()
        };

        await runtime.handleGiftPaypiggyNotification('twitch', 'test-user', { userId: 'test-user-id' });

        expect(handled.length).toBe(1);
    });

    it('routes chat errors through runtime handler when router is missing', async () => {
        const runtime = createRuntime();
        runtime.chatNotificationRouter = null;
        const handled = [];
        runtime.errorHandler = {
            handleEventProcessingError: (...args) => handled.push(args),
            logOperationalError: createMockFn()
        };

        await runtime.handleChatMessage('twitch', { username: 'test-user', message: 'Hello' });

        expect(handled.length).toBe(1);
    });

});
