import { EventEmitter } from 'node:events';
import { expect, test } from 'bun:test';
import * as constants from '../../src/core/constants';
import { logger } from '../../src/core/logging';
import { EventBus } from '../../src/core/EventBus';
import { AppRuntime } from '../../src/runtime/AppRuntime';
import { GracefulExitService } from '../../src/services/GracefulExitService';
import { CommandCooldownService } from '../../src/services/CommandCooldownService';
import { UserTrackingService } from '../../src/services/UserTrackingService';
import { VFXCommandService } from '../../src/services/VFXCommandService';
import { InnertubeService } from '../../src/services/innertube-service';
import { OBSConnectionManager } from '../../src/obs/connection';
import { createOBSEventService } from '../../src/obs/obs-event-service';
import { createOBSSourcesManager } from '../../src/obs/sources';
import { createOBSGoalsManager } from '../../src/obs/goals';
import { DisplayQueue } from '../../src/obs/display-queue';
import { NotificationManager } from '../../src/notifications/NotificationManager';
import { ViewerCountObserver } from '../../src/observers/viewer-count-observer';
import { createConfigFixture } from '../helpers/config-fixture';
import { noOpLogger } from '../helpers/mock-factories';
import { installTimerTracking, restoreTimerTracking, useFakeTimers, useRealTimers } from '../helpers/bun-timers';
import { createHeldTikTokLifecycle } from '../fixtures/platform-lifecycle-held-tiktok';

const drain = async () => { for (let i = 0; i < 200; i++) await Promise.resolve(); };

test('real chat threshold retires held platform acquisition before the graceful force deadline', async () => {
    useFakeTimers();
    const timers = installTimerTracking().activeTimers;
    const initialTimers = new Set(timers);
    const completed: boolean[] = [];
    const steps: string[] = [];
    const fixture = createHeldTikTokLifecycle();
    class ExternalOBS extends EventEmitter {
        connections = 0;
        closes = 0;
        connect() { this.connections++; return new Promise<Record<string, unknown>>(() => {}); }
        async disconnect() { this.closes++; steps.push('OBS closed'); }
        async call() { throw new Error('Synthetic OBS request was not expected'); }
    }
    const transport = new ExternalOBS();
    const obs = new OBSConnectionManager({ obs: transport,
        config: { enabled: true, address: 'ws://synthetic.invalid', password: 'synthetic-password', connectionTimeoutMs: 45000 } });
    const pendingOBS = obs.connect().then(() => 'ready', error => error.message as string);
    const config = createConfigFixture({ general: { viewerCountPollingIntervalMs: 1000, filterOldMessages: false },
        obs: { enabled: false }, youtube: { enabled: false }, twitch: { enabled: false },
        gui: { enableDock: false, enableOverlay: false }, goals: { enabled: false } });
    const bus = new EventBus();
    // Narrow consumer payload interfaces onto the real bus's unknown boundary.
    const consumerBus = {
        emit: bus.emit.bind(bus),
        subscribe<T>(event: string, handler: (payload: T) => unknown) {
            return bus.subscribe(event, payload => handler(payload as T));
        }
    };
    const sources = createOBSSourcesManager(obs, { logger: noOpLogger });
    const goals = createOBSGoalsManager(obs, { config, logger, sourcesManager: sources });
    const queue = new DisplayQueue({ call: obs.call.bind(obs) }, { ...config, autoProcess: false }, constants, bus,
        { sourcesManager: sources, goalsManager: goals,
            fetch: async () => { throw new Error('Synthetic media fetch was not expected'); } });
    const vfx = new VFXCommandService(config, bus);
    const tracking = new UserTrackingService();
    const notifications = new NotificationManager({ config, logger: noOpLogger, constants, eventBus: bus, displayQueue: queue });
    const cooldown = new CommandCooldownService({ config, eventBus: consumerBus, logger: noOpLogger });
    const obsEvents = createOBSEventService({ eventBus: consumerBus, obsSources: sources, logger: noOpLogger,
        obsConnection: {
            connect: async () => { await obs.connect(); }, disconnect: obs.disconnect.bind(obs),
            isReady: obs.isReady.bind(obs), isConnected: obs.isConnected.bind(obs), call: obs.call.bind(obs),
            addEventListener: obs.addEventListener.bind(obs), removeEventListener: obs.removeEventListener.bind(obs)
        } });
    let metadataEntered!: () => void;
    const metadataStarted = new Promise<void>(resolve => { metadataEntered = resolve; });
    let metadataSignal: AbortSignal | null | undefined;
    let metadataRetired = false;
    const innertube = new InnertubeService({
        createWithTimeout: async () => { throw new Error('Expected synthetic SDK configuration seam'); },
        createWithConfig: async options => {
            const ownedFetch = options?.fetch as typeof globalThis.fetch;
            return { getInfo: async (_videoId: string) => ownedFetch('https://synthetic.example.test/metadata') };
        }
    }, { logger: noOpLogger, fetch: async (_input, init) => {
        metadataSignal = init?.signal;
        metadataEntered();
        await new Promise<void>(resolve => metadataSignal!.addEventListener('abort', () => resolve(), { once: true }));
        metadataRetired = true;
        steps.push('Innertube retired');
        throw new Error('Synthetic metadata operation cancelled');
    } });
    const dependencies = { onShutdownComplete: () => { completed.push(true); }, logging: noOpLogger, eventBus: bus, displayQueue: queue,
        notificationManager: notifications, vfxCommandService: vfx, userTrackingService: tracking,
        commandCooldownService: cooldown, platformLifecycleService: fixture.lifecycle,
        obsEventService: obsEvents, innertubeService: innertube,
        obs: { connectionManager: obs, sourcesManager: sources, goalsManager: goals } };
    // Runtime's broad record-based DI types differ from concrete owners' narrow
    // method inputs. Keep real instances and their identity across that seam.
    const runtime = new AppRuntime(config, dependencies as unknown as ConstructorParameters<typeof AppRuntime>[1]);
    const graceful = new GracefulExitService(runtime, 1);
    // Use the same public dependency/property seams as runtime startup. Owners
    // are acquired below without starting other platforms or the full app.
    runtime.dependencies.gracefulExitService = graceful;
    runtime.gracefulExitService = graceful;
    class CleanupObserver extends ViewerCountObserver {
        override getObserverId() { return 'synthetic-retirement-observer'; }
        override async onViewerCountUpdate() {}
        override async onStreamStatusChange() {}
        override async cleanup() {
            expect(transport.closes).toBe(1);
            expect(runtime.viewerCountSystem.isPolling).toBe(false);
            steps.push('viewer cleaned');
        }
    }
    runtime.viewerCountSystem.addObserver(new CleanupObserver());
    const metadata = innertube.withMetadataOperation({}, client => client.getInfo('synthetic-video'))
        .then(() => 'ready', error => error as Error);
    let message: Promise<void> | undefined;
    try {
        await fixture.lifecycle.initializeAllPlatforms({ tiktok: fixture.Platform });
        await fixture.connecting;
        await metadataStarted;
        runtime.viewerCountSystem.startPolling();
        runtime.viewerCountSystem.startPlatformPolling('tiktok');
        expect(runtime.viewerCountSystem.isPolling).toBe(true);
        expect(runtime.viewerCountSystem.pollingHandles.tiktok).toBeUndefined();
        expect(fixture.client.isConnecting).toBe(true);
        expect(fixture.lifecycle.backgroundPlatformInits).toHaveLength(1);
        expect(graceful.getProcessedMessageCount()).toBe(0);
        let messageSettled = false;
        message = runtime.handleChatMessage('twitch', {
            userId: 'synthetic-viewer', username: 'Synthetic Viewer',
            message: 'Synthetic threshold message', timestamp: '2026-01-01T00:00:00.000Z'
        }).then(() => { messageSettled = true; });
        await drain();
        // All retirement must finish through microtasks, before any timer advancement.
        expect(fixture.connector.signal?.aborted).toBe(true);
        expect(messageSettled).toBe(true);
        await message;
        expect(graceful.getProcessedMessageCount()).toBe(1);
        expect(graceful.isShuttingDown).toBe(true);
        expect(fixture.counters).toEqual({ initialized: 1, cleanups: 1, retries: 0 });
        expect(fixture.connector.terminated).toBe(1);
        expect(fixture.connector.disconnects).toBe(1);
        expect(fixture.client.isConnecting).toBe(false);
        expect(fixture.client.isConnected).toBe(false);
        expect(fixture.lifecycle.getStatus().registeredPlatforms).toEqual([]);
        expect(fixture.lifecycle.getStatus().backgroundInitializations).toBe(0);
        expect(fixture.lifecycle.platformHealth.tiktok?.state).toBe('disconnected');
        expect(await pendingOBS).toBe('OBS connection cancelled');
        expect(transport.connections).toBe(1);
        expect(obsEvents.unsubscribeFns).toEqual([]);
        expect(obsEvents.connectionEventHandlers).toEqual([]);
        expect(runtime.viewerCountSystem.isPolling).toBe(false);
        expect(runtime.viewerCountSystem.pollingHandles).toEqual({});
        expect(metadataSignal?.aborted).toBe(true);
        expect(metadataRetired).toBe(true);
        expect(await metadata).toBeInstanceOf(Error);
        expect(() => innertube.withMetadataOperation({}, async () => true)).toThrow('disposed');
        expect(steps).toEqual(['OBS closed', 'viewer cleaned', 'Innertube retired']);
        expect(cooldown.cleanupInterval).toBeNull();
        expect(completed).toEqual([true]);
        await runtime.shutdown();
        await graceful.triggerExit();
        expect(fixture.counters.cleanups).toBe(1);
        expect(transport.closes).toBe(1);
        expect(completed).toEqual([true]);
        expect([...timers].filter(timer => !initialTimers.has(timer))).toEqual([]);
    } finally {
        // Also release owners if an assertion rejects before threshold entry.
        if (fixture.client.isConnecting) await fixture.platform.cleanup();
        await runtime.shutdown();
        await message;
        await innertube.dispose();
        await metadata;
        obs.dispose();
        await pendingOBS;
        restoreTimerTracking();
        useRealTimers();
    }
});
