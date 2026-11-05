import { EventEmitter } from 'node:events';
import { createEventBus } from '../../src/core/EventBus';
import * as constants from '../../src/core/constants';
import { UserTrackingService } from '../../src/services/UserTrackingService';
import { PlatformLifecycleService } from '../../src/services/PlatformLifecycleService';
import { CommandCooldownService } from '../../src/services/CommandCooldownService';
import { VFXCommandService } from '../../src/services/VFXCommandService';
import { CommandParser } from '../../src/chat/commands';
import NotificationManager from '../../src/notifications/NotificationManager';
import { DisplayQueue } from '../../src/obs/display-queue';
import { createOBSSourcesManager } from '../../src/obs/sources';
import { createOBSGoalsManager } from '../../src/obs/goals';
import { OBSEffectsManager } from '../../src/obs/effects';
import { createOBSEventService } from '../../src/obs/obs-event-service';
import { createGracefulExitService } from '../../src/services/GracefulExitService';
import { AppRuntime } from '../../src/runtime/AppRuntime';
import { createConfigFixture } from './config-fixture';
import { noOpLogger } from './mock-factories';

type RuntimeDependencies = ConstructorParameters<typeof AppRuntime>[1];
type ConfigOverrides = Parameters<typeof createConfigFixture>[0];
type AppRuntimeTestOptions = { [K in keyof RuntimeDependencies]?: RuntimeDependencies[K] | undefined } & {
    configOverrides?: ConfigOverrides;
    logger?: RuntimeDependencies['logging'];
    overrides?: Partial<RuntimeDependencies>;
};

// Synthetic remote OBS responses only. Policy, queues, parsing, cooldowns and
// lifecycle state are production owners; no provider connections are enabled.
class SyntheticRuntimeObs extends EventEmitter {
    [key: string]: unknown;
    readonly calls: Array<{ method: string; data: Record<string, unknown> }> = [];
    failure: Error | undefined;
    connected = false;
    async connect() { this.connected = true; }
    async disconnect() { this.connected = false; }
    async ensureConnected() { await this.connect(); }
    isConnected() { return this.connected; }
    async isReady() { return this.connected; }
    addEventListener(name: string, handler: (data?: Record<string, unknown>) => void) { this.on(name, handler); }
    removeEventListener(name: string, handler: (data?: Record<string, unknown>) => void) { this.off(name, handler); }
    async call(method: string, data: Record<string, unknown> = {}) {
        this.calls.push({ method, data });
        if (this.failure) throw this.failure;
        if (method === 'GetInputSettings') return { inputSettings: { font: { face: 'Synthetic font' }, color: 123 } };
        if (method === 'GetSceneList') return { scenes: [] };
        if (method === 'GetSceneItemList') return { sceneItems: [] };
        if (method === 'TriggerMediaInputAction') this.emit('MediaInputPlaybackEnded', { inputName: data.inputName });
        if (['SetInputSettings', 'TriggerMediaInputAction'].includes(method)) return {};
        throw new Error(`Unexpected synthetic OBS request: ${method}`);
    }
}

function createAppRuntimeTestDependencies(options: AppRuntimeTestOptions = {}) {
    const { configOverrides = {}, overrides = {}, logger: loggerOption, ...supplied } = options;
    const config = createConfigFixture({
        general: { viewerCountPollingIntervalMs: 0, filterOldMessages: false },
        obs: { enabled: false, ttsChatEnabled: false, ttsNotificationsEnabled: false },
        gui: { enableDock: false, enableOverlay: false, enableOperator: false, enableNotifications: false, enableChatFeed: false },
        twitch: { enabled: false }, youtube: { enabled: false }, tiktok: { enabled: false }, streamelements: { enabled: false },
        displayQueue: { autoProcess: false, rowIntervalMs: 0 },
        ...configOverrides,
    });
    const effective = { ...Object.fromEntries(Object.entries(supplied).filter(([, value]) => value !== undefined)), ...overrides } as Partial<RuntimeDependencies>;
    const logger = effective.logging ?? loggerOption ?? noOpLogger;
    const eventBus = effective.eventBus ?? createEventBus();
    const remoteObs = new SyntheticRuntimeObs();
    const sourcesManager = createOBSSourcesManager(remoteObs, { logger });
    const goalsManager = createOBSGoalsManager(remoteObs, { config, updateTextSource: sourcesManager.updateTextSource });
    const effectsManager = new OBSEffectsManager(remoteObs, { logger, sourcesManager });
    const vfxCommandService = effective.vfxCommandService ?? new VFXCommandService(config as unknown as ConstructorParameters<typeof VFXCommandService>[0], eventBus as ConstructorParameters<typeof VFXCommandService>[1], { effectsManager });
    const displayQueue = effective.displayQueue ?? new DisplayQueue(remoteObs, { ...config.displayQueue, ...config.obs }, constants,
        eventBus, { sourcesManager, goalsManager });
    const userTrackingService = effective.userTrackingService ?? new UserTrackingService();
    const notificationManager = effective.notificationManager ?? new NotificationManager({ config, displayQueue, eventBus, vfxCommandService, userTrackingService, logger, constants } as unknown as ConstructorParameters<typeof NotificationManager>[0]);
    const obsEventService = effective.obsEventService ?? createOBSEventService({ eventBus, obsConnection: remoteObs, obsSources: sourcesManager, logger } as Parameters<typeof createOBSEventService>[0]);
    const commandCooldownService = effective.commandCooldownService ?? new CommandCooldownService({ config, logger, eventBus: eventBus as NonNullable<ConstructorParameters<typeof CommandCooldownService>[0]>['eventBus'] & {} });
    const platformLifecycleService = effective.platformLifecycleService ?? new PlatformLifecycleService({ config, logger, eventBus: eventBus as NonNullable<NonNullable<ConstructorParameters<typeof PlatformLifecycleService>[0]>['eventBus']> });
    const dependencies = {
        logging: logger, displayQueue, notificationManager, eventBus, vfxCommandService,
        userTrackingService, obsEventService, commandCooldownService, platformLifecycleService,
        commandParser: new CommandParser(config as unknown as ConstructorParameters<typeof CommandParser>[0]),
        twitchAuth: null, dependencyFactory: null,
        obs: { connectionManager: remoteObs, sourcesManager, goalsManager, effectsManager },
        onShutdownComplete: () => {},
        ...effective,
    } as RuntimeDependencies;
    return { dependencies, eventBus: dependencies.eventBus, notificationManager: dependencies.notificationManager,
        configFixture: config, runtimeConfig: config as unknown as ConstructorParameters<typeof AppRuntime>[0], remoteObs };
}

const createTestAppRuntime = (configOverrides: ConfigOverrides = {}, options: AppRuntimeTestOptions = {}) => {
    const harness = createAppRuntimeTestDependencies({ configOverrides, ...options });
    try {
        const runtime = new AppRuntime(harness.runtimeConfig, harness.dependencies);
        harness.dependencies.gracefulExitService ??= createGracefulExitService(runtime, null);
        return { ...harness, runtime };
    } catch (error) {
        // Construction has not adopted these fixture-owned resources yet.
        // Queue admission retires synchronously; no runner starts in this fixture.
        const releases = [
            () => harness.dependencies.commandCooldownService.dispose(),
            () => harness.dependencies.obsEventService.destroy?.(),
            () => harness.dependencies.obs?.effectsManager?.dispose(),
            () => { void Promise.resolve(harness.dependencies.displayQueue.stop?.()).catch(() => {}); },
        ];
        for (const release of releases) {
            try { release(); } catch { /* Preserve the construction error after attempting every release. */ }
        }
        throw error;
    }
};

export { createTestAppRuntime };
