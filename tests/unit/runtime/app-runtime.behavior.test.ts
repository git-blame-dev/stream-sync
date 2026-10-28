import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import {
  runOnlyPendingTimers,
  advanceTimersByTime,
  getTimerCount,
  useFakeTimers,
  useRealTimers,
} from "../../helpers/bun-timers";
import { createConfigFixture } from "../../helpers/config-fixture";
import {
  createMockDisplayQueue,
  createMockNotificationManager,
  noOpLogger,
} from "../../helpers/mock-factories";
import testClock from "../../helpers/test-clock";
import { DEFAULT_AVATAR_URL } from "../../../src/constants/avatar";
import { PlatformEvents } from "../../../src/interfaces/PlatformEvents";
import { EventBus } from "../../../src/core/EventBus";
import { createFundingGoalService } from "../../../src/services/funding-goal-service";
import { CommandCooldownService } from "../../../src/services/CommandCooldownService";
import { createDonationSpamDetection, createSpamDetectionConfig } from "../../../src/utils/spam-detection";
import { AppRuntime } from "../../../src/runtime/AppRuntime";
import { TwitchAuth } from "../../../src/auth/TwitchAuth";
import { TWITCH_OAUTH_SCOPES } from "../../../src/auth/twitch-oauth-scopes";
import { PlatformLifecycleService } from "../../../src/services/PlatformLifecycleService";
import { InnertubeService } from "../../../src/services/innertube-service";
import { secrets, _resetForTesting } from "../../../src/core/secrets";
import fs from "node:fs/promises";
import path from "node:path";

type RuntimeConfig = ConstructorParameters<typeof AppRuntime>[0];
type RuntimeDependencies = ConstructorParameters<typeof AppRuntime>[1];
type RuntimeUnderTest = AppRuntime;
type DependencyOverrides = Partial<Record<keyof RuntimeDependencies, unknown>> &
  Record<string, unknown>;
type ConfigOverrides = Parameters<typeof createConfigFixture>[0];
type NotificationCall = [type: string, platform: string, payload: Record<string, unknown>];
type NotificationCallLog = NotificationCall[];
type ChatCall = [platform: string, payload: Record<string, unknown>];
type VfxEventHandler = (event: Record<string, unknown>) => Promise<void> | void;

const createNotificationCalls = (): NotificationCallLog => [];

const getNotificationCall = (
  calls: NotificationCallLog,
  index = 0,
): NotificationCall => {
  const call = calls[index];
  expect(call).toBeDefined();
  if (call === undefined) {
    throw new Error(`Expected notification call at index ${index}`);
  }
  return call;
};

const getMockCall = <Args extends unknown[]>(
  calls: Args[],
  index = 0,
): Args => {
  const call = calls[index];
  expect(call).toBeDefined();
  if (call === undefined) {
    throw new Error(`Expected mock call at index ${index}`);
  }
  return call;
};

const getLastValue = <T>(values: T[]): T => {
  const value = values.at(-1);
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error("Expected recorded value");
  }
  return value;
};

const createRuntimeConfig = (configOverrides: ConfigOverrides = {}): RuntimeConfig =>
  createConfigFixture(configOverrides);

const setRuntimeProperty = <K extends PropertyKey, V>(
  runtime: RuntimeUnderTest,
  key: K,
  value: V,
) => {
  Reflect.set(runtime, key, value);
};

const setDependencyProperty = <K extends PropertyKey, V>(
  runtime: RuntimeUnderTest,
  key: K,
  value: V,
) => {
  Reflect.set(runtime.dependencies, key, value);
};

const createDeps = (overrides: DependencyOverrides = {}) => {
  const deps: RuntimeDependencies = {
    logging: noOpLogger,
    displayQueue: createMockDisplayQueue(),
    notificationManager: createMockNotificationManager(),
    eventBus: {
      subscribe: createMockFn(),
      emit: createMockFn(),
    },
    vfxCommandService: {
      executeCommand: createMockFn(),
      executeCommandForKey: createMockFn(),
      getVFXConfig: createMockFn(),
    },
    userTrackingService: {
      isFirstMessage: createMockFn(),
    },
    obsEventService: {
      disconnect: createMockFn().mockResolvedValue(),
    },
    commandCooldownService: {
      dispose: createMockFn(),
      checkUserCooldown: createMockFn().mockReturnValue(true),
      updateUserCooldown: createMockFn(),
      getStatus: createMockFn().mockReturnValue({ commands: {} }),
    },
    platformLifecycleService: {
      getAllPlatforms: createMockFn().mockReturnValue({}),
      getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
      getPlatformConnectionTime: createMockFn().mockReturnValue(null),
      initializeAllPlatforms: createMockFn().mockResolvedValue(),
      disconnectAll: createMockFn().mockResolvedValue(),
    },
    gracefulExitService: {
      isEnabled: createMockFn().mockReturnValue(false),
      getTargetMessageCount: createMockFn().mockReturnValue(0),
      incrementMessageCount: createMockFn().mockReturnValue(false),
      triggerExit: createMockFn().mockResolvedValue(),
    },
    commandParser: { getVFXConfig: createMockFn() },
  };
  return Object.assign(deps, overrides);
};

const createRuntime = (
  depsOverrides: DependencyOverrides = {},
  configOverrides: ConfigOverrides = {},
) => {
  const config = createRuntimeConfig(configOverrides);
  const deps = createDeps(depsOverrides);
  return new AppRuntime(config, deps);
};

const createRecordingNotificationManager = (calls: NotificationCallLog) => ({
  handleNotification: async (...args: NotificationCall) => {
    calls.push(args);
    return { success: true };
  },
});

describe("AppRuntime behavior", () => {
  for (const mode of ["shutdown", "rollback"] as const) {
    it(`joins real YouTube transport retirement after consumer admission closes during ${mode}`, async () => {
      const entered = Promise.withResolvers<void>();
      const aborted = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let transportFinished = false;
      const owner = new InnertubeService({
        createWithTimeout: async () => { throw new Error("Expected raw SDK creation"); },
        createWithConfig: async options => {
          const fetch = options?.fetch as typeof globalThis.fetch;
          return { getInfo: async (_videoId: string) => fetch("https://synthetic.example.test/metadata") };
        },
      }, {
        logger: noOpLogger,
        fetch: async (_input, init) => {
          entered.resolve();
          await new Promise<void>(resolve => init!.signal!.addEventListener("abort", () => {
            aborted.resolve(); resolve();
          }, { once: true }));
          await release.promise;
          transportFinished = true;
          throw new Error("Synthetic transport retired");
        },
      });
      const lifecycle = new PlatformLifecycleService({ config: {}, logger: noOpLogger });
      const runtime = createRuntime({ innertubeService: owner, platformLifecycleService: lifecycle },
        { general: { viewerCountPollingIntervalMs: 1000 } });
      runtime.viewerCountSystem.startPolling();
      expect(runtime.viewerCountSystem.isPolling).toBe(true);
      const disconnect = lifecycle.disconnectAll.bind(lifecycle);
      let disconnected = false;
      lifecycle.disconnectAll = async () => {
        expect(runtime.viewerCountSystem.isPolling).toBe(false);
        await disconnect();
        disconnected = true;
      };
      const metadata = owner.withMetadataOperation({}, client => client.getInfo("synthetic-video")).catch(error => error);
      await entered.promise;
      let finished = false;
      const retirement = (mode === "shutdown" ? runtime.shutdown() : runtime.rollbackStartup()).then(() => { finished = true; });
      await aborted.promise;
      expect(disconnected).toBe(true);
      expect(finished).toBe(false);
      expect(transportFinished).toBe(false);
      expect(() => owner.withMetadataOperation({}, async () => true)).toThrow("disposed");
      release.resolve();
      await retirement;
      await metadata;
      expect(transportFinished).toBe(true);
      await runtime.shutdown();
      await runtime.rollbackStartup();
    });
  }

  it("closes monitor admission synchronously and joins retirement on partial startup failure", async () => {
    const retirement = Promise.withResolvers<void>();
    let stopped = false;
    let started = false;
    const auth = {
      isReady: () => true,
      startValidationMonitoring: () => { started = true; },
      stopValidationMonitoring: () => { stopped = true; return retirement.promise; },
    };
    const runtime = createRuntime({ twitchAuth: auth,
      guiTransportService: { start: async () => { throw new Error("test-startup-failure"); }, stop: () => {} },
      platformLifecycleService: { ...createDeps().platformLifecycleService, getPlatform: () => undefined, markPlatformFailure: async () => {} },
    }, { twitch: { enabled: true }, gui: { enableDock: true } });
    expect(started).toBe(false);
    let completed = false;
    const outcome = runtime.start().catch(error => { completed = true; return error; });
    for (let index = 0; index < 20; index++) await Promise.resolve();
    expect(started).toBe(true);
    expect(stopped).toBe(true);
    expect(completed).toBe(false);
    retirement.resolve();
    expect(await outcome).toBeInstanceOf(Error);
    await runtime.rollbackStartup();
  });

  it("does not start validation monitoring for disabled Twitch", async () => {
    const start = createMockFn();
    const runtime = createRuntime({ twitchAuth: { isReady: () => true, startValidationMonitoring: start, stopValidationMonitoring: async () => {} },
      guiTransportService: { start: async () => { throw new Error("test-stop-startup"); }, stop: () => {} },
    }, { twitch: { enabled: false }, gui: { enableDock: true } });
    await expect(runtime.start()).rejects.toThrow("test-stop-startup");
    expect(start).not.toHaveBeenCalled();
  });
  for (const failure of ["invalid", "outage"] as const) {
    it(`owns real Twitch monitoring and retires only Twitch on ${failure}`, async () => {
      const directory = await fs.mkdtemp("/tmp/opencode/runtime-twitch-test-");
      const tokenStorePath = path.join(directory, "test-tokens.json");
      await fs.writeFile(tokenStorePath, JSON.stringify({ twitch: { accessToken: "test-access", refreshToken: "test-refresh" } }));
      _resetForTesting();
      secrets.twitch.clientSecret = "test-secret";
      const get = createMockFn<unknown[], Promise<{ data: unknown }>>().mockResolvedValue({ data: {
        user_id: "test-user-id", login: "test-user", client_id: "test-client", scopes: [...TWITCH_OAUTH_SCOPES]
      } });
      const oauthFlow = createMockFn<[], Promise<null>>();
      const auth = new TwitchAuth({ tokenStorePath, clientId: "test-client", expectedUsername: "test-user", logger: noOpLogger,
        httpClient: { get, post: createMockFn() }, oauthFlow, monitoringNow: testClock.now });
      const cleanup = createMockFn<[], Promise<void>>().mockResolvedValue();
      const otherCleanup = createMockFn<[], Promise<void>>().mockResolvedValue();
      const lifecycle = new PlatformLifecycleService({ logger: noOpLogger, sharedDependencies: { twitchAuth: auth },
        config: { twitch: { enabled: true }, youtube: { enabled: true, username: "test-channel" } } });
      const admission = Promise.withResolvers<void>();
      const runtime = createRuntime({ twitchAuth: auth, platformLifecycleService: lifecycle,
        guiTransportService: { start: () => admission.promise, stop: () => {} } }, { twitch: { enabled: true }, gui: { enableDock: true } });
      try {
        await auth.initialize();
        await lifecycle.initializeAllPlatforms({
          twitch: class {
            initialize = async () => {};
            cleanup = cleanup;
            on = () => {};
          },
          youtube: class {
            initialize = async () => {};
            cleanup = otherCleanup;
            on = () => {};
          },
        });
        expect(lifecycle.getStatus().initializedPlatforms).toContain("twitch");
        useFakeTimers();
        const starting = runtime.start();
        const startupOutcome = starting.catch(error => error);
        get.mockRejectedValue(failure === "invalid" ? { response: { status: 401 } } : new Error("test-unavailable"));
        const advance = async (ms: number) => {
          testClock.advance(ms); advanceTimersByTime(ms);
          for (let index = 0; index < 60; index++) await Promise.resolve();
        };
        await advance(3_600_000);
        if (failure === "outage") for (let index = 0; index < 10; index++) await advance(30_000);
        expect(auth.isReady()).toBe(false);
        expect(lifecycle.getPlatform("twitch")).toBeNull();
        expect(lifecycle.getStatus().platformHealth.twitch?.state).toBe("failed");
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(otherCleanup).not.toHaveBeenCalled();
        expect(oauthFlow).not.toHaveBeenCalled();
        expect(secrets.twitch.accessToken).toBe("test-access");
        expect(JSON.parse(await fs.readFile(tokenStorePath, "utf8")).twitch.refreshToken).toBe("test-refresh");
        const stopping = runtime.rollbackStartup();
        admission.resolve();
        await stopping;
        expect(await startupOutcome).toBeInstanceOf(Error);
        await runtime.rollbackStartup();
      } finally {
        admission.resolve();
        await auth.stopValidationMonitoring();
        await runtime.rollbackStartup();
        useRealTimers();
        _resetForTesting();
        await fs.rm(directory, { recursive: true, force: true });
      }
    });
  }
  for (const mode of ["shutdown", "rollback"] as const) {
    it(`joins deferred early viewer acquisition before ${mode} releases observers`, async () => {
      useFakeTimers();
      const runtime = createRuntime({}, { general: { viewerCountPollingIntervalMs: 1000 } });
      const release = Promise.withResolvers<void>();
      let initialized = 0;
      let cleaned = false;
      runtime.viewerCountSystem.addObserver({
        getObserverId: () => "test-deferred-observer",
        initialize: () => { initialized++; return release.promise; },
        cleanup: () => { cleaned = true; },
      });
      const early = runtime.startViewerCountSystemEarly();
      const repeated = runtime.startViewerCountSystemEarly();
      const teardown = mode === "shutdown" ? runtime.shutdown() : runtime.rollbackStartup();
      try {
        for (let i = 0; i < 30; i++) await Promise.resolve();
        expect(cleaned).toBe(false);
        expect(runtime.viewerCountSystem.observers.size).toBe(1);
        expect(initialized).toBe(1);
      } finally {
        release.resolve();
        await Promise.all([early, repeated, teardown]);
      }
      expect(cleaned).toBe(true);
      expect(runtime.viewerCountSystem.isPolling).toBe(false);
      expect(runtime.viewerCountSystem.memoryOptimizationInterval).toBeNull();
      expect(runtime.viewerCountSystem.pollingHandles).toEqual({});
      advanceTimersByTime(5000);
      expect(getTimerCount()).toBe(0);
    });

    it(`retires real viewer timers and all observers despite throwing diagnostics during ${mode}`, async () => {
      useFakeTimers();
      const logging = { ...noOpLogger };
      const runtime = createRuntime({ logging }, { general: { viewerCountPollingIntervalMs: 1000 } });
      const viewer = runtime.viewerCountSystem;
      const getViewerCount = createMockFn(async () => 7);
      runtime.platformLifecycleService.getAllPlatforms = () => ({ twitch: { getViewerCount } });
      const cleaned: string[] = [];
      viewer.addObserver({ getObserverId: () => "test-failing", cleanup: () => { cleaned.push("first"); throw new Error("test cleanup failure"); } });
      viewer.addObserver({ getObserverId: () => "test-rejecting", cleanup: async () => { cleaned.push("rejecting"); throw new Error("test async cleanup failure"); } });
      viewer.addObserver({ getObserverId: () => "test-following", cleanup: () => { cleaned.push("second"); } });
      await runtime.startViewerCountSystemEarly();
      await viewer.updateStreamStatus("twitch", true);
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(getViewerCount.mock.calls.length).toBeGreaterThan(0);
      expect(viewer.getViewerCount("twitch")).toBe(7);
      expect(viewer.memoryOptimizationInterval).not.toBeNull();
      expect(Object.keys(viewer.pollingHandles)).toEqual(["twitch"]);
      const failDiagnostic = () => { throw new Error("test diagnostic failure"); };
      logging.info = failDiagnostic;
      logging.debug = failDiagnostic;
      logging.error = failDiagnostic;
      logging.warn = failDiagnostic;
      try {
        const teardown = () => mode === "shutdown" ? runtime.shutdown() : runtime.rollbackStartup();
        await teardown();
        await teardown();
        expect(viewer.isPolling).toBe(false);
        expect(viewer.pollingHandles).toEqual({});
        expect(viewer.memoryOptimizationInterval).toBeNull();
        expect(viewer.observers.size).toBe(0);
        expect(cleaned).toEqual(["first", "rejecting", "second"]);
        advanceTimersByTime(5000);
        expect(getTimerCount()).toBe(0);
      } finally {
        Object.assign(logging, noOpLogger);
        await viewer.cleanup();
      }
    });
  }

  it("joins early acquisition during automatic startup rollback without joining startup itself", async () => {
    useFakeTimers();
    const runtime = createRuntime();
    const release = Promise.withResolvers<void>();
    let cleaned = false;
    runtime.viewerCountSystem.addObserver({
      getObserverId: () => "test-rollback-observer",
      initialize: () => release.promise,
      cleanup: () => { cleaned = true; },
    });
    const failure = new Error("test platform startup failure");
    runtime.initializePlatforms = async () => { throw failure; };
    const early = runtime.startViewerCountSystemEarly();
    const startup = runtime.start().catch(error => error as unknown);
    try {
      for (let i = 0; i < 30; i++) await Promise.resolve();
      expect(runtime.isShuttingDown).toBe(true);
      expect(cleaned).toBe(false);
    } finally {
      release.resolve();
      await early;
      expect(await startup).toBe(failure);
    }
    expect(cleaned).toBe(true);
    expect(runtime.viewerCountSystem.isPolling).toBe(false);
    expect(runtime.viewerCountSystem.memoryOptimizationInterval).toBeNull();
    await runtime.rollbackStartup();
    advanceTimersByTime(5000);
    expect(getTimerCount()).toBe(0);
  });

  beforeEach(() => {
    testClock.reset();
  });

  afterEach(() => {
    testClock.useRealTime();
    useRealTimers();
  });

  for (const mode of ["shutdown", "rollback"] as const) {
    it(`releases real cooldown timers and owned EventBus listeners on ${mode}`, async () => {
      useFakeTimers();
      const eventBus = new EventBus();
      const unrelated = createMockFn();
      eventBus.subscribe("platform:event", unrelated);
      const commandCooldownService = new CommandCooldownService({
        logger: { ...noOpLogger, warn: () => { throw new Error("test cleanup warning failure"); } },
        config: createConfigFixture(),
        eventBus: {
          subscribe: (name, handler) => {
            const unsubscribe = eventBus.subscribe(name, payload =>
              handler(payload as Parameters<typeof handler>[0]));
            return () => {
              unsubscribe();
              if (name === "config:changed") throw new Error("test unsubscribe failure");
            };
          },
        },
      });
      const runtime = createRuntime({ eventBus, commandCooldownService });
      runtime.emitSystemShutdown = ({ reason } = {}) => eventBus.emit(PlatformEvents.SYSTEM_SHUTDOWN, { reason, mode: "exit" });
      commandCooldownService.updateUserCooldown("test-cooldown-user");
      commandCooldownService.updateGlobalCooldown("test-command");
      const shutdownEvents: unknown[] = [];
      eventBus.subscribe(PlatformEvents.SYSTEM_SHUTDOWN, payload => shutdownEvents.push(payload));
      expect(commandCooldownService.cleanupInterval).not.toBeNull();
      expect(eventBus.listenerCount("platform:event")).toBe(3);
      try {
        if (mode === "rollback") {
          runtime.initializePlatforms = async () => { throw new Error("test startup failure"); };
          await expect(runtime.start()).rejects.toThrow("test startup failure");
        } else {
          await runtime.shutdown();
        }
        expect(commandCooldownService.cleanupInterval).toBeNull();
        expect(commandCooldownService.userLastCommand.size).toBe(0);
        expect(commandCooldownService.userHeavyLimit.size).toBe(0);
        expect(commandCooldownService.userCommandTimestamps.size).toBe(0);
        expect(commandCooldownService.globalCommandCooldowns.size).toBe(0);
        expect(eventBus.listenerCount("config:changed")).toBe(0);
        expect(eventBus.listenerCount("config:reloaded")).toBe(0);
        expect(eventBus.listenerCount(PlatformEvents.VFX_COMMAND_RECEIVED)).toBe(0);
        expect(eventBus.listenerCount(PlatformEvents.STREAM_STATUS)).toBe(0);
        expect(eventBus.listenerCount("platform:event")).toBe(1);
        eventBus.emit("platform:event", { type: "test-unrelated" });
        expect(unrelated.mock.calls.length).toBe(1);
        expect(shutdownEvents).toEqual(mode === "shutdown"
          ? [{ reason: "manual-shutdown", mode: "exit" }] : []);
        await runtime.rollbackStartup();
        await runtime.shutdown();
        commandCooldownService.dispose();
        advanceTimersByTime(60_000);
        expect(getTimerCount()).toBe(0);
        await expect(runtime.start()).rejects.toThrow(/stopped/i);
      } finally {
        commandCooldownService.dispose();
        await runtime.rollbackStartup();
      }
    });
  }

  for (const mode of ["shutdown", "rollback"] as const) {
    it(`joins real funding persistence and retires its subscription during ${mode}`, async () => {
      const eventBus = new EventBus();
      const writeEntered = Promise.withResolvers<void>();
      const releaseWrite = Promise.withResolvers<void>();
      let persisted = "";
      const fundingGoal = await createFundingGoalService({
        config: { enabled: true, id: "test-runtime-goal", label: "Test goal", targetUsd: 100 },
        monetizationValuesConfig: {
          tiktokGiftUnitUsd: 0.005,
          twitchBitUsd: 0.01,
          youtubeJewelUsd: 0.005,
          tiktokMembershipUsd: 2,
          twitchMembershipUsd: 3,
          youtubeMembershipUsd: 4,
        },
        eventBus,
        filePath: "/test-only/runtime-funding.json",
        fs: {
          readFile: async () => { throw Object.assign(new Error("test missing file"), { code: "ENOENT" }); },
          mkdir: async () => {},
          writeFile: async (_path, contents) => {
            writeEntered.resolve();
            await releaseWrite.promise;
            persisted = contents;
          },
          rename: async () => {},
          unlink: async () => {},
        },
      });
      const runtime = createRuntime({ eventBus, fundingGoal });
      const adjustment = fundingGoal.adjust(5);
      await writeEntered.promise;
      let finished = false;
      const stopping = (mode === "shutdown" ? runtime.shutdown() : runtime.rollbackStartup())
        .then(() => { finished = true; });
      try {
        expect(eventBus.listenerCount("platform:event")).toBe(0);
        await Promise.resolve();
        expect(finished).toBe(false);
        await expect(fundingGoal.adjust(1)).rejects.toThrow(/disposed/i);
      } finally {
        releaseWrite.resolve();
        await Promise.all([adjustment, stopping]);
      }
      expect(JSON.parse(persisted).currentMicros).toBe(5_000_000);
      expect(fundingGoal.snapshot.currentUsd).toBe(5);
      expect(fundingGoal.snapshot.revision).toBe(1);
    });
  }

  for (const mode of ["shutdown", "rollback"] as const) {
    for (const detectorDiagnosticFails of [false, true]) {
      it(`retires the real donation detector before awaiting ${mode} output teardown with diagnostic failure ${detectorDiagnosticFails}`, async () => {
        useFakeTimers();
        const eventBus = new EventBus();
        const aggregation = createMockFn();
        eventBus.subscribe("test:aggregation", aggregation);
        const detector = createDonationSpamDetection(createSpamDetectionConfig({
          enabled: true,
          lowValueThreshold: 10,
          detectionWindow: 10,
          maxIndividualNotifications: 1,
        }, { logger: noOpLogger }), {
          logger: { ...noOpLogger, debug: (message: string) => {
            if (detectorDiagnosticFails && message === "Periodic cleanup interval cleared") {
              throw new Error("test detector cleanup diagnostic failure");
            }
          } },
          onAggregatedDonation: payload => eventBus.emit("test:aggregation", payload),
        });
        const pendingOutput = Promise.withResolvers<void>();
        const runtime = createRuntime({
          eventBus,
          notificationManager: { ...createMockNotificationManager(), donationSpamDetector: detector },
          guiTransportService: { stop: () => pendingOutput.promise },
        });
        expect(detector.handleDonationSpam("test-donor", "test-user", 1, "test-gift", 1, "tiktok").shouldShow).toBe(true);
        expect(detector.handleDonationSpam("test-donor", "test-user", 1, "test-gift", 1, "tiktok").shouldShow).toBe(false);
        expect(detector.cleanupInterval).not.toBeNull();
        let finished = false;
        const stopping = (mode === "shutdown" ? runtime.shutdown() : runtime.rollbackStartup())
          .then(() => { finished = true; });
        try {
          expect(detector.cleanupInterval).toBeNull();
          advanceTimersByTime(30_000);
          expect(aggregation.mock.calls.length).toBe(0);
          expect(detector.getStatistics().trackedUsers).toBe(0);
          expect(finished).toBe(false);
        } finally {
          pendingOutput.resolve();
          await stopping;
          detector.destroy();
        }
      });
    }
  }

  for (const failingDiagnostic of ["Registering event handlers...", "Event handlers registered successfully", "Constructor completed"]) {
    it(`unwinds constructor subscriptions synchronously after ${failingDiagnostic}`, () => {
      useFakeTimers();
      const eventBus = new EventBus();
      const unrelated = eventBus.subscribe("platform:event", () => {});
      const listenerBaseline = eventBus.getListenerSummary();
      const timerBaseline = getTimerCount();
      const failure = new Error("test constructor diagnostic failure");
      try {
        expect(() => createRuntime({
          eventBus,
          logging: { ...noOpLogger, debug: (message: string) => {
            if (message === failingDiagnostic) throw failure;
          } },
        })).toThrow(failure);
        expect(eventBus.getListenerSummary()).toEqual(listenerBaseline);
        expect(getTimerCount()).toBe(timerBaseline);
      } finally {
        unrelated();
      }
    });
  }

  for (const failureStage of ["subscription", "cleanup"] as const) {
    it(`preserves the constructor error and unwinds other listeners after a ${failureStage} fault`, () => {
      useFakeTimers();
      const eventBus = new EventBus();
      const unrelated = eventBus.subscribe("platform:event", () => {});
      const listenerBaseline = eventBus.getListenerSummary();
      const timerBaseline = getTimerCount();
      const originalFailure = new Error("test original constructor failure");
      const subscribe = eventBus.subscribe;
      eventBus.subscribe = (name, handler, options) => {
        if (name === PlatformEvents.VFX_COMMAND_RECEIVED && failureStage === "subscription") throw originalFailure;
        const unsubscribe = subscribe(name, handler, options);
        return () => {
          const removed = unsubscribe();
          if (name === PlatformEvents.VFX_COMMAND_RECEIVED && failureStage === "cleanup") {
            throw new Error("test unsubscribe failure");
          }
          return removed;
        };
      };
      let caught: unknown;
      try {
        try {
          createRuntime({
            eventBus,
            logging: { ...noOpLogger, debug: (message: string) => {
              if (message === "Constructor completed") throw originalFailure;
            } },
          });
        } catch (error) {
          caught = error;
        }
        expect(caught).toBe(originalFailure);
        expect(eventBus.getListenerSummary()).toEqual(listenerBaseline);
        expect(getTimerCount()).toBe(timerBaseline);
      } finally {
        unrelated();
      }
    });
  }

  it("starts real viewer maintenance early without initializing platform connections", async () => {
    const runtime = createRuntime({}, { general: { viewerCountPollingIntervalMs: 0 } });
    const initializePlatforms = createMockFn(async () => {});
    runtime.platformLifecycleService.initializeAllPlatforms = initializePlatforms;
    try {
      expect(runtime.viewerCountSystem.memoryOptimizationInterval).toBeNull();
      await runtime.startViewerCountSystemEarly();
      expect(runtime.viewerCountSystem.memoryOptimizationInterval).not.toBeNull();
      expect(initializePlatforms.mock.calls.length).toBe(0);
    } finally {
      await runtime.rollbackStartup();
    }
    expect(runtime.viewerCountSystem.memoryOptimizationInterval).toBeNull();
  });

  it("settles repeated shutdown and releases every owner when shutdown info logging throws", async () => {
    const info = createMockFn(() => { throw new Error("test info logger failure"); });
    const cooldownDispose = createMockFn();
    const guiStop = createMockFn();
    const displayStop = createMockFn();
    const ttsStop = createMockFn();
    const disconnectPlatforms = createMockFn(async () => {});
    const disconnectObs = createMockFn();
    const destroyObs = createMockFn();
    const disposeFunding = createMockFn();
    const stopPolling = createMockFn();
    const cleanupViewerCount = createMockFn();
    const eventBus = new EventBus();
    const notification = createMockFn();
    eventBus.subscribe(PlatformEvents.SYSTEM_SHUTDOWN, notification);
    const runtime = createRuntime({
      logging: { ...noOpLogger, info },
      eventBus,
      commandCooldownService: { dispose: cooldownDispose },
      guiTransportService: { stop: guiStop },
      displayQueue: { ...createMockDisplayQueue(), stop: displayStop },
      neuralTtsProcessManager: { ensureStarted: async () => {}, stop: ttsStop },
      obsEventService: { disconnect: disconnectObs, destroy: destroyObs },
      fundingGoal: { dispose: disposeFunding },
    });
    runtime.platformLifecycleService.disconnectAll = disconnectPlatforms;
    setRuntimeProperty(runtime, "viewerCountSystem", {
      stopPolling,
      cleanup: cleanupViewerCount,
    });
    runtime.isStarted = true;

    const first = runtime.shutdown();
    const second = runtime.shutdown();
    expect(second).toBe(first);
    expect(runtime.isStarted).toBe(false);
    expect(eventBus.listenerCount("platform:event")).toBe(0);
    expect(eventBus.listenerCount(PlatformEvents.VFX_COMMAND_RECEIVED)).toBe(0);
    await Promise.all([first, second]);
    await runtime.shutdown();
    await expect(runtime.start()).rejects.toThrow(/stopped/i);
    for (const cleanup of [cooldownDispose, guiStop, displayStop, ttsStop,
      disconnectPlatforms, disconnectObs, destroyObs, disposeFunding,
      stopPolling, cleanupViewerCount]) {
      expect(cleanup.mock.calls.length).toBe(1);
    }
    expect(info.mock.calls.length).toBe(2);
    expect(notification.mock.calls.length).toBe(1);
    expect(runtime.isShuttingDown).toBe(false);
  });

  for (const diagnostic of ["debug", "error"] as const) {
    it(`preserves forced shutdown exit when ${diagnostic} diagnostics throw`, () => {
      const logging = { ...noOpLogger };
      const runtime = createRuntime({ logging });
      const diagnosticCall = createMockFn(() => { throw new Error("test shutdown logger failure"); });
      logging[diagnostic] = diagnosticCall;
      const originalExit = process.exit;
      const originalExitCode = process.exitCode;
      const exit = createMockFn();
      Reflect.set(process, "exit", exit);
      Reflect.set(process, "exitCode", undefined);
      useFakeTimers();
      try {
        runtime.emitSystemShutdown({ reason: "test-diagnostic-fault" });
        expect(process.exitCode).toBe(0);
        expect(exit.mock.calls.length).toBe(0);
        runOnlyPendingTimers();
        expect(exit.mock.calls.length).toBe(1);
        expect(diagnosticCall.mock.calls.length).toBe(1);
      } finally {
        Reflect.set(process, "exit", originalExit);
        Reflect.set(process, "exitCode", originalExitCode);
      }
    });
  }

  it("coalesces shutdown reentered synchronously from an owned disposer", async () => {
    const runtime = createRuntime();
    let reentered: Promise<void> | undefined;
    runtime.commandCooldownService.dispose = () => { reentered = runtime.shutdown(); };
    const notification = createMockFn();
    runtime.emitSystemShutdown = notification;
    const stopping = runtime.shutdown();
    await Promise.all([stopping, reentered]);
    expect(reentered).toBe(stopping);
    expect(notification.mock.calls.length).toBe(1);
  });

  it("retires admission before waiting and joins teardown including funding persistence", async () => {
    const pendingGui = Promise.withResolvers<void>();
    const pendingFunding = Promise.withResolvers<void>();
    const stop = createMockFn(() => pendingGui.promise);
    const dispose = createMockFn(() => pendingFunding.promise);
    const eventBus = new EventBus();
    const executeCommand = createMockFn();
    const runtime = createRuntime({
      eventBus,
      guiTransportService: { stop },
      vfxCommandService: { executeCommand },
      fundingGoal: { dispose },
    });
    runtime.isStarted = true;
    let finished = 0;
    const first = runtime.shutdown().then(() => { finished += 1; });
    const second = runtime.shutdown().then(() => { finished += 1; });
    const rollback = runtime.rollbackStartup().then(() => { finished += 1; });
    expect(runtime.isStarted).toBe(false);
    expect(runtime.isShuttingDown).toBe(true);
    expect(eventBus.listenerCount("platform:event")).toBe(0);
    expect(eventBus.listenerCount(PlatformEvents.VFX_COMMAND_RECEIVED)).toBe(0);
    await expect(runtime.start()).rejects.toThrow(/stopped/i);
    pendingGui.resolve();
    await Promise.resolve();
    expect(finished).toBe(0);
    pendingFunding.resolve();
    await Promise.all([first, second, rollback]);
    expect(stop.mock.calls.length).toBe(1);
    expect(dispose.mock.calls.length).toBe(1);
    await runtime.shutdown();
    expect(dispose.mock.calls.length).toBe(1);
  });

  for (const mode of ["shutdown", "rollback"] as const) {
    it(`continues every remaining cleanup after independent faults during ${mode}`, async () => {
      const disconnect = createMockFn(() => { throw new Error("test OBS fault"); });
      const destroy = createMockFn();
      const dispose = createMockFn(() => { throw new Error("test funding fault"); });
      const cooldownDispose = createMockFn();
      const cleanup = createMockFn();
      const runtime = createRuntime({
        obsEventService: { disconnect, destroy },
        commandCooldownService: { dispose: cooldownDispose },
        fundingGoal: { dispose },
      });
      setRuntimeProperty(runtime, "viewerCountSystem", {
        stopPolling: () => { throw new Error("test polling fault"); },
        cleanup,
      });
      const notifications = createMockFn();
      runtime.emitSystemShutdown = notifications;
      if (mode === "rollback") await runtime.rollbackStartup();
      else await runtime.shutdown();
      expect(disconnect.mock.calls.length).toBe(1);
      expect(destroy.mock.calls.length).toBe(1);
      expect(dispose.mock.calls.length).toBe(1);
      expect(cooldownDispose.mock.calls.length).toBe(1);
      expect(cleanup.mock.calls.length).toBe(1);
      expect(notifications.mock.calls.length).toBe(mode === "shutdown" ? 1 : 0);
    });
  }

  for (const mode of ["shutdown", "rollback"] as const) {
    for (const failingStage of ["retirement", "resource"] as const) {
      for (const diagnosticFault of ["logger", "formatting"] as const) {
        it(`contains teardown diagnostic failures during ${mode} ${failingStage} ${diagnosticFault}`, async () => {
          const failure = diagnosticFault === "logger"
            ? new Error("test disposer failure")
            : { toString: () => { throw new Error("test formatting failure"); } };
          const loggerError = createMockFn(() => { throw new Error("test logger failure"); });
          const cooldownDispose = createMockFn(() => {
            if (failingStage === "retirement") throw failure;
          });
          const guiStop = createMockFn(() => {
            if (failingStage === "resource") throw failure;
          });
          const displayStop = createMockFn();
          const ttsStop = createMockFn();
          const disconnectPlatforms = createMockFn(async () => {});
          const disconnectObs = createMockFn();
          const destroyObs = createMockFn();
          const disposeFunding = createMockFn();
          const stopPolling = createMockFn();
          const cleanupViewerCount = createMockFn();
          const eventBus = new EventBus();
          const notification = createMockFn();
          eventBus.subscribe(PlatformEvents.SYSTEM_SHUTDOWN, notification);
          const runtime = createRuntime({
            logging: { ...noOpLogger, error: loggerError },
            eventBus,
            commandCooldownService: { dispose: cooldownDispose },
            guiTransportService: { stop: guiStop },
            displayQueue: { ...createMockDisplayQueue(), stop: displayStop },
            neuralTtsProcessManager: { ensureStarted: async () => {}, stop: ttsStop },
            obsEventService: { disconnect: disconnectObs, destroy: destroyObs },
            fundingGoal: { dispose: disposeFunding },
          });
          runtime.platformLifecycleService.disconnectAll = disconnectPlatforms;
          setRuntimeProperty(runtime, "viewerCountSystem", {
            stopPolling,
            cleanup: cleanupViewerCount,
          });

          if (mode === "shutdown") await runtime.shutdown();
          else await runtime.rollbackStartup();
          // Repeated requests must join the completed teardown without retrying owners.
          if (mode === "shutdown") await runtime.shutdown();
          else await runtime.rollbackStartup();

          for (const cleanup of [cooldownDispose, guiStop, displayStop, ttsStop,
            disconnectPlatforms, disconnectObs, destroyObs, disposeFunding,
            stopPolling, cleanupViewerCount]) {
            expect(cleanup.mock.calls.length).toBe(1);
          }
          expect(eventBus.listenerCount("platform:event")).toBe(0);
          expect(eventBus.listenerCount(PlatformEvents.VFX_COMMAND_RECEIVED)).toBe(0);
          expect(loggerError.mock.calls.length).toBe(diagnosticFault === "logger" ? 1 : 0);
          expect(notification.mock.calls.length).toBe(mode === "shutdown" ? 1 : 0);
          expect(runtime.isShuttingDown).toBe(false);
          expect(runtime.isStarted).toBe(false);
        });
      }
    }
  }

  it("joins a pending startup acquisition before cleanup without emitting readiness", async () => {
    const acquisition = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const disconnectAll = createMockFn(async () => {});
    const owner = new InnertubeService({
      createWithTimeout: async () => ({ getInfo: async () => ({ synthetic: true }) }),
    }, { logger: noOpLogger });
    const runtime = createRuntime({ innertubeService: owner });
    runtime.initializePlatforms = async () => {
      entered.resolve();
      await acquisition.promise;
    };
    runtime.platformLifecycleService.disconnectAll = disconnectAll;
    const ready = createMockFn(runtime.emitSystemReady.bind(runtime));
    runtime.emitSystemReady = ready;
    const starting = runtime.start();
    await entered.promise;
    let stopped = false;
    const stopping = runtime.shutdown().then(() => { stopped = true; });
    const rejectedStart = starting.catch(error => error);
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(disconnectAll.mock.calls.length).toBe(0);
    expect(await owner.withMetadataOperation({}, async () => true)).toBe(true);
    acquisition.resolve();
    expect(await rejectedStart).toEqual(expect.objectContaining({ message: "AppRuntime is stopped" }));
    await stopping;
    expect(disconnectAll.mock.calls.length).toBe(1);
    expect(ready.mock.calls.length).toBe(0);
    expect(() => owner.withMetadataOperation({}, async () => true)).toThrow("disposed");
  });

  it("keeps the lifetime stopped when a readiness subscriber requests shutdown", async () => {
    const eventBus = new EventBus();
    const runtime = createRuntime({ eventBus });
    setDependencyProperty(runtime, "obs", {
      goalsManager: { initializeGoalDisplay: async () => {} },
      connectionManager: { isConnected: () => false, call: async () => ({}) },
    });
    let stopping: Promise<void> | undefined;
    eventBus.subscribe(PlatformEvents.SYSTEM_READY, () => { stopping = runtime.shutdown(); });
    const result = await runtime.start().catch(error => error);
    await stopping;
    expect(result).toEqual(expect.objectContaining({ message: "AppRuntime is stopped" }));
    expect(runtime.isStarted).toBe(false);
    await expect(runtime.start()).rejects.toThrow(/stopped/i);
  });

  it("rejects construction when a required dependency is missing", () => {
    expect(() => createRuntime({ eventBus: null })).toThrow(
      "AppRuntime missing required dependencies",
    );
  });

  it("rejects construction when event bus contract is invalid", () => {
    expect(() =>
      createRuntime({
        eventBus: {
          subscribe: null,
          emit: createMockFn(),
          unsubscribe: createMockFn(),
        },
      }),
    ).toThrow("AppRuntime requires eventBus.subscribe function");
  });

  it("rejects construction when platform lifecycle contract is invalid", () => {
    expect(() =>
      createRuntime({
        platformLifecycleService: {
          getAllPlatforms: null,
          getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
          recordPlatformConnection: createMockFn(),
          initializeAllPlatforms: createMockFn().mockResolvedValue(),
          disconnectAll: createMockFn().mockResolvedValue(),
        },
      }),
    ).toThrow(
      "AppRuntime requires platformLifecycleService.getAllPlatforms function",
    );
  });

  it("does not require a command parser dependency", () => {
    expect(() => createRuntime({ commandParser: null })).not.toThrow();
  });

  it("builds system-ready payload with services, timestamp, and statuses", () => {
    const runtime = createRuntime();
    const payload = runtime.emitSystemReady({ correlationId: "test-ready-1" });

    expect(Array.isArray(payload.services)).toBe(true);
    expect(payload.services.length).toBeGreaterThan(0);
    expect(typeof payload.timestamp).toBe("string");
    expect(payload.platforms).toBeDefined();
    expect(payload.cooldowns).toBeDefined();
    expect(payload.correlationId).toBe("test-ready-1");
  });

  it("throws when unified notification options are missing", async () => {
    const runtime = createRuntime();
    await expect(
      Reflect.apply(runtime.handleUnifiedNotification, runtime, [
        "platform:follow",
        "twitch",
        "test-user",
      ]),
    ).rejects.toThrow("handleUnifiedNotification requires options");
  });

  it("delegates unified notifications to the manager", async () => {
    const calls = createNotificationCalls();
    const notificationManager = createRecordingNotificationManager(calls);
    const runtime = createRuntime({ notificationManager });

    await runtime.handleUnifiedNotification(
      "platform:follow",
      "twitch",
      "test-user",
      {
        userId: "test-user-id",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
    );

    expect(calls.length).toBe(1);
    const call = getNotificationCall(calls);
    expect(call[0]).toBe("platform:follow");
    expect(call[1]).toBe("twitch");
    expect(call[2].username).toBe("test-user");
  });

  it("accepts anonymous gift notifications without username", async () => {
    const calls = createNotificationCalls();
    const notificationManager = createRecordingNotificationManager(calls);
    const runtime = createRuntime({ notificationManager });

    await runtime.handleUnifiedNotification("platform:gift", "tiktok", "", {
      isAnonymous: true,
      id: "anonymous-gift-1",
      giftType: "Rose",
      giftCount: 1,
      amount: 1,
      currency: "coins",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    expect(calls.length).toBe(1);
    expect(getNotificationCall(calls)[2].platform).toBe("tiktok");
  });

  it("routes unified notification errors through runtime error handler", async () => {
    const runtime = createRuntime();
    setRuntimeProperty(runtime, "notificationManager", null);
    const handled: unknown[][] = [];
    setRuntimeProperty(runtime, "errorHandler", {
      handleEventProcessingError: (...args: unknown[]) => handled.push(args),
      logOperationalError: createMockFn(),
    });

    await runtime.handleUnifiedNotification(
      "platform:follow",
      "twitch",
      "test-user",
      {
        userId: "test-user-id",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
    );

    expect(handled.length).toBe(1);
  });

  it("returns failed result when notification manager reports failure", async () => {
    const runtime = createRuntime({
      notificationManager: {
        handleNotification: createMockFn().mockResolvedValue({
          success: false,
          error: "Notifications disabled",
        }),
      },
    });

    const result = await runtime.handleUnifiedNotification(
      "farewell",
      "twitch",
      "test-user",
      {
        userId: "test-user-id",
        command: "!bye",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: "Notifications disabled",
      }),
    );
  });

  it("preserves suppression result shape from notification manager", async () => {
    const runtime = createRuntime({
      notificationManager: {
        handleNotification: createMockFn().mockResolvedValue({
          success: false,
          suppressed: true,
          reason: "spam_detection",
          notificationType: "platform:gift",
          platform: "tiktok",
        }),
      },
    });

    const result = await runtime.handleUnifiedNotification(
      "platform:gift",
      "tiktok",
      "test-user",
      {
        userId: "test-user-id",
        timestamp: "2024-01-01T00:00:00.000Z",
        giftType: "Rose",
        giftCount: 1,
        amount: 1,
        currency: "coins",
        id: "test-gift-1",
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        suppressed: true,
        reason: "spam_detection",
        notificationType: "platform:gift",
        platform: "tiktok",
      }),
    );
  });

  it("returns failed result when notification manager throws", async () => {
    const runtime = createRuntime({
      notificationManager: {
        handleNotification: createMockFn().mockRejectedValue(
          new Error("notification manager exploded"),
        ),
      },
    });

    const result = await runtime.handleUnifiedNotification(
      "farewell",
      "twitch",
      "test-user",
      {
        userId: "test-user-id",
        command: "!bye",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: "notification manager exploded",
      }),
    );
  });

  it("returns failed result when notification manager throws a non-Error value", async () => {
    const runtime = createRuntime({
      notificationManager: {
        handleNotification: createMockFn().mockRejectedValue(
          "test-notification-manager-non-error",
        ),
      },
    });

    const result = await runtime.handleUnifiedNotification(
      "farewell",
      "twitch",
      "test-user",
      {
        userId: "test-user-id",
        command: "!bye",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: "test-notification-manager-non-error",
      }),
    );
  });

  it("returns failed result when notification manager returns invalid result shape", async () => {
    const runtime = createRuntime({
      notificationManager: {
        handleNotification: createMockFn().mockResolvedValue(undefined),
      },
    });

    const result = await runtime.handleUnifiedNotification(
      "farewell",
      "twitch",
      "test-user",
      {
        userId: "test-user-id",
        command: "!bye",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: "Notification manager returned invalid result shape",
      }),
    );
  });

  it("enforces required fields for gift notifications", async () => {
    const runtime = createRuntime();

    await expect(
      runtime.handleGiftNotification("twitch", "test-user", {
        type: "platform:gift",
        userId: "test-user-id",
      }),
    ).rejects.toThrow("handleGiftNotification requires timestamp");
  });

  it("forwards gift notifications with VFX config", async () => {
    const calls = createNotificationCalls();
    const notificationManager = createRecordingNotificationManager(calls);
    const runtime = createRuntime({
      notificationManager,
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue({ key: "gifts" }),
      },
    });

    await runtime.handleGiftNotification("tiktok", "test-user", {
      type: "platform:gift",
      userId: "test-gift-user-id",
      timestamp: "2024-01-01T00:00:00.000Z",
      giftType: "Rose",
      giftCount: 2,
      amount: 10,
      currency: "coins",
      id: "test-gift-1",
    });

    expect(calls.length).toBe(1);
    const call = getNotificationCall(calls);
    expect(call[0]).toBe("platform:gift");
    expect(call[2].vfxConfig).toEqual({ key: "gifts" });
    expect(
      Object.prototype.hasOwnProperty.call(call[2], "repeatCount"),
    ).toBe(false);
  });

  it("forwards YouTube jewels gift notifications without userId when metadata marks missing userId", async () => {
    const calls = createNotificationCalls();
    const notificationManager = createRecordingNotificationManager(calls);
    const runtime = createRuntime({
      notificationManager,
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue({ key: "gifts" }),
      },
    });

    await runtime.handleGiftNotification("youtube", "test-jewels-user", {
      type: "platform:gift",
      timestamp: "2024-01-01T00:00:00.000Z",
      giftType: "Girl power",
      giftCount: 1,
      amount: 300,
      currency: "jewels",
      id: "yt-jewels-gift-runtime-1",
      metadata: {
        missingFields: ["userId"],
      },
    });

    expect(calls.length).toBe(1);
    const call = getNotificationCall(calls);
    expect(call[0]).toBe("platform:gift");
    expect(call[2]).toMatchObject({
      username: "test-jewels-user",
      giftType: "Girl power",
      amount: 300,
      currency: "jewels",
      metadata: { missingFields: ["userId"] },
    });
    expect(call[2].userId).toBeUndefined();
  });

  it("forwards amountless YouTube jewels gifts when metadata marks amount and userId missing", async () => {
    const calls = createNotificationCalls();
    const notificationManager = createRecordingNotificationManager(calls);
    const runtime = createRuntime({
      notificationManager,
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue({ key: "gifts" }),
      },
    });

    await runtime.handleGiftNotification("youtube", "test-youtube-gifter", {
      type: "platform:gift",
      timestamp: "2024-01-01T00:00:00.000Z",
      giftType: "Let em cook",
      giftCount: 1,
      currency: "jewels",
      id: "yt-jewels-gift-runtime-amountless-1",
      metadata: {
        missingFields: ["amount", "userId"],
      },
    });

    expect(calls.length).toBe(1);
    const call = getNotificationCall(calls);
    expect(call[2]).toMatchObject({
      username: "test-youtube-gifter",
      giftType: "Let em cook",
      currency: "jewels",
      metadata: { missingFields: ["amount", "userId"] },
    });
    expect(call[2].amount).toBeUndefined();
    expect(call[2].userId).toBeUndefined();
  });

  it("rejects null amount on a marked amountless YouTube jewels gift", async () => {
    const runtime = createRuntime();

    await expect(runtime.handleGiftNotification("youtube", "test-youtube-gifter", {
      type: "platform:gift",
      timestamp: "2024-01-01T00:00:00.000Z",
      giftType: "Let em cook",
      giftCount: 1,
      amount: null,
      currency: "jewels",
      id: "yt-jewels-gift-runtime-null-1",
      metadata: {
        missingFields: ["amount", "userId"],
      },
    })).rejects.toThrow("Gift notification requires giftType, giftCount, amount, and currency");
  });

  it("defaults gift notification type to platform:gift when omitted", async () => {
    const calls = createNotificationCalls();
    const notificationManager = createRecordingNotificationManager(calls);
    const runtime = createRuntime({
      notificationManager,
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue({ key: "gifts" }),
      },
    });

    await runtime.handleGiftNotification("twitch", "test-user", {
      userId: "test-user-id",
      timestamp: "2024-01-01T00:00:00.000Z",
      giftType: "Rose",
      giftCount: 1,
      amount: 5,
      currency: "USD",
      id: "test-gift-default-type",
    });

    expect(calls.length).toBe(1);
    expect(getNotificationCall(calls)[0]).toBe("platform:gift");
  });

  it("normalizes gift notification error payloads", async () => {
    const calls = createNotificationCalls();
    const notificationManager = createRecordingNotificationManager(calls);
    const runtime = createRuntime({
      notificationManager,
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue({ key: "gifts" }),
      },
    });

    await runtime.handleGiftNotification("twitch", "test-user", {
      type: "platform:gift",
      isError: true,
      giftType: "",
      giftCount: -2,
      amount: -5,
      currency: "",
      userId: "test-user-id",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    expect(calls.length).toBe(1);
    expect(getNotificationCall(calls)[2].giftType).toBeUndefined();
  });

  it("validates giftpaypiggy event requirements", async () => {
    const runtime = createRuntime();

    await expect(
      runtime.handleGiftPaypiggyEvent("twitch", "test-user", {
        giftCount: 2,
        userId: "test-user-id",
        timestamp: "2024-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("handleGiftPaypiggyEvent requires tier and giftCount");
  });

  it("routes giftpaypiggy events through unified handler", async () => {
    const calls = createNotificationCalls();
    const notificationManager = createRecordingNotificationManager(calls);
    const runtime = createRuntime({ notificationManager });

    await runtime.handleGiftPaypiggyEvent("youtube", "test-user", {
      giftCount: 1,
      userId: "test-user-id",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    expect(calls.length).toBe(1);
    expect(getNotificationCall(calls)[0]).toBe("platform:giftpaypiggy");
  });

  it("preserves explicit avatarUrl for giftpaypiggy notifications", async () => {
    const calls = createNotificationCalls();
    const notificationManager = createRecordingNotificationManager(calls);
    const runtime = createRuntime({ notificationManager });

    await runtime.handleGiftPaypiggyEvent("youtube", "test-user", {
      giftCount: 1,
      userId: "test-user-id",
      timestamp: "2024-01-01T00:00:00.000Z",
      avatarUrl: "https://example.invalid/runtime-giftpaypiggy-avatar.png",
    });

    expect(calls.length).toBe(1);
    const call = getNotificationCall(calls);
    expect(call[0]).toBe("platform:giftpaypiggy");
    expect(call[2].avatarUrl).toBe(
      "https://example.invalid/runtime-giftpaypiggy-avatar.png",
    );
  });

  it("preserves explicit avatarUrl for paypiggy notifications", async () => {
    const calls = createNotificationCalls();
    const notificationManager = createRecordingNotificationManager(calls);
    const runtime = createRuntime({ notificationManager });

    await runtime.handlePaypiggyNotification("twitch", "test-user", {
      userId: "test-user-id",
      timestamp: "2024-01-01T00:00:00.000Z",
      tier: "1000",
      months: 10,
      avatarUrl: "https://example.invalid/runtime-paypiggy-avatar.png",
    });

    expect(calls.length).toBe(1);
    const call = getNotificationCall(calls);
    expect(call[0]).toBe("platform:paypiggy");
    expect(call[2].avatarUrl).toBe(
      "https://example.invalid/runtime-paypiggy-avatar.png",
    );
  });

  it("validates resub events require tier, months, and message", async () => {
    const runtime = createRuntime();

    await expect(
      runtime.handleResubEvent("twitch", "test-user", {
        tier: "1000",
        months: 3,
      }),
    ).rejects.toThrow("handleResubEvent requires tier, months, and message");
  });

  it("routes resub notifications through error handler on failure", async () => {
    const runtime = createRuntime();
    const handled: unknown[][] = [];
    setRuntimeProperty(runtime, "errorHandler", {
      handleEventProcessingError: (...args: unknown[]) => handled.push(args),
      logOperationalError: createMockFn(),
    });

    const result = await runtime.handleResubNotification(
      "twitch",
      "test-user",
      { tier: "1000", months: 3 },
    );

    expect(handled.length).toBe(1);
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        notificationType: "platform:paypiggy",
        platform: "twitch",
      }),
    );
  });

  it("validates raid inputs", async () => {
    const runtime = createRuntime();

    await expect(
      runtime.handleRaidNotification("twitch", "test-raider", {}),
    ).resolves.toMatchObject({
      success: false,
      error: "Missing userId for platform:raid notification",
    });
    await expect(
      runtime.handleRaidNotification("twitch", "test-raider", undefined as unknown as Parameters<AppRuntime["handleRaidNotification"]>[2]),
    ).rejects.toThrow("handleRaidNotification requires options");
  });

  it("routes envelope notifications with required payload", async () => {
    const calls = createNotificationCalls();
    const notificationManager = createRecordingNotificationManager(calls);
    const runtime = createRuntime({ notificationManager });

    await runtime.handleEnvelopeNotification("tiktok", {
      username: "test-envelope-user",
      userId: "test-env-user-id",
      giftType: "Coins",
      giftCount: 1,
      amount: 5,
      currency: "USD",
      timestamp: "2024-01-01T00:00:00.000Z",
      id: "test-env-1",
    });

    expect(calls.length).toBe(1);
    const call = getNotificationCall(calls);
    expect(call[0]).toBe("platform:envelope");
    expect(call[2].avatarUrl).toBe(DEFAULT_AVATAR_URL);
    expect(
      Object.prototype.hasOwnProperty.call(call[2], "repeatCount"),
    ).toBe(false);
  });

  it("preserves explicit avatarUrl for envelope notifications", async () => {
    const calls = createNotificationCalls();
    const notificationManager = createRecordingNotificationManager(calls);
    const runtime = createRuntime({ notificationManager });

    await runtime.handleEnvelopeNotification("tiktok", {
      username: "test-envelope-user",
      userId: "test-env-user-id",
      giftType: "Coins",
      giftCount: 1,
      amount: 5,
      currency: "USD",
      timestamp: "2024-01-01T00:00:00.000Z",
      id: "test-env-2",
      avatarUrl: "https://example.invalid/runtime-envelope-avatar.png",
    });

    expect(calls.length).toBe(1);
    const call = getNotificationCall(calls);
    expect(call[0]).toBe("platform:envelope");
    expect(call[2].avatarUrl).toBe(
      "https://example.invalid/runtime-envelope-avatar.png",
    );
  });

  it("routes envelope errors through runtime handler", async () => {
    const runtime = createRuntime();
    const handled: unknown[][] = [];
    setRuntimeProperty(runtime, "errorHandler", {
      handleEventProcessingError: (...args: unknown[]) => handled.push(args),
      logOperationalError: createMockFn(),
    });

    await Reflect.apply(runtime.handleEnvelopeNotification, runtime, ["tiktok", null]);

    expect(handled.length).toBe(1);
  });

  it("triggers youtube reconnect on stream detection", async () => {
    const runtime = createRuntime();
    const called: unknown[][] = [];
    runtime.youtube = {
      initialize: async (...args: unknown[]) => {
        called.push(args);
      },
    };

    await runtime.handleStreamDetected("youtube", {
      eventType: "stream-detected",
      newStreamIds: ["test-stream-1"],
    });

    expect(called.length).toBe(1);
  });

  it("ignores non-stream-detected events", async () => {
    const runtime = createRuntime();
    const called: unknown[][] = [];
    runtime.youtube = {
      initialize: async (...args: unknown[]) => {
        called.push(args);
      },
    };

    await runtime.handleStreamDetected("youtube", {
      eventType: "ignored-event",
      newStreamIds: ["test-stream-1"],
    });

    expect(called.length).toBe(0);
  });

  it("throws when user tracking service is unavailable", () => {
    const runtime = createRuntime();
    setRuntimeProperty(runtime, "userTrackingService", null);

    expect(() => runtime.isFirstMessage("test-user-1")).toThrow(
      "UserTrackingService not available for first message check",
    );
  });

  it("delegates viewer-count transitions to ViewerCountSystem", async () => {
    const runtime = createRuntime();
    const calls: Array<[string, unknown]> = [];
    setRuntimeProperty(runtime, "viewerCountSystem", {
      updateViewerCount: async (platform: string, count: unknown) => {
        calls.push([platform, count]);
        return true;
      },
    });

    expect(await runtime.updateViewerCount("twitch", 5)).toBe(true);
    expect(calls).toEqual([["twitch", 5]]);
  });

  it("routes chat messages through the chat router", async () => {
    const runtime = createRuntime();
    const calls: ChatCall[] = [];
    setRuntimeProperty(runtime, "chatNotificationRouter", {
      handleChatMessage: async (...args: ChatCall) => {
        calls.push(args);
      },
    });

    await runtime.handleChatMessage("twitch", {
      username: "test-user",
      message: "Hello",
    });

    expect(calls.length).toBe(1);
    const call = getMockCall(calls);
    expect(call[0]).toBe("twitch");
  });

  it("handles VFX command events from the event bus", async () => {
    let handler: ((event: Record<string, unknown>) => Promise<void> | void) | undefined;
    const eventBus = {
      subscribe: createMockFn(
        (eventName: string, callback: VfxEventHandler) => {
        if (eventName === PlatformEvents.VFX_COMMAND_RECEIVED) {
          handler = callback;
        }
        return createMockFn();
        },
      ),
    };
    const vfxCalls: unknown[][] = [];
    createRuntime({
      eventBus,
      vfxCommandService: {
        executeCommand: async (...args: unknown[]) => {
          vfxCalls.push(args);
        },
        executeCommandForKey: async (...args: unknown[]) => {
          vfxCalls.push(args);
        },
      },
    });

    expect(typeof handler).toBe("function");
    if (typeof handler !== "function") {
      throw new Error("VFX command handler was not subscribed");
    }

    await handler({
      command: "!spark",
      username: "test-user",
      platform: "twitch",
      userId: "test-user-1",
      context: { skipCooldown: true, correlationId: "test-corr-1" },
    });

    await handler({
      commandKey: "spark",
      username: "test-user",
      platform: "twitch",
      userId: "test-user-1",
      context: { skipCooldown: true, correlationId: "test-corr-2" },
    });

    expect(vfxCalls.length).toBe(2);
  });

  it("captures handler errors for invalid VFX events", async () => {
    let handler: ((event: Record<string, unknown>) => Promise<void> | void) | undefined;
    const eventBus = {
      subscribe: createMockFn(
        (eventName: string, callback: VfxEventHandler) => {
        if (eventName === PlatformEvents.VFX_COMMAND_RECEIVED) {
          handler = callback;
        }
        return createMockFn();
        },
      ),
    };
    const runtime = createRuntime({ eventBus });
    const handled: unknown[][] = [];
    setRuntimeProperty(runtime, "errorHandler", {
      handleEventProcessingError: (...args: unknown[]) => handled.push(args),
      logOperationalError: createMockFn(),
    });

    expect(typeof handler).toBe("function");
    if (typeof handler !== "function") {
      throw new Error("VFX command handler was not subscribed");
    }

    await handler({
      command: "!spark",
      username: "test-user",
      platform: "twitch",
      userId: "test-user-1",
    });

    expect(handled.length).toBe(1);
  });

  it("does not expose a platform-connection passthrough helper", () => {
    const runtime = createRuntime({
      platformLifecycleService: {
        getAllPlatforms: createMockFn().mockReturnValue({}),
        getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
        disconnectAll: createMockFn().mockResolvedValue(),
      },
    });

    expect(Reflect.get(runtime, "recordPlatformConnection")).toBeUndefined();
  });

  it("handles early viewer count initialization failures", async () => {
    const runtime = createRuntime();
    setRuntimeProperty(runtime, "viewerCountSystem", {
      initialize: createMockFn().mockRejectedValue(new Error("init failed")),
      startPolling: createMockFn(),
    });
    const handled: unknown[][] = [];
    setRuntimeProperty(runtime, "errorHandler", {
      handleEventProcessingError: (...args: unknown[]) => handled.push(args),
      logOperationalError: createMockFn(),
    });

    await runtime.startViewerCountSystemEarly();

    expect(handled.length).toBe(1);
  });

  it("uses the OBS connection manager when event service is unavailable", async () => {
    const notificationManager = {
      stopSuppressionCleanup: createMockFn(),
    };
    const runtime = createRuntime({ notificationManager });
    let disconnectCalls = 0;
    setRuntimeProperty(runtime, "obsEventService", null);
    setDependencyProperty(runtime, "obs", {
      connectionManager: {
        isConnected: () => true,
        call: async () => ({}),
        disconnect: async () => {
          disconnectCalls += 1;
        },
      },
    });
    setRuntimeProperty(runtime, "viewerCountSystem", { stopPolling: createMockFn() });
    setRuntimeProperty(runtime, "viewerCountStatusCleanup", createMockFn());
    const originalExit = process.exit;
    Reflect.set(process, "exit", createMockFn());

    try {
      await runtime.shutdown();

      expect(disconnectCalls).toBe(1);
    } finally {
      Reflect.set(process, "exit", originalExit);
    }
  });

  it("shuts down services and calls cleanup hooks", async () => {
    const calls = { disconnectAll: 0, cleanup: 0 };
    const displayQueue = {
      ...createMockDisplayQueue(),
      stop: createMockFn().mockResolvedValue(),
    };
    const runtime = createRuntime({
      displayQueue,
      notificationManager: {},
      platformLifecycleService: {
        getAllPlatforms: createMockFn().mockReturnValue({}),
        getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
        recordPlatformConnection: createMockFn(),
        disconnectAll: async () => {
          calls.disconnectAll += 1;
        },
      },
    });
    setRuntimeProperty(runtime, "viewerCountSystem", { stopPolling: createMockFn() });
    runtime.viewerCountStatusCleanup = () => {
      calls.cleanup += 1;
    };
    const originalExit = process.exit;
    Reflect.set(process, "exit", createMockFn());

    try {
      await runtime.shutdown();

      expect(calls.disconnectAll).toBe(1);
      expect(calls.cleanup).toBe(1);
      expect(displayQueue.stop.mock.calls.length).toBe(1);
    } finally {
      Reflect.set(process, "exit", originalExit);
    }
  });

  it("calls disconnect and destroy on OBS event service during shutdown", async () => {
    const obsEventService = {
      disconnect: createMockFn().mockResolvedValue(),
      destroy: createMockFn(),
    };
    const runtime = createRuntime({ obsEventService });
    setRuntimeProperty(runtime, "viewerCountSystem", {
      stopPolling: createMockFn(),
      cleanup: createMockFn().mockResolvedValue(),
    });
    setRuntimeProperty(runtime, "viewerCountStatusCleanup", createMockFn());
    const originalExit = process.exit;
    Reflect.set(process, "exit", createMockFn());

    try {
      await runtime.shutdown();
      expect(obsEventService.disconnect.mock.calls.length).toBe(1);
      expect(obsEventService.destroy.mock.calls.length).toBe(1);
    } finally {
      Reflect.set(process, "exit", originalExit);
    }
  });

  it("unsubscribes VFX command listener during shutdown", async () => {
    const unsubscribeByEvent = new Map();
    const eventBus = {
      subscribe: createMockFn((eventName) => {
        const unsubscribe = createMockFn();
        unsubscribeByEvent.set(eventName, unsubscribe);
        return unsubscribe;
      }),
    };
    const runtime = createRuntime({ eventBus });
    setRuntimeProperty(runtime, "viewerCountSystem", {
      stopPolling: createMockFn(),
      cleanup: createMockFn().mockResolvedValue(),
    });
    setRuntimeProperty(runtime, "viewerCountStatusCleanup", createMockFn());
    const originalExit = process.exit;
    Reflect.set(process, "exit", createMockFn());

    try {
      await runtime.shutdown();

      const vfxUnsubscribe = unsubscribeByEvent.get(
        PlatformEvents.VFX_COMMAND_RECEIVED,
      );
      expect(typeof vfxUnsubscribe).toBe("function");
      expect(vfxUnsubscribe.mock.calls.length).toBe(1);
    } finally {
      Reflect.set(process, "exit", originalExit);
    }
  });

  it("cleans up viewer count observers on shutdown when cleanup is available", async () => {
    const runtime = createRuntime();
    const viewerCountCleanup = createMockFn().mockResolvedValue();
    setRuntimeProperty(runtime, "viewerCountSystem", {
      stopPolling: createMockFn(),
      cleanup: viewerCountCleanup,
    });
    setRuntimeProperty(runtime, "viewerCountStatusCleanup", createMockFn());
    const originalExit = process.exit;
    Reflect.set(process, "exit", createMockFn());

    try {
      await runtime.shutdown();
      expect(viewerCountCleanup.mock.calls.length).toBe(1);
    } finally {
      Reflect.set(process, "exit", originalExit);
    }
  });

  it("continues shutdown cleanup after platform disconnect failures", async () => {
    const obsEventService = {
      disconnect: createMockFn().mockResolvedValue(),
      destroy: createMockFn(),
    };
    const runtime = createRuntime({
      obsEventService,
      platformLifecycleService: {
        getAllPlatforms: createMockFn().mockReturnValue({}),
        getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
        recordPlatformConnection: createMockFn(),
        initializeAllPlatforms: createMockFn().mockResolvedValue(),
        disconnectAll: createMockFn().mockRejectedValue(
          new Error("disconnect failed"),
        ),
      },
    });
    const logged: unknown[][] = [];
    const displayQueue = {
      ...createMockDisplayQueue(),
      stop: createMockFn().mockRejectedValue(new Error("display queue stop failed")),
    };
    const viewerCountCleanup = createMockFn().mockResolvedValue();
    setRuntimeProperty(runtime, "displayQueue", displayQueue);
    setRuntimeProperty(runtime, "errorHandler", {
      handleEventProcessingError: (...args: unknown[]) => logged.push(args),
      logOperationalError: (...args: unknown[]) => logged.push(args),
    });
    setRuntimeProperty(runtime, "viewerCountSystem", {
      stopPolling: createMockFn(),
      cleanup: viewerCountCleanup,
    });
    setRuntimeProperty(runtime, "viewerCountStatusCleanup", createMockFn());
    const originalExit = process.exit;
    Reflect.set(process, "exit", createMockFn());

    try {
      await runtime.shutdown();
      expect(displayQueue.stop.mock.calls.length).toBe(1);
      expect(logged.some((args) => args.some((value) => String(value).includes("stop display queue")))).toBe(true);
      expect(obsEventService.disconnect.mock.calls.length).toBe(1);
      expect(viewerCountCleanup.mock.calls.length).toBe(1);
    } finally {
      Reflect.set(process, "exit", originalExit);
    }
  });

  it("emits system shutdown, sets exit code, and only forces exit on timeout fallback", () => {
    const runtime = createRuntime();
    const exitCalls: Array<number | string | null | undefined> = [];
    const logged: unknown[][] = [];
    const originalExit = process.exit;
    const originalExitCode = process.exitCode;
    Reflect.set(process, "exitCode", undefined);
    Reflect.set(process, "exit", (code?: number | string | null) => {
      exitCalls.push(code);
    });
    setRuntimeProperty(runtime, "errorHandler", {
      handleEventProcessingError: createMockFn(),
      logOperationalError: (...args: unknown[]) => logged.push(args),
    });
    useFakeTimers();

    try {
      runtime.emitSystemShutdown({ reason: "test" });
      expect(process.exitCode).toBe(0);
      expect(exitCalls.length).toBe(0);

      runOnlyPendingTimers();

      expect(exitCalls.length).toBe(1);
      expect(logged.length).toBe(1);
    } finally {
      Reflect.set(process, "exit", originalExit);
      Reflect.set(process, "exitCode", originalExitCode);
    }
  });

  it("starts runtime with viewer count wiring and readiness", async () => {
    const runtime = createRuntime();
    const goalsCalls: string[] = [];
    setDependencyProperty(runtime, "obs", {
      goalsManager: {
        initializeGoalDisplay: async () => goalsCalls.push("init"),
      },
      connectionManager: { isConnected: () => false, call: async () => ({}) },
    });
    const viewerCountCalls = { add: 0, init: 0, start: 0 };
    setRuntimeProperty(runtime, "viewerCountSystem", {
      addObserver: () => {
        viewerCountCalls.add += 1;
      },
      initialize: async () => {
        viewerCountCalls.init += 1;
      },
      startPolling: async () => {
        viewerCountCalls.start += 1;
      },
    });

    await runtime.start();

    expect(viewerCountCalls).toEqual({ add: 1, init: 1, start: 1 });
    expect(goalsCalls).toEqual(["init"]);
  });

  it("uses injected OBS subsystem dependencies for startup display clearing and observer wiring", async () => {
    const clearTextSource = createMockFn().mockResolvedValue();
    const connectionManager = {
      isConnected: createMockFn().mockReturnValue(true),
      isReady: createMockFn().mockReturnValue(true),
      ensureConnected: createMockFn().mockResolvedValue(),
      call: createMockFn().mockResolvedValue({}),
      addEventListener: createMockFn(),
      removeEventListener: createMockFn(),
    };
    const goalsManager = {
      initializeGoalDisplay: createMockFn().mockResolvedValue(),
    };
    const runtime = createRuntime(
      {},
      {
        obs: {
          enabled: false,
          chatMsgScene: "test-chat-scene",
          notificationScene: "test-notification-scene",
          chatPlatformLogos: { twitch: "test-chat-logo" },
          notificationPlatformLogos: { twitch: "test-notification-logo" },
          ttsTxt: "test-tts-source",
          notificationTxt: "test-notification-source",
        },
      },
    );
    setDependencyProperty(runtime, "obs", {
      connectionManager,
      sourcesManager: {
        clearTextSource,
        updateTextSource: createMockFn().mockResolvedValue(),
      },
      goalsManager,
    });
    const addObserver = createMockFn();
    setRuntimeProperty(runtime, "viewerCountSystem", {
      addObserver,
      initialize: createMockFn().mockResolvedValue(),
      startPolling: createMockFn().mockResolvedValue(),
    });

    await runtime.start();

    expect(clearTextSource.mock.calls.length).toBe(1);
    expect(clearTextSource.mock.calls[0]).toEqual(["test-tts-source"]);
    expect(goalsManager.initializeGoalDisplay.mock.calls.length).toBe(1);
    const [obsViewerObserver] = getMockCall(addObserver.mock.calls);
    expect(obsViewerObserver).toMatchObject({ obsManager: connectionManager });
    if (
      !obsViewerObserver ||
      typeof obsViewerObserver !== "object" ||
      !("obsManager" in obsViewerObserver)
    ) {
      throw new Error("Expected OBS viewer observer with obsManager");
    }
    expect(obsViewerObserver.obsManager).toBe(connectionManager);
  });

  it("rolls back initialized services when startup fails after platform initialization", async () => {
    const disconnectAll = createMockFn().mockResolvedValue();
    const displayQueue = {
      ...createMockDisplayQueue(),
      stop: createMockFn().mockResolvedValue(),
    };
    const runtime = createRuntime({
      platformLifecycleService: {
        getAllPlatforms: createMockFn().mockReturnValue({}),
        getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
        recordPlatformConnection: createMockFn(),
        initializeAllPlatforms: createMockFn().mockResolvedValue(),
        disconnectAll,
      },
    });
    setRuntimeProperty(runtime, "displayQueue", displayQueue);
    setDependencyProperty(runtime, "obs", {
      goalsManager: { initializeGoalDisplay: async () => {} },
      connectionManager: { isConnected: () => false, call: async () => ({}) },
    });
    setRuntimeProperty(runtime, "viewerCountSystem", {
      addObserver: createMockFn(),
      initialize: createMockFn().mockRejectedValue(
        new Error("viewer count init failed"),
      ),
      startPolling: createMockFn().mockResolvedValue(),
    });

    await expect(runtime.start()).rejects.toThrow("viewer count init failed");
    expect(displayQueue.stop.mock.calls.length).toBe(1);
    expect(disconnectAll.mock.calls.length).toBe(1);
  });

  it("rolls back gui transport when startup fails", async () => {
    const eventBus = {
      subscribe: createMockFn(() => createMockFn()),
    };
    const guiTransportService = {
      start: createMockFn().mockResolvedValue(),
      stop: createMockFn().mockResolvedValue(),
      isActive: createMockFn().mockReturnValue(true),
    };
    const runtime = createRuntime(
      { eventBus, guiTransportService },
      { gui: { enableDock: true, enableOverlay: false } },
    );
    setDependencyProperty(runtime, "obs", {
      goalsManager: { initializeGoalDisplay: async () => {} },
      connectionManager: { isConnected: () => false, call: async () => ({}) },
    });
    setRuntimeProperty(runtime, "viewerCountSystem", {
      addObserver: createMockFn(),
      initialize: createMockFn().mockRejectedValue(
        new Error("viewer count init failed"),
      ),
      startPolling: createMockFn().mockResolvedValue(),
      stopPolling: createMockFn(),
      cleanup: createMockFn().mockResolvedValue(),
    });

    await expect(runtime.start()).rejects.toThrow("viewer count init failed");
    expect(guiTransportService.stop.mock.calls.length).toBe(1);
  });

  it("rejects repeated start calls once runtime has already started", async () => {
    const runtime = createRuntime();
    setDependencyProperty(runtime, "obs", {
      goalsManager: { initializeGoalDisplay: async () => {} },
      connectionManager: { isConnected: () => false, call: async () => ({}) },
    });
    setRuntimeProperty(runtime, "viewerCountSystem", {
      addObserver: createMockFn(),
      initialize: createMockFn().mockResolvedValue(),
      startPolling: createMockFn().mockResolvedValue(),
    });

    await runtime.start();
    await expect(runtime.start()).rejects.toThrow(
      /already started|start in progress/i,
    );
  });

  it("fails startup when VFX command service is unavailable at startup time", async () => {
    const runtime = createRuntime();
    setDependencyProperty(runtime, "obs", {
      goalsManager: { initializeGoalDisplay: async () => {} },
      connectionManager: { isConnected: () => false, call: async () => ({}) },
    });
    setRuntimeProperty(runtime, "viewerCountSystem", {
      addObserver: createMockFn(),
      initialize: createMockFn().mockResolvedValue(),
      startPolling: createMockFn().mockResolvedValue(),
    });
    setRuntimeProperty(runtime, "vfxCommandService", null);

    await expect(runtime.start()).rejects.toThrow(
      "VFXCommandService unavailable for runtime startup",
    );
  });

  it("emits degraded readiness when platform initialization reports failures", async () => {
    const runtime = createRuntime({
      platformLifecycleService: {
        getAllPlatforms: createMockFn().mockReturnValue({}),
        getStatus: createMockFn().mockReturnValue({
          platformHealth: {
            twitch: { state: "failed", lastError: "auth failed" },
          },
          failedPlatforms: [{ name: "twitch", lastError: "auth failed" }],
        }),
        recordPlatformConnection: createMockFn(),
        initializeAllPlatforms: createMockFn().mockResolvedValue(),
        disconnectAll: createMockFn().mockResolvedValue(),
      },
    });
    setDependencyProperty(runtime, "obs", {
      goalsManager: { initializeGoalDisplay: async () => {} },
      connectionManager: { isConnected: () => false, call: async () => ({}) },
    });
    setRuntimeProperty(runtime, "viewerCountSystem", {
      addObserver: createMockFn(),
      initialize: createMockFn().mockResolvedValue(),
      startPolling: createMockFn().mockResolvedValue(),
    });
    const readyPayloads: Array<ReturnType<RuntimeUnderTest["emitSystemReady"]>> = [];
    const emitSystemReady = runtime.emitSystemReady.bind(runtime);
    runtime.emitSystemReady = createMockFn((options) => {
      const payload = emitSystemReady(options);
      readyPayloads.push(payload);
      return payload;
    });

    await runtime.start();
    const readyPayload = getLastValue(readyPayloads);
    expect(readyPayload.degraded).toBe(true);
    expect(readyPayload.degradationReasons).toEqual(
      expect.arrayContaining(["platform-initialization-failed"]),
    );
  });

  it("emits degraded readiness while a platform is recovering", async () => {
    const runtime = createRuntime({
      platformLifecycleService: {
        getAllPlatforms: createMockFn().mockReturnValue({}),
        getStatus: createMockFn().mockReturnValue({
          platformHealth: {
            twitch: { state: "recovering", lastError: "temporary DNS failure" },
          },
          failedPlatforms: [],
          recoveringPlatforms: [
            { name: "twitch", lastError: "temporary DNS failure" },
          ],
        }),
        recordPlatformConnection: createMockFn(),
        initializeAllPlatforms: createMockFn().mockResolvedValue(),
        disconnectAll: createMockFn().mockResolvedValue(),
      },
    });
    setDependencyProperty(runtime, "obs", {
      goalsManager: { initializeGoalDisplay: async () => {} },
      connectionManager: { isConnected: () => false, call: async () => ({}) },
    });
    setRuntimeProperty(runtime, "viewerCountSystem", {
      addObserver: createMockFn(),
      initialize: createMockFn().mockResolvedValue(),
      startPolling: createMockFn().mockResolvedValue(),
    });
    const readyPayloads: Array<ReturnType<RuntimeUnderTest["emitSystemReady"]>> = [];
    const emitSystemReady = runtime.emitSystemReady.bind(runtime);
    runtime.emitSystemReady = createMockFn((options) => {
      const payload = emitSystemReady(options);
      readyPayloads.push(payload);
      return payload;
    });

    await runtime.start();

    const readyPayload = getLastValue(readyPayloads);
    expect(readyPayload.degraded).toBe(true);
    expect(readyPayload.degradationReasons).toEqual(
      expect.arrayContaining(["platform-recovering"]),
    );
  });

  it("does not report operational monitoring as degraded", () => {
    const runtime = createRuntime({
      platformLifecycleService: {
        getAllPlatforms: createMockFn().mockReturnValue({}),
        getStatus: createMockFn().mockReturnValue({
          initializedPlatforms: ["youtube"],
          monitoringPlatforms: ["youtube"],
          failedPlatforms: [],
          recoveringPlatforms: [],
        }),
        recordPlatformConnection: createMockFn(),
        initializeAllPlatforms: createMockFn().mockResolvedValue(),
        disconnectAll: createMockFn().mockResolvedValue(),
      },
    });

    const readyPayload = runtime.emitSystemReady({});

    expect(readyPayload.degraded).not.toBe(true);
    expect(readyPayload.degradationReasons).toBeUndefined();
  });

  it("emits degraded readiness while background platform initialization is pending", () => {
    const runtime = createRuntime({
      platformLifecycleService: {
        getAllPlatforms: createMockFn().mockReturnValue({}),
        getStatus: createMockFn().mockReturnValue({
          initializingPlatforms: ["tiktok"],
          failedPlatforms: [],
          recoveringPlatforms: [],
        }),
        recordPlatformConnection: createMockFn(),
        initializeAllPlatforms: createMockFn().mockResolvedValue(),
        disconnectAll: createMockFn().mockResolvedValue(),
      },
    });

    const readyPayload = runtime.emitSystemReady({});

    expect(readyPayload.degraded).toBe(true);
    expect(readyPayload.degradationReasons).toContain("platform-initializing");
  });

  it("starts gui transport when gui is active", async () => {
    const guiTransportService = {
      start: createMockFn().mockResolvedValue(),
      stop: createMockFn().mockResolvedValue(),
      isActive: createMockFn().mockReturnValue(true),
    };
    const runtime = createRuntime(
      { guiTransportService },
      { gui: { enableDock: true, enableOverlay: false } },
    );

    setDependencyProperty(runtime, "obs", {
      goalsManager: { initializeGoalDisplay: async () => {} },
      connectionManager: { isConnected: () => false, call: async () => ({}) },
    });
    setRuntimeProperty(runtime, "viewerCountSystem", {
      addObserver: async () => {},
      initialize: async () => {},
      startPolling: async () => {},
    });

    await runtime.start();

    expect(guiTransportService.start.mock.calls.length).toBe(1);
  });

  it("fails startup with the original error when active gui transport start rejects", async () => {
    const guiStartError = new Error("gui transport failed to bind");
    const initializeAllPlatforms = createMockFn().mockResolvedValue();
    const guiTransportService = {
      start: createMockFn().mockRejectedValue(guiStartError),
      stop: createMockFn().mockResolvedValue(),
      isActive: createMockFn().mockReturnValue(true),
    };
    const runtime = createRuntime(
      {
        guiTransportService,
        platformLifecycleService: {
          getAllPlatforms: createMockFn().mockReturnValue({}),
          getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
          recordPlatformConnection: createMockFn(),
          initializeAllPlatforms,
          disconnectAll: createMockFn().mockResolvedValue(),
        },
      },
      { gui: { enableDock: true, enableOverlay: false } },
    );

    try {
      await runtime.start();
      throw new Error("runtime.start() should reject");
    } catch (error) {
      expect(error).toBe(guiStartError);
      expect((error as Error).message).toBe("gui transport failed to bind");
    }

    expect(initializeAllPlatforms.mock.calls.length).toBe(0);
  });

  it("does not start gui transport when gui is inactive", async () => {
    const initializeAllPlatforms = createMockFn().mockResolvedValue();
    const guiTransportService = {
      start: createMockFn().mockResolvedValue(),
      stop: createMockFn().mockResolvedValue(),
      isActive: createMockFn().mockReturnValue(false),
    };
    const runtime = createRuntime(
      {
        guiTransportService,
        platformLifecycleService: {
          getAllPlatforms: createMockFn().mockReturnValue({}),
          getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
          recordPlatformConnection: createMockFn(),
          initializeAllPlatforms,
          disconnectAll: createMockFn().mockResolvedValue(),
        },
      },
      { gui: { enableDock: false, enableOverlay: false } },
    );

    setDependencyProperty(runtime, "obs", {
      goalsManager: { initializeGoalDisplay: async () => {} },
      connectionManager: { isConnected: () => false, call: async () => ({}) },
    });
    setRuntimeProperty(runtime, "viewerCountSystem", {
      addObserver: async () => {},
      initialize: async () => {},
      startPolling: async () => {},
    });

    await runtime.start();

    expect(guiTransportService.start.mock.calls.length).toBe(0);
    expect(initializeAllPlatforms.mock.calls.length).toBe(1);
  });

  it("stops gui transport on runtime shutdown", async () => {
    const guiTransportService = {
      start: createMockFn().mockResolvedValue(),
      stop: createMockFn().mockResolvedValue(),
      isActive: createMockFn().mockReturnValue(true),
    };
    const runtime = createRuntime({ guiTransportService });
    setRuntimeProperty(runtime, "viewerCountSystem", { stopPolling: createMockFn() });
    setRuntimeProperty(runtime, "viewerCountStatusCleanup", createMockFn());
    const originalExit = process.exit;
    Reflect.set(process, "exit", createMockFn());

    try {
      await runtime.shutdown();
      expect(guiTransportService.stop.mock.calls.length).toBe(1);
    } finally {
      Reflect.set(process, "exit", originalExit);
    }
  });

  it("disposes funding goal subscriptions on runtime shutdown", async () => {
    const dispose = createMockFn();
    const runtime = createRuntime();
    setRuntimeProperty(runtime, "fundingGoal", { dispose });
    setRuntimeProperty(runtime, "viewerCountSystem", { stopPolling: createMockFn() });
    setRuntimeProperty(runtime, "viewerCountStatusCleanup", createMockFn());
    const originalExit = process.exit;
    Reflect.set(process, "exit", createMockFn());

    try {
      await runtime.shutdown();
      expect(dispose.mock.calls.length).toBe(1);
    } finally {
      Reflect.set(process, "exit", originalExit);
    }
  });

  it("requires options when emitting system ready", () => {
    const runtime = createRuntime();

    expect(() => Reflect.apply(runtime.emitSystemReady, runtime, [])).toThrow(
      "emitSystemReady requires options",
    );
  });

  it("rejects invalid stream detection payloads", async () => {
    const runtime = createRuntime();

    await expect(Reflect.apply(runtime.handleStreamDetected, runtime, [null, {}])).rejects.toThrow(
      "Stream detection event requires platform",
    );
    await expect(Reflect.apply(runtime.handleStreamDetected, runtime, ["youtube", null])).rejects.toThrow(
      "Stream detection event requires data",
    );
    await expect(
      runtime.handleStreamDetected("youtube", {
        eventType: "stream-detected",
        newStreamIds: "nope",
      }),
    ).rejects.toThrow("Stream detection event requires newStreamIds array");
  });

  it("ignores empty stream detection updates", async () => {
    const runtime = createRuntime();
    const called: boolean[] = [];
    runtime.youtube = {
      initialize: async () => {
        called.push(true);
      },
    };

    await runtime.handleStreamDetected("youtube", {
      eventType: "stream-detected",
      newStreamIds: [],
    });

    expect(called.length).toBe(0);
  });

  it("keeps running when youtube reconnect fails", async () => {
    const runtime = createRuntime();
    runtime.youtube = {
      initialize: async () => {
        throw new Error("reconnect failed");
      },
    };

    await runtime.handleStreamDetected("youtube", {
      eventType: "stream-detected",
      newStreamIds: ["test-stream-1"],
    });
  });

  it("routes follow/share/paypiggy notifications through unified handler", async () => {
    const calls = createNotificationCalls();
    const notificationManager = createRecordingNotificationManager(calls);
    const runtime = createRuntime({ notificationManager });

    await runtime.handleFollowNotification("twitch", "test-user", {
      userId: "test-user-id",
      timestamp: "2024-01-01T00:00:00.000Z",
    });
    await runtime.handleShareNotification("twitch", "test-user", {
      userId: "test-user-id",
      timestamp: "2024-01-01T00:00:00.000Z",
    });
    await runtime.handlePaypiggyNotification("twitch", "test-user", {
      userId: "test-user-id",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    expect(calls.length).toBe(3);
    expect(getNotificationCall(calls, 0)[0]).toBe("platform:follow");
    expect(getNotificationCall(calls, 1)[0]).toBe("platform:share");
    expect(getNotificationCall(calls, 2)[0]).toBe("platform:paypiggy");
  });

  it("requires a command for farewell notifications", async () => {
    const runtime = createRuntime();

    await expect(
      runtime.handleFarewellNotification("twitch", "test-user", {}),
    ).rejects.toThrow("handleFarewellNotification requires command");
  });

  it("fails gift notifications when VFX service is missing", async () => {
    const runtime = createRuntime();
    setRuntimeProperty(runtime, "vfxCommandService", null);

    await expect(
      runtime.handleGiftNotification("twitch", "test-user", {
        type: "platform:gift",
        isError: true,
        userId: "test-user-id",
        timestamp: "2024-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("VFXCommandService unavailable for gift notification");
  });

  it("continues gift notifications when VFX lookup fails", async () => {
    const calls = createNotificationCalls();
    const notificationManager = createRecordingNotificationManager(calls);
    const runtime = createRuntime({
      notificationManager,
      vfxCommandService: {
        getVFXConfig: createMockFn().mockRejectedValue(
          new Error("vfx lookup failed"),
        ),
      },
    });
    const handled: unknown[][] = [];
    setRuntimeProperty(runtime, "errorHandler", {
      handleEventProcessingError: (...args: unknown[]) => handled.push(args),
      logOperationalError: createMockFn(),
    });

    await runtime.handleGiftNotification("twitch", "test-user", {
      type: "platform:gift",
      userId: "test-user-id",
      timestamp: "2024-01-01T00:00:00.000Z",
      giftType: "Rose",
      giftCount: 1,
      amount: 5,
      currency: "USD",
      id: "test-gift-1",
    });

    expect(handled.length).toBe(1);
    expect(calls.length).toBe(1);
  });

  it("routes giftpaypiggy notifications through error handler on failure", async () => {
    const runtime = createRuntime();
    const handled: unknown[][] = [];
    setRuntimeProperty(runtime, "errorHandler", {
      handleEventProcessingError: (...args: unknown[]) => handled.push(args),
      logOperationalError: createMockFn(),
    });

    const result = await runtime.handleGiftPaypiggyNotification(
      "twitch",
      "test-user",
      { userId: "test-user-id" },
    );

    expect(handled.length).toBe(1);
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        notificationType: "platform:giftpaypiggy",
        platform: "twitch",
      }),
    );
  });

  it("returns failed result shape when gift notification username is missing", async () => {
    const runtime = createRuntime();

    const result = await runtime.handleGiftNotification("twitch", "", {
      type: "platform:gift",
      userId: "test-user-id",
      timestamp: "2024-01-01T00:00:00.000Z",
      giftType: "Rose",
      giftCount: 1,
      amount: 5,
      currency: "USD",
      id: "test-gift-missing-user",
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: "Missing username for gift notification",
        notificationType: "platform:gift",
        platform: "twitch",
      }),
    );
  });

  it("routes chat errors through runtime handler when router is missing", async () => {
    const runtime = createRuntime();
    setRuntimeProperty(runtime, "chatNotificationRouter", null);
    const handled: unknown[][] = [];
    setRuntimeProperty(runtime, "errorHandler", {
      handleEventProcessingError: (...args: unknown[]) => handled.push(args),
      logOperationalError: createMockFn(),
    });

    await runtime.handleChatMessage("twitch", {
      username: "test-user",
      message: "Hello",
    });

    expect(handled.length).toBe(1);
  });
});
