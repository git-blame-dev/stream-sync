import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createDisplayQueue, DisplayQueue } from '../../src/obs/display-queue';
import type { createGuiTransportService } from '../../src/services/gui/gui-transport-service';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureSecrets } from '../../src/utils/secret-manager';
import { main, createProductionDependencies } from '../../src/main';
import { TwitchAuth } from '../../src/auth/TwitchAuth';
import { AppRuntime } from '../../src/runtime/AppRuntime';
import type { createOBSEventService } from '../../src/obs/obs-event-service';
import { VFXCommandService } from '../../src/services/VFXCommandService';
import { OBSEffectsManager } from '../../src/obs/effects';
import { OBSConnectionManager } from '../../src/obs/connection';
import { DependencyFactory } from '../../src/utils/dependency-factory';
import { InnertubeFactory } from '../../src/factories/innertube-factory';
import { YouTubeStreamDetectionService } from '../../src/services/youtube-stream-detection-service';
import { YouTubePlatform } from '../../src/platforms/youtube';
import { PlatformLifecycleService } from '../../src/services/PlatformLifecycleService';
import { createGracefulExitService } from '../../src/services/GracefulExitService';
import { acquireSingleInstanceGuard } from '../../src/services/SingleInstanceGuard';
import { createOperatorControlService } from '../../src/services/operator/operator-control-service';
import { createOperatorAppearanceService } from '../../src/services/operator/operator-appearance-service';
import { createFundingGoalService } from '../../src/services/funding-goal-service';
import { createUsdRateService } from '../../src/services/usd-rate-service';
import { PlatformEvents } from '../../src/interfaces/PlatformEvents';
import { createEventBus } from '../../src/core/EventBus';
import { createConfigFixture } from '../helpers/config-fixture';
import { useRealTimers } from '../helpers/bun-timers';
import { noOpLogger } from '../helpers/mock-factories';
import { captureStdout, captureStderr } from '../helpers/output-capture';

type MainOverridesArg = NonNullable<Parameters<typeof main>[0]>;
const buildMainConfig = (overrides: Parameters<typeof createConfigFixture>[0] = {}) => createConfigFixture({
  ...overrides,
  general: { envFileReadEnabled: false, envFileWriteEnabled: false, viewerCountPollingIntervalMs: 0, ...overrides.general },
  logging: { file: { enabled: false, level: 'warn', directory: '/synthetic-unused', maxBytes: 20971520, maxQueueBytes: 2097152, archiveMaxBytes: 104857600, archiveMaxAgeDays: 14 } },
  obs: { enabled: false, ttsChatEnabled: false, ttsNotificationsEnabled: false, ...overrides.obs },
  twitch: { enabled: false, ...overrides.twitch }, youtube: { enabled: false, ...overrides.youtube }, tiktok: { enabled: false, ...overrides.tiktok },
  gui: { enableDock: false, enableOverlay: false, enableOperator: false, enableNotifications: false, port: 0, ...overrides.gui },
  displayQueue: { autoProcess: false, ...overrides.displayQueue },
});
class SyntheticObsSocket extends EventEmitter {
  async connect() { this.emit('Identified'); return { obsWebSocketVersion: 'synthetic' }; }
  async disconnect() { this.emit('ConnectionClosed'); }
  async call(method: string) {
    if (method === 'GetVersion') return { obsVersion: 'synthetic' };
    if (method === 'GetInputSettings') return { inputSettings: {} };
    if (method === 'SetInputSettings') return {};
    throw new Error(`Unexpected synthetic OBS request: ${method}`);
  }
}
const cleanups: Array<() => Promise<void>> = [];
const buildOverrides = (options: { cliArgs?: MainOverridesArg['cliArgs'] } = {}) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'synthetic-main-startup-'));
  const socket = new SyntheticObsSocket();
  const obs = new OBSConnectionManager({ obs: socket, config: { enabled: false } });
  let app: AppRuntime | undefined;
  let guard: Awaited<ReturnType<typeof acquireSingleInstanceGuard>> | undefined;
  const releaseCalls: boolean[] = [];
  cleanups.push(async () => {
    try { await app?.shutdown(); }
    finally { obs.dispose(); await obs.disconnect(); await guard?.release(); await rm(dir, { recursive: true, force: true }); }
  });
  const overrides: MainOverridesArg = {
    onShutdownComplete: () => {},
    cliArgs: options.cliArgs ?? { chat: 1000 },
    getOBSConnectionManager: () => obs,
    createSingleInstanceGuard: async () => {
      guard = await acquireSingleInstanceGuard({ port: guard?.port ?? 0 });
      const release = guard.release.bind(guard);
      guard.release = async () => { releaseCalls.push(true); await release(); };
      return guard;
    },
    createOperatorControlService: options => createOperatorControlService({ ...options, filePath: path.join(dir, 'controls.json') }),
    createOperatorAppearanceService: options => createOperatorAppearanceService({ ...options, filePath: path.join(dir, 'appearance.json') }),
    createFundingGoalService: options => createFundingGoalService({ ...options, filePath: path.join(dir, 'funding.json') }),
    createUsdRateService: options => createUsdRateService({ ...options, cachePath: path.join(dir, 'rates.json'), fetch: async () => ({ ok: true, status: 200, json: async () => [{ base: 'USD', quote: 'EUR', rate: 0.9 }] }) }),
    createGracefulExitService: (runtime, ...args) => { app = runtime as AppRuntime; return createGracefulExitService(runtime, ...args); },
  };
  return { overrides, obs, dir, get instancePort() { if (!guard) throw new Error('Main did not acquire instance ownership'); return guard.port; }, get runtime() { if (!app) throw new Error('Main did not acquire runtime'); return app; }, getSingleInstanceReleaseCalls: () => releaseCalls };
};
let stdout: ReturnType<typeof captureStdout>;
let stderr: ReturnType<typeof captureStderr>;
let startupOnly: string | undefined;
let exitCode: typeof process.exitCode;
beforeEach(() => {
  stdout = captureStdout(); stderr = captureStderr();
  startupOnly = process.env.CHAT_BOT_STARTUP_ONLY; exitCode = process.exitCode;
  delete process.env.CHAT_BOT_STARTUP_ONLY;
});
afterEach(async () => {
  try { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); }
  finally {
    if (startupOnly === undefined) delete process.env.CHAT_BOT_STARTUP_ONLY; else process.env.CHAT_BOT_STARTUP_ONLY = startupOnly;
    InnertubeFactory.configure(); useRealTimers(); process.exitCode = exitCode; stdout.restore(); stderr.restore();
  }
});

describe('main startup using production owners', () => {

  it('ignores a disabled StreamElements capture root beneath a regular file', async () => {
    const h = buildOverrides();
    const blocker = path.join(h.dir, 'synthetic-regular-file');
    await writeFile(blocker, 'synthetic path blocker');
    const config = buildMainConfig();
    config.streamelements.enabled = false;
    config.streamelements.dataLoggingEnabled = true;
    config.streamelements.dataLoggingPath = path.join(blocker, 'capture');
    expect((await main({ ...h.overrides, config })).success).toBe(true);
    expect(h.runtime.isStarted).toBe(true);
    await h.runtime.shutdown();
  });

  it('configures the SDK before the actual supplied production dependency builder and preserves override arguments', async () => {
    const h = buildOverrides();
    const client = { getInfo: async () => ({ synthetic: true }) };
    let imports = 0;
    let pending: Promise<unknown> | undefined;
    const importer = async () => { imports++; return { Innertube: { create: async () => client } }; };
    const options: MainOverridesArg = { ...h.overrides, config: buildMainConfig(), innertubeImporter: importer,
      createProductionDependencies: (received, subsystem) => {
        expect(received).toBe(options);
        expect(received?.innertubeImporter).toBe(importer);
        pending = InnertubeFactory.createInstance();
        return createProductionDependencies(received, subsystem);
      },
    };
    InnertubeFactory.configure({ importer: async () => ({ Innertube: { create: async () => ({ wrong: true }) } }) });
    expect((await main(options)).success).toBe(true);
    expect(await pending).toBe(client);
    expect(imports).toBe(1);
  });

  it("honors a standalone production dependency builder importer without eagerly importing the SDK", async () => {
    let imports = 0;
    const sdk = { create: async () => ({ getInfo: async () => ({ synthetic: true }) }) };
    const dependencies = createProductionDependencies({
      innertubeImporter: async () => { imports += 1; return { Innertube: sdk }; },
    }, undefined);
    expect(imports).toBe(0);
    expect(await dependencies.lazyInnertube()).toBe(sdk);
    expect(imports).toBe(1);
  });

  it("default main dependency construction preserves an in-flight configured SDK import", async () => {
    process.env.CHAT_BOT_STARTUP_ONLY = "true";
    const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });
    let imports = 0;
    const sdk = { create: async () => ({ getInfo: async () => ({ synthetic: true }) }) };
    let release!: (value: { Innertube: typeof sdk }) => void;
    const importing = new Promise<{ Innertube: typeof sdk }>(resolve => { release = resolve; });
    const importer = () => { imports += 1; return importing; };
    let early: Promise<unknown> | undefined;
    let later: Promise<unknown> | undefined;
    const result = await main({
      ...overrides,
      config: buildMainConfig({ youtube: { enabled: false } }),
      innertubeImporter: importer,
      ensureSecrets: async options => {
        early = InnertubeFactory.getLazyInnertubeClass();
        await Promise.resolve();
        expect(imports).toBe(1);
        return ensureSecrets(options);
      },
      createGracefulExitService: (runtime, ...args) => {
        later = InnertubeFactory.getLazyInnertubeClass();
        release({ Innertube: sdk });
        return createGracefulExitService(runtime, ...args);
      },
    });
    expect(result.success).toBe(true);
    expect(await early).toBe(sdk);
    expect(await later).toBe(sdk);
    expect(await InnertubeFactory.getLazyInnertubeClass()).toBe(sdk);
    expect(imports).toBe(1);
  });

  for (const enabled of [true, false]) {
    it(`composes the default production YouTube owner only when enabled=${enabled}`, async () => {
      process.env.CHAT_BOT_STARTUP_ONLY = "true";
      const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });
      let app: AppRuntime | undefined;
      const platformAttempts: Promise<void>[] = [];
      let sdkCreations = 0;
      const result = await main({
        ...overrides,
        config: buildMainConfig({ youtube: { enabled, username: "" } }),
        innertubeImporter: async () => ({ Innertube: { create: async () => {
          sdkCreations += 1;
          return { getInfo: async () => ({}) };
        } } }) as never,
        createGracefulExitService: (runtime, ...args) => {
          app = runtime as AppRuntime;
          cleanups.push(async () => { await Promise.allSettled(platformAttempts); await app!.shutdown(); });
          expect(sdkCreations).toBe(0);
          if (enabled) {
            const owner = app.innertubeService;
            if (!owner) throw new Error("Expected the production root owner");
            const factory = new DependencyFactory();
            for (let attempt = 0; attempt < 2; attempt += 1) {
              const deps = factory.createYoutubeDependencies(
                { username: "synthetic-channel", streamDetectionMethod: "youtubei" },
                { logger: noOpLogger, config: buildMainConfig(), innertubeService: owner },
              );
              expect(deps.innertubeService).toBe(owner);
              expect(deps.viewerExtractionService.innertubeService).toBe(owner);
              expect((deps.streamDetectionService as YouTubeStreamDetectionService).client).toBe(owner);
            }
            expect((app.platformLifecycleService as PlatformLifecycleService).sharedDependencies.innertubeService).toBe(owner);
            const lifecycle = app.platformLifecycleService as PlatformLifecycleService;
            for (let attempt = 0; attempt < 2; attempt += 1) {
              platformAttempts.push(lifecycle.createPlatformInstance("youtube",
                YouTubePlatform as unknown as Parameters<PlatformLifecycleService["createPlatformInstance"]>[1],
                { ...buildMainConfig().youtube, username: "synthetic-channel", streamDetectionMethod: "youtubei" },
              ).then(async instance => {
                const platform = instance as unknown as YouTubePlatform;
                try {
                  expect(platform.viewerExtractionService).toBeDefined();
                  expect((platform.streamDetectionService as YouTubeStreamDetectionService).client).toBe(owner);
                  await owner.withMetadataOperation({}, client => client.getInfo("synthetic-video"));
                } finally { await platform.cleanup(); }
              }));
            }
          }
          return createGracefulExitService(runtime, ...args);
        },
      });
      await Promise.all(platformAttempts);
      expect(result.success).toBe(true);
      expect(sdkCreations).toBe(enabled ? 1 : 0);
      expect(!!app?.innertubeService).toBe(enabled);
      if (app?.innertubeService) {
        expect(() => app!.innertubeService!.withMetadataOperation({}, async () => true)).toThrow("disposed");
      }
    });
  }


  it('retires actual provisional auth, effects and YouTube owners after a runtime subscription failure', async () => {
    const h = buildOverrides();
    const auths: TwitchAuth[] = [];
    let effects: OBSEffectsManager | undefined;
    let youtube: ReturnType<DependencyFactory['createYoutubeInnertubeService']> | undefined;
    const failure = new Error('Synthetic runtime subscription failure');
    class RecordingAuth extends TwitchAuth {
      constructor(options: ConstructorParameters<typeof TwitchAuth>[0]) { super(options); auths.push(this); }
    }
    try {
      await expect(main({ ...h.overrides,
        createEventBus: () => {
          const bus = createEventBus();
          const subscribe = bus.subscribe.bind(bus);
          bus.subscribe = (event, handler) => {
            if (event === PlatformEvents.VFX_COMMAND_RECEIVED) throw failure;
            return subscribe(event, handler);
          };
          return bus;
        },
        config: buildMainConfig({ twitch: { enabled: true, clientId: 'synthetic-client', tokenStorePath: path.join(h.dir, 'synthetic-tokens.json') }, youtube: { enabled: true, username: '' } }),
        TwitchAuth: RecordingAuth,
        createProductionDependencies: (...args) => {
          const deps = createProductionDependencies(...args);
          effects = deps.obs.effectsManager as OBSEffectsManager;
          const method = deps.dependencyFactory.createYoutubeInnertubeService;
          if (!method) throw new Error('Production factory did not supply the YouTube owner capability');
          const acquire = method.bind(deps.dependencyFactory);
          deps.dependencyFactory.createYoutubeInnertubeService = (...options) => { youtube = acquire(...options); return youtube; };
          return deps;
        },
      })).rejects.toBe(failure);
      expect(auths).toHaveLength(1);
      await expect(auths[0]!.initialize()).rejects.toThrow('disposed');
      expect(effects).toBeInstanceOf(OBSEffectsManager);
      await expect(effects!.waitForMediaCompletion('synthetic-source')).rejects.toThrow('disposed');
      expect(youtube).toBeDefined();
      expect(() => youtube!.withMetadataOperation({}, async () => true)).toThrow('disposed');
      expect(h.getSingleInstanceReleaseCalls()).toHaveLength(1);
    } finally { await Promise.all(auths.map(auth => auth.dispose())); await youtube?.dispose(); effects?.dispose(); }
  });

  it('rejects an invalid YouTube acquisition-capability DTO before executing a factory method', async () => {
    const h = buildOverrides();
    await expect(main({ ...h.overrides, config: buildMainConfig({ youtube: { enabled: true, username: '' } }), dependencyFactory: {} })).rejects.toThrow('Enabled YouTube requires dependencyFactory.createYoutubeInnertubeService');
    expect(h.getSingleInstanceReleaseCalls()).toHaveLength(1);
  });

  it("starts runtime and returns startup status", async () => {
    const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });

    const result = await main({
      ...overrides,
      config: buildMainConfig(),
    });

    expect(result).toEqual({
      success: true,
      appStarted: true,
      viewerCountActive: false,
      authValid: true,
    });
  });

  it("shuts down in startup-only mode", async () => {
    process.env.CHAT_BOT_STARTUP_ONLY = "true";
    const h = buildOverrides({ cliArgs: { chat: 1 } });
    const { overrides, getSingleInstanceReleaseCalls } = h;

    const result = await main({
      ...overrides,
      config: buildMainConfig(),
    });

    expect(result.success).toBe(true);
    expect(getSingleInstanceReleaseCalls()).toHaveLength(1);
    const successor = await acquireSingleInstanceGuard({ port: h.instancePort });
    await successor.release();
  });

  it("rejects non-function startup override dependencies", async () => {
    const { overrides } = buildOverrides({ cliArgs: { chat: 1 } });

    const invalidOverrides: Record<string, unknown> = {
        ...overrides,
        createEventBus: "not-a-function",
        config: buildMainConfig(),
      };

    await expect(main(invalidOverrides)).rejects.toThrow(
      "main override createEventBus must be a function when provided",
    );
  });

  it("rejects invalid cliArgs chat override values", async () => {
    const { overrides } = buildOverrides({});

    const invalidOverrides: Record<string, unknown> = {
      ...overrides,
      cliArgs: { chat: "invalid-chat-count" },
      config: buildMainConfig(),
    };

    await expect(main(invalidOverrides)).rejects.toThrow(
      "main override cliArgs.chat must be null or a positive integer",
    );
  });

  it("rejects message-count overrides beyond exact integer representation", async () => {
    const { overrides } = buildOverrides({ cliArgs: { chat: Number.MAX_SAFE_INTEGER + 1 } });
    await expect(main(overrides)).rejects.toThrow('safe numeric range');
  });

  it('continues with limited functionality when actual Twitch auth cannot initialize from a missing token store', async () => {
    const h = buildOverrides();
    const result = await main({ ...h.overrides, config: buildMainConfig({ twitch: {
      enabled: true, clientId: 'synthetic-client', tokenStorePath: path.join(h.dir, 'missing-tokens.json'),
    } }) });
    expect(result).toMatchObject({ success: true, authValid: false });
    const auth = h.runtime.twitchAuth;
    expect(auth).toBeInstanceOf(TwitchAuth);
    expect(auth?.isReady()).toBe(false);
    await h.runtime.shutdown();
    await expect((auth as TwitchAuth).initialize()).rejects.toThrow('disposed');
  });

  it('surfaces real secret validation failure and releases its acquired guard', async () => {
    const h = buildOverrides();
    const config = buildMainConfig();
    config.youtube.enableAPI = true;
    await expect(main({ ...h.overrides, config })).rejects.toThrow('YouTube Data API is not supported');
    expect(h.getSingleInstanceReleaseCalls()).toHaveLength(1);
    // The same actual guard can be reacquired after failed secret setup.
    expect((await main({ ...h.overrides, config: buildMainConfig() })).success).toBe(true);
  });

  it('rejects a second actual instance before secret setup and permits startup after release', async () => {
    const h = buildOverrides();
    const held = await acquireSingleInstanceGuard({ port: 0 });
    const config = buildMainConfig();
    config.youtube.enableAPI = true;
    let secretCalls = 0;
    try {
      await expect(main({ ...h.overrides, config, createSingleInstanceGuard: () => acquireSingleInstanceGuard({ port: held.port }),
        ensureSecrets: async options => { secretCalls += 1; return ensureSecrets(options); }
      })).rejects.toThrow('is occupied by Stream Sync or another application');
      expect(secretCalls).toBe(0);
      expect(h.getSingleInstanceReleaseCalls()).toHaveLength(0);
    } finally { await held.release(); }
    expect((await main({ ...h.overrides, config: buildMainConfig() })).success).toBe(true);
  });

  it('retains instance ownership through shutdown when the process remains alive', async () => {
    const h = buildOverrides();
    await main({ ...h.overrides, config: buildMainConfig() });
    await h.runtime.shutdown();
    await expect(acquireSingleInstanceGuard({ port: h.instancePort })).rejects.toMatchObject({ code: 'STREAM_SYNC_INSTANCE_UNAVAILABLE' });
    expect(h.getSingleInstanceReleaseCalls()).toHaveLength(0);
  });

  it('passes GUI and speech settings into the actual supplied display queue factory', async () => {
    const h = buildOverrides();
    const config = buildMainConfig({ gui: { showGifts: true }, obs: { ttsChatEnabled: false, ttsNotificationsEnabled: true } });
    const queues: DisplayQueue[] = [];
    const configs: Parameters<typeof createDisplayQueue>[1][] = [];
    await main({ ...h.overrides, config, createDisplayQueue: (...args) => {
      configs.push(args[1]);
      const queue = createDisplayQueue(...args); queues.push(queue); return queue;
    } });
    expect(queues).toHaveLength(1);
    expect(h.runtime.displayQueue).toBe(queues[0]!);
    expect(queues[0]).toBeInstanceOf(DisplayQueue);
    expect(configs[0]).toMatchObject({ gui: config.gui, ttsChatEnabled: false, ttsNotificationsEnabled: true });
    await h.runtime.shutdown();
    expect(() => queues[0]!.addItem({ type: 'chat', platform: 'twitch', data: { message: 'Synthetic retired row' } })).toThrow('stopped');
  });

  it('rolls back real owners after an active GUI fails validation and starts an independent healthy lifetime', async () => {
    const h = buildOverrides();
    const config = buildMainConfig({ gui: { enableOperator: true, host: '' } });
    await expect(main({ ...h.overrides, config })).rejects.toThrow('GUI transport requires non-empty host');
    expect(h.runtime.isStarted).toBe(false);
    expect(h.runtime.viewerCountSystem.observers.size).toBe(0);
    expect(h.getSingleInstanceReleaseCalls()).toHaveLength(1);
    expect((await main({ ...h.overrides, config: buildMainConfig() })).success).toBe(true);
  });

  it('preserves the real OBS subsystem identity across production dependencies and runtime startup', async () => {
    const h = buildOverrides();
    const result = await main({ ...h.overrides, config: buildMainConfig() });
    expect(result.success).toBe(true);
    expect(h.runtime.dependencies.obs?.connectionManager).toBe(h.runtime._getObsConnectionManager());
    expect(h.runtime._getObsConnectionManager().isConnected()).toBe(h.obs.isConnected());

    const manager = h.runtime.dependencies.obs?.connectionManager;
    if (!manager) throw new Error('Main did not supply an OBS connection manager');
    const effects = h.runtime.dependencies.obs?.effectsManager as OBSEffectsManager;
    expect<unknown>((h.runtime.displayQueue as DisplayQueue).obsManager).toBe(manager);
    expect<unknown>((h.runtime.obsEventService as unknown as ReturnType<typeof createOBSEventService>).obsConnection).toBe(manager);
    expect<unknown>(effects.obsManager).toBe(manager);
    expect((h.runtime.vfxCommandService as unknown as VFXCommandService)._effectsManager).toBe(effects);
    await h.runtime.shutdown();
    expect(h.runtime.isStarted).toBe(false);
  });

  it('serves the real operator transport and releases its listener on shutdown', async () => {
    const h = buildOverrides();
    await main({ ...h.overrides, config: buildMainConfig({ general: { giftsEnabled: false }, gui: { enableOperator: true, host: '127.0.0.1', port: 0 } }) });
    const transport = h.runtime.guiTransportService as ReturnType<typeof createGuiTransportService>;
    expect(transport.getAddress()).not.toBeNull();
    expect(h.runtime.dependencies.operatorControls?.isEnabled('giftsEnabled')).toBe(false);
    expect(await h.runtime.prepareFarewellNotification('twitch', 'synthetic-viewer', { command: '!bye', userId: 'synthetic-user', timestamp: '2024-01-01T00:00:00.000Z' })).toMatchObject({ success: true });
    await h.runtime.shutdown();
    expect(transport.getAddress()).toBeNull();
    expect(h.runtime.isStarted).toBe(false);
  });
});
