import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import {
  runOnlyPendingTimers,
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
import { AppRuntime } from "../../../src/runtime/AppRuntime";

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
  beforeEach(() => {
    testClock.reset();
  });

  afterEach(() => {
    testClock.useRealTime();
    useRealTimers();
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
    ).rejects.toThrow("handleRaidNotification requires viewerCount");
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

  it("updates viewer count and swallows observer errors", async () => {
    const runtime = createRuntime();
    setRuntimeProperty(runtime, "viewerCountSystem", {
      counts: { twitch: 1 },
      notifyObservers: () => Promise.reject(new Error("observer failed")),
    });

    runtime.updateViewerCount("twitch", 5);
    await Promise.resolve();

    expect(runtime.viewerCountSystem.counts.twitch).toBe(5);
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
    const runtime = createRuntime({
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
    const hideAllDisplays = createMockFn().mockResolvedValue();
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
        hideAllDisplays,
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

    expect(hideAllDisplays.mock.calls.length).toBe(1);
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
    const runtime = createRuntime({
      platformLifecycleService: {
        getAllPlatforms: createMockFn().mockReturnValue({}),
        getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
        recordPlatformConnection: createMockFn(),
        initializeAllPlatforms: createMockFn().mockResolvedValue(),
        disconnectAll,
      },
    });
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
