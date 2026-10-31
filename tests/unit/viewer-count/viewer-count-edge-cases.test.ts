import { vi, describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TwitchViewerCountProvider } from "../../../src/utils/viewer-count-providers";
import { TwitchApiClient } from "../../../src/utils/api-clients/twitch-api-client";
import { EnhancedHttpClient } from "../../../src/utils/enhanced-http-client";
import { secrets } from "../../../src/core/secrets";

import {
  useFakeTimers,
  useRealTimers,
  setSystemTime,
  getTimerCount,
} from "../../helpers/bun-timers";
import { ViewerCountSystem } from "../../../src/utils/viewer-count.ts";
import { OBSViewerCountObserver } from "../../../src/observers/obs-viewer-count-observer.ts";
import { safeSetInterval } from "../../../src/utils/timeout-validator.ts";
import { createConfigFixture } from "../../helpers/config-fixture";
import {
  noOpLogger,
} from "../../helpers/mock-factories";
import { OBSConnectionManager } from "../../../src/obs/connection";
import { EventEmitter } from "node:events";
import testClock from "../../helpers/test-clock";

type EdgeCaseViewerCount = unknown;

type HttpSlotConfig = {
  returnValue?: EdgeCaseViewerCount;
  shouldThrow?: boolean;
  errorMessage?: string;
  responseSequence?: EdgeCaseViewerCount[];
};

type HttpSlot = {
  provider: TwitchViewerCountProvider;
  respond: (next: () => Promise<unknown>) => void;
  getCallCount: () => number;
};

type HttpSlots = Record<string, HttpSlot>;

type EdgeCaseEnvironmentConfig = {
  pollingInterval?: number;
  platforms?: Record<string, HttpSlotConfig>;
};

type ViewerCountUpdate = {
  platform: string;
  count: number;
  previousCount?: number;
  isStreamLive: boolean;
  timestamp: Date;
};

type StreamStatusUpdate = {
  platform: string;
  isLive: boolean;
  wasLive: boolean;
  timestamp: Date;
};

type EdgeCaseObserverBehavior = {
  shouldThrowOnUpdate?: boolean;
  shouldThrowOnStatusChange?: boolean;
  throwAfterCalls?: number | null;
};

type EdgeCaseObserver = {
  observerId: string;
  receivedUpdates: ViewerCountUpdate[];
  statusChanges: StreamStatusUpdate[];
  initializationCompleted: boolean;
  cleanupCompleted: boolean;
  relatedObserver?: EdgeCaseObserver;
  largeData?: string[];
  getObserverId: () => string;
  onViewerCountUpdate: (update: ViewerCountUpdate) => Promise<void>;
  onStreamStatusChange: (statusUpdate: StreamStatusUpdate) => Promise<void>;
  initialize: () => Promise<void>;
  cleanup: () => Promise<void>;
};

type ViewerCountSystemUnderTest = InstanceType<typeof ViewerCountSystem>;

const requireUpdate = (
  observer: EdgeCaseObserver,
  index: number,
): ViewerCountUpdate => {
  const update = observer.receivedUpdates[index];
  expect(update).toBeDefined();
  if (!update) {
    throw new Error(`Expected viewer count update at index ${index}`);
  }
  return update;
};

const requirePlatform = (
  platforms: HttpSlots,
  platformName: string,
): HttpSlot => {
  const platform = platforms[platformName];
  expect(platform).toBeDefined();
  if (!platform) {
    throw new Error(`Expected HTTP slot ${platformName}`);
  }
  return platform;
};

const requireStatusHistory = (
  system: ViewerCountSystemUnderTest,
  platformName: string,
) => {
  const history = system.statusChangeHistory.get(platformName);
  expect(history).toBeDefined();
  if (!history) {
    throw new Error(`Expected status history for ${platformName}`);
  }
  return history;
};

// Each store slot uses the real Twitch HTTP provider. These cases exercise the store's
// common poll contract, not TikTok or YouTube provider-specific ingress.
const createHttpProvider = (initial: unknown = 100) => {
  let response: () => Promise<unknown> = async () => initial;
  const attempts: string[] = [];
  const http = new EnhancedHttpClient({ logger: noOpLogger, axios: {
    get: async (url) => {
      attempts.push(url);
      const count = await response();
      return { data: { data: [{ viewer_count: count }] } };
    },
    post: async () => ({}), put: async () => ({}), delete: async () => ({}),
  } });
  const provider = new TwitchViewerCountProvider(
    new TwitchApiClient(null, {}, noOpLogger, { enhancedHttpClient: http }),
    null, { channel: "synthetic-channel" }, null, noOpLogger,
  );
  return { provider, attempts, respond: (next: () => Promise<unknown>) => { response = next; } };
};
const ownedSystems: ViewerCountSystem[] = [];
const ownSystem = (system: ViewerCountSystem) => { ownedSystems.push(system); return system; };
const drain = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
let savedToken: string | null;

const createHttpSlot = (config: HttpSlotConfig = {}): HttpSlot => {
  const h = createHttpProvider();
  h.respond(async () => {
    if (config.shouldThrow) throw new Error(config.errorMessage ?? "Platform API error");
    const index = Math.min(h.attempts.length - 1, (config.responseSequence?.length ?? 1) - 1);
    return config.responseSequence?.length ? config.responseSequence[index] : config.returnValue ?? 0;
  });
  return { provider: h.provider,
    respond: h.respond, getCallCount: () => h.attempts.length };
};
const ownedObs: OBSConnectionManager[] = [];
const createObsBoundary = async (call: (method: string, data: Record<string, unknown>) => Promise<unknown> = async () => ({})) => {
  class Socket extends EventEmitter {
    async connect() { this.emit("Identified"); return {}; }
    async disconnect() {}
    async call(method: string, data: Record<string, unknown> = {}) { return call(method, data); }
  }
  const socket = new Socket();
  const manager = new OBSConnectionManager({ obs: socket, config: { enabled: true, address: "ws://synthetic.invalid", password: "synthetic", connectionTimeoutMs: 5000 } });
  ownedObs.push(manager);
  await manager.connect();
  return manager;
};
const obsConfig = () => createConfigFixture({
  general: { envFileReadEnabled: false, envFileWriteEnabled: false, logChatMessages: false },
  logging: { fileLoggingEnabled: false },
  tiktok: { viewerCountEnabled: true, viewerCountSource: "synthetic-tiktok-viewers" },
  twitch: { viewerCountEnabled: true, viewerCountSource: "synthetic-twitch-viewers" },
  youtube: { viewerCountEnabled: true, viewerCountSource: "synthetic-youtube-viewers" },
});

const createEdgeCaseTestEnvironment = (config: EdgeCaseEnvironmentConfig = {}) => {
  const {
    pollingInterval = 1,
    platforms = { tiktok: {}, twitch: {}, youtube: {} },
  } = config;

  const httpSlots: HttpSlots = {};
  Object.entries(platforms).forEach(([platformName, platformConfig]) => {
    httpSlots[platformName] = createHttpSlot(platformConfig);
  });

  const system = ownSystem(new ViewerCountSystem({
    platformProvider: () => Object.fromEntries(Object.entries(httpSlots).map(([name, h]) => [name, h.provider])),
    config: createConfigFixture({
      general: { viewerCountPollingIntervalMs: pollingInterval, envFileReadEnabled: false, envFileWriteEnabled: false, logChatMessages: false },
      logging: { fileLoggingEnabled: false },
    }),
    logger: noOpLogger,
  }));

  return { system, httpSlots };
};

const createEdgeCaseObserver = (
  observerId = "edge-case-observer",
  edgeCaseBehavior: EdgeCaseObserverBehavior = {},
): EdgeCaseObserver => {
  const {
    shouldThrowOnUpdate = false,
    shouldThrowOnStatusChange = false,
    throwAfterCalls = null,
  } = edgeCaseBehavior;

  let updateCallCount = 0;

  return {
    observerId,
    receivedUpdates: [],
    statusChanges: [],
    initializationCompleted: false,
    cleanupCompleted: false,

    getObserverId() {
      return this.observerId;
    },

    async onViewerCountUpdate(update) {
      updateCallCount++;

      if (
        shouldThrowOnUpdate ||
        (throwAfterCalls && updateCallCount > throwAfterCalls)
      ) {
        throw new Error("Observer processing failed");
      }

      this.receivedUpdates.push(update);
    },

    async onStreamStatusChange(statusUpdate) {
      if (shouldThrowOnStatusChange) {
        throw new Error("Observer status processing failed");
      }

      this.statusChanges.push(statusUpdate);
    },

    async initialize() {
      this.initializationCompleted = true;
    },

    async cleanup() {
      this.cleanupCompleted = true;
    },
  };
};

const expectSystemStability = (system: ViewerCountSystemUnderTest) => {
  expect(system).toBeDefined();
  expect(typeof system.isPolling).toBe("boolean");
  expect(typeof system.getViewerCounts()).toBe("object");
  expect(system.observers).toBeInstanceOf(Map);
};

describe("Viewer Count & OBS Observer Edge Case Tests", () => {
  beforeEach(() => { savedToken = secrets.twitch.accessToken; secrets.twitch.accessToken = "synthetic-token"; useFakeTimers(); });
  afterEach(async () => {
    for (const system of ownedSystems.splice(0)) await system.cleanup();
    for (const manager of ownedObs.splice(0)) { await manager.disconnect(); manager.dispose(); }
    await drain();
    expect(getTimerCount()).toBe(0);
    secrets.twitch.accessToken = savedToken;
    vi.restoreAllMocks(); useRealTimers();
  });

  describe("Extreme Viewer Count Edge Cases", () => {
    test("should handle zero viewer counts gracefully without errors", async () => {
      const { system } = createEdgeCaseTestEnvironment({
        platforms: { tiktok: { returnValue: 0 } },
      });
      const observer = createEdgeCaseObserver("zero-count-observer");
      system.addObserver(observer);

      await system.notifyObservers("tiktok", 0, 100);

      expect(observer.receivedUpdates).toHaveLength(1);
      expect(requireUpdate(observer, 0).count).toBe(0);
      expect(requireUpdate(observer, 0).previousCount).toBe(100);
      expectSystemStability(system);
    });

    test("notifyObservers passes through negative values without validating the store", async () => {
      const { system } = createEdgeCaseTestEnvironment({
        platforms: { twitch: { returnValue: -500 } },
      });
      const observer = createEdgeCaseObserver("negative-count-observer");
      system.addObserver(observer);

      await system.notifyObservers("twitch", -500, 200);

      expect(observer.receivedUpdates).toHaveLength(1);
      expect(requireUpdate(observer, 0).count).toBe(-500);
      expectSystemStability(system);
      const update = requireUpdate(observer, 0);
      expect(typeof update.count === "number" && update.count < 0).toBe(true);
    });

    test("delivers the exact large viewer count", async () => {
      const largeCount = 999999999;
      const { system } = createEdgeCaseTestEnvironment({
        platforms: { youtube: { returnValue: largeCount } },
      });
      const observer = createEdgeCaseObserver("large-count-observer");
      system.addObserver(observer);

      await system.notifyObservers("youtube", largeCount, 1000000);

      expect(observer.receivedUpdates).toHaveLength(1);
      expect(requireUpdate(observer, 0).count).toBe(largeCount);
      expectSystemStability(system);
    });

    test("notifyObservers passes through Infinity", async () => {
      const { system } = createEdgeCaseTestEnvironment();

      const observer = createEdgeCaseObserver("infinity-observer");
      system.addObserver(observer);

      await system.notifyObservers("tiktok", Infinity, 500);

      expect(observer.receivedUpdates).toHaveLength(1);
      expect(requireUpdate(observer, 0).count).toBe(Infinity);
      expectSystemStability(system);
    });

    test("notifyObservers delivers NaN then the next valid notification", async () => {
      const { system } = createEdgeCaseTestEnvironment();

      const observer = createEdgeCaseObserver("nan-observer");
      system.addObserver(observer);

      await system.notifyObservers("twitch", NaN, 300);

      expect(observer.receivedUpdates).toHaveLength(1);
      expect(Number.isNaN(requireUpdate(observer, 0).count)).toBe(true);
      expectSystemStability(system);

      await system.notifyObservers("twitch", 400, 300);
      expect(observer.receivedUpdates).toHaveLength(2);
      expect(requireUpdate(observer, 1).count).toBe(400);
    });

    test("notifyObservers preserves fractional values", async () => {
      const floatCount = 1234.5678;
      const { system } = createEdgeCaseTestEnvironment({
        platforms: { tiktok: { returnValue: floatCount } },
      });

      const observer = createEdgeCaseObserver("float-observer");
      system.addObserver(observer);

      await system.notifyObservers("tiktok", floatCount, 1200);

      expect(observer.receivedUpdates).toHaveLength(1);
      expect(requireUpdate(observer, 0).count).toBe(floatCount);
      expectSystemStability(system);

    });
  });

  describe("Platform API Response Edge Cases", () => {
    test("should continue operation when platform API completely fails", async () => {
      const { system, httpSlots } = createEdgeCaseTestEnvironment({ platforms: { tiktok: { shouldThrow: true, errorMessage: "Network timeout" }, twitch: { returnValue: 500 } } });
      await system.updateStreamStatus("tiktok", true);
      await system.updateViewerCount("tiktok", 42);
      const observer = createEdgeCaseObserver("failed-and-healthy"); system.addObserver(observer);
      await system.pollPlatform("tiktok"); await system.pollPlatform("twitch");
      expect(requirePlatform(httpSlots, "tiktok").getCallCount()).toBe(1);
      expect(requirePlatform(httpSlots, "twitch").getCallCount()).toBe(1);
      expect(requirePlatform(httpSlots, "tiktok").provider.getErrorStats()).toMatchObject({ totalErrors: 1, lastError: "Network timeout" });
      expect(system.getViewerCounts()).toEqual({ tiktok: 42, twitch: 500, youtube: 0 });
      expect(observer.receivedUpdates.map(u => [u.platform, u.count])).toEqual([["twitch", 500]]);
    });

    test("should handle malformed API responses gracefully", async () => {
      const { system, httpSlots } = createEdgeCaseTestEnvironment({
        platforms: {
          youtube: { returnValue: "not-a-number" },
        },
      });

      const observer = createEdgeCaseObserver("malformed-observer");
      await system.updateViewerCount("youtube", 42);
      system.addObserver(observer);

      await system.updateStreamStatus("youtube", true);
      await system.pollPlatform("youtube");

      const boundary = requirePlatform(httpSlots, "youtube");
      expect(boundary.getCallCount()).toBe(1);
      expect(observer.receivedUpdates).toHaveLength(0);
      expect(system.getViewerCount("youtube")).toBe(42);
      boundary.respond(async () => 250); await system.pollPlatform("youtube");
      expect(boundary.getCallCount()).toBe(2);
      expect(system.getViewerCount("youtube")).toBe(250);
      expect(observer.receivedUpdates.map(u => [u.count, u.previousCount])).toEqual([[250, 42]]);
      expectSystemStability(system);
    });

    test("should handle partial platform failures without affecting others", async () => {
      const { system, httpSlots } = createEdgeCaseTestEnvironment({ platforms: { tiktok: { shouldThrow: true }, twitch: { returnValue: 300 }, youtube: { returnValue: 150 } } });
      await system.updateStreamStatus("tiktok", true); await system.updateStreamStatus("youtube", true);
      await system.updateViewerCount("tiktok", 42);
      const observer = createEdgeCaseObserver("partial"); system.addObserver(observer);
      await Promise.all(["tiktok", "twitch", "youtube"].map(name => system.pollPlatform(name)));
      expect(Object.values(httpSlots).map(h => h.getCallCount())).toEqual([1, 1, 1]);
      expect(system.getViewerCounts()).toEqual({ tiktok: 42, twitch: 300, youtube: 150 });
      expect(observer.receivedUpdates.map(u => [u.platform, u.count])).toEqual([["twitch", 300], ["youtube", 150]]);
    });

    test("retains last good on provider rate-limit errors (without claiming retry policy)", async () => {
      const { system, httpSlots } = createEdgeCaseTestEnvironment({ platforms: { tiktok: {} } });
      const boundary = requirePlatform(httpSlots, "tiktok");
      boundary.respond(async () => {
        if (boundary.getCallCount() > 3) throw new Error("Rate limit exceeded");
        return [100, 150, 200][boundary.getCallCount() - 1];
      });
      await system.updateStreamStatus("tiktok", true);
      const observer = createEdgeCaseObserver("rate-limit"); system.addObserver(observer);
      for (let i = 0; i < 5; i++) await system.pollPlatform("tiktok");
      expect(boundary.getCallCount()).toBe(5);
      expect(boundary.provider.getErrorStats()).toMatchObject({ totalErrors: 2, consecutiveErrors: 2, lastError: "Rate limit exceeded" });
      expect(observer.receivedUpdates.map(u => u.count)).toEqual([100, 150, 200]);
      expect(system.getViewerCount("tiktok")).toBe(200);
    });

    test("held external response prevents same-slot overlap and permits the next poll", async () => {
      const { system, httpSlots } = createEdgeCaseTestEnvironment({ platforms: { youtube: {} } });
      const boundary = requirePlatform(httpSlots, "youtube");
      const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<number>();
      boundary.respond(async () => { entered.resolve(); return release.promise; });
      await system.updateStreamStatus("youtube", true);
      await system.updateViewerCount("youtube", 42);
      const poll = system.pollPlatform("youtube");
      try {
        await entered.promise; await system.pollPlatform("youtube");
        expect(boundary.getCallCount()).toBe(1); expect(system.getViewerCount("youtube")).toBe(42);
        release.resolve(250); await poll;
        expect(system.getViewerCount("youtube")).toBe(250);
        await system.pollPlatform("youtube"); expect(boundary.getCallCount()).toBe(2);
      } finally { release.resolve(250); await poll; }
    });

    test("should recover from temporary API failures automatically", async () => {
      const { system, httpSlots } = createEdgeCaseTestEnvironment({ platforms: { twitch: {} } });
      const boundary = requirePlatform(httpSlots, "twitch");
      boundary.respond(async () => { if (boundary.getCallCount() <= 3) throw new Error("Temporary failure"); return 400; });
      await system.updateViewerCount("twitch", 42);
      const observer = createEdgeCaseObserver("recovery"); system.addObserver(observer);
      for (let i = 0; i < 3; i++) await system.pollPlatform("twitch");
      expect(system.getViewerCount("twitch")).toBe(42); expect(observer.receivedUpdates).toEqual([]);
      expect(boundary.provider.getErrorStats()).toMatchObject({ totalErrors: 3, consecutiveErrors: 3 });
      for (let i = 0; i < 2; i++) await system.pollPlatform("twitch");
      expect(boundary.getCallCount()).toBe(5); expect(system.getViewerCount("twitch")).toBe(400);
      expect(boundary.provider.getErrorStats().consecutiveErrors).toBe(0);
      expect(observer.receivedUpdates.map(u => [u.count, u.previousCount])).toEqual([[400, 42], [400, 400]]);
    });
  });

  describe("Configuration Edge Cases", () => {
    test("should handle negative polling intervals by disabling polling", () => {
      const { system } = createEdgeCaseTestEnvironment({
        pollingInterval: -30,
      });

      const startOperation = () => system.startPolling();

      expect(startOperation).not.toThrow();
      expectSystemStability(system);
      expect(system.isPolling).toBe(false);
      expect(system.pollingHandles).toEqual({});
    });

    test("should handle zero polling interval gracefully", () => {
      const { system } = createEdgeCaseTestEnvironment({
        pollingInterval: 0,
      });

      const startOperation = () => system.startPolling();

      expect(startOperation).not.toThrow();
      expectSystemStability(system);
      expect(system.isPolling).toBe(false);
      expect(system.pollingHandles).toEqual({});
    });

    test("throws when config is null", () => {
      expect(
        () =>
          new ViewerCountSystem({
            platformProvider: () => ({}),
            config: null as never,
            logger: noOpLogger,
          }),
      ).toThrow("ViewerCountSystem requires config");
    });

    test("throws when config.general is missing", () => {
      expect(
        () =>
          new ViewerCountSystem({
            platformProvider: () => ({}),
            config: {},
            logger: noOpLogger,
          }),
      ).toThrow();
    });

    test("handles undefined pollingIntervalMs gracefully", () => {
      const system = ownSystem(new ViewerCountSystem({
        platformProvider: () => ({}),
        config: createConfigFixture({
          general: { viewerCountPollingIntervalMs: undefined, envFileReadEnabled: false, envFileWriteEnabled: false, logChatMessages: false },
          logging: { fileLoggingEnabled: false },
        }),
        logger: noOpLogger,
      }));

      expect(system.pollingIntervalMs).toBeUndefined();
      expectSystemStability(system);
    });

    test("reads pollingIntervalMs from config", () => {
      const system = ownSystem(new ViewerCountSystem({
        platformProvider: () => ({}),
        config: createConfigFixture({
          general: { viewerCountPollingIntervalMs: 5000, envFileReadEnabled: false, envFileWriteEnabled: false, logChatMessages: false },
          logging: { fileLoggingEnabled: false },
        }),
        logger: noOpLogger,
      }));

      expect(system.pollingIntervalMs).toBe(5000);
      expectSystemStability(system);
    });
  });

  describe("Observer Pattern Edge Cases", () => {
    test("should isolate and continue when observer throws exceptions", async () => {
      const { system } = createEdgeCaseTestEnvironment();

      const workingObserver = createEdgeCaseObserver("working-observer");
      const failingObserver = createEdgeCaseObserver("failing-observer", {
        shouldThrowOnUpdate: true,
      });

      system.addObserver(workingObserver);
      system.addObserver(failingObserver);

      await system.notifyObservers("tiktok", 100, 50);

      expect(workingObserver.receivedUpdates).toHaveLength(1);
      expectSystemStability(system);
    });

    test("starts all observer callbacks and awaits the held callback settlement", async () => {
      const { system } = createEdgeCaseTestEnvironment();
      const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
      const order: string[] = [];
      system.addObserver({ getObserverId: () => "held", onViewerCountUpdate: async update => { order.push(`held:${update.count}`); entered.resolve(); await release.promise; order.push("released"); } });
      system.addObserver({ getObserverId: () => "following", onViewerCountUpdate: update => { order.push(`following:${update.count}`); } });
      let completed = false;
      const update = system.updateViewerCount("youtube", 150).then(() => { completed = true; });
      try {
        await entered.promise; await drain();
        expect(system.getViewerCount("youtube")).toBe(150);
        expect(completed).toBe(false);
        expect(order).toEqual(["held:150", "following:150"]);
        release.resolve(); await update;
        expect(completed).toBe(true);
        expect(order).toEqual(["held:150", "following:150", "released"]);
      } finally { release.resolve(); await update; }
    });

    test("should handle observer memory issues without system crash", async () => {
      const { system } = createEdgeCaseTestEnvironment();

      const memoryIntensiveObserver = createEdgeCaseObserver("memory-observer");

      memoryIntensiveObserver.onViewerCountUpdate = async function (update: ViewerCountUpdate) {
        this.receivedUpdates.push(update);
        this.largeData = new Array(10000).fill("memory-test");
      };

      system.addObserver(memoryIntensiveObserver);

      for (let i = 0; i < 100; i++) {
        await system.notifyObservers("tiktok", i, i - 1);
      }

      expect(memoryIntensiveObserver.receivedUpdates).toHaveLength(100);
      expectSystemStability(system);
    });

    test("should handle circular observer dependencies without infinite loops", async () => {
      const { system } = createEdgeCaseTestEnvironment();

      const observer1 = createEdgeCaseObserver("circular-observer-1");
      const observer2 = createEdgeCaseObserver("circular-observer-2");

      observer1.relatedObserver = observer2;
      observer2.relatedObserver = observer1;

      system.addObserver(observer1);
      system.addObserver(observer2);

      await system.notifyObservers("twitch", 200, 150);

      expect(observer1.receivedUpdates).toHaveLength(1);
      expect(observer2.receivedUpdates).toHaveLength(1);
      expectSystemStability(system);
    });

    test("should handle observer that becomes corrupted during operation", async () => {
      const { system } = createEdgeCaseTestEnvironment();

      const corruptingObserver = createEdgeCaseObserver("corrupting-observer");

      let updateCount = 0;
      const originalUpdate = corruptingObserver.onViewerCountUpdate;
      corruptingObserver.onViewerCountUpdate = async function (update: ViewerCountUpdate) {
        updateCount++;
        if (updateCount === 1) {
          await originalUpdate.call(this, update);
          delete (this as { getObserverId?: () => string }).getObserverId;
          this.receivedUpdates = null as never;
        } else {
          throw new Error("Observer corrupted");
        }
      };

      system.addObserver(corruptingObserver);

      await system.notifyObservers("youtube", 100, 50);
      await system.notifyObservers("youtube", 120, 100);

      expect(updateCount).toBe(2);
      expectSystemStability(system);
    });

    test("should handle rapid observer addition and removal during operation", async () => {
      const { system } = createEdgeCaseTestEnvironment();

      for (let i = 0; i < 20; i++) {
        const observer = createEdgeCaseObserver(`dynamic-observer-${i}`);
        system.addObserver(observer);

        if (i % 3 === 0) {
          system.removeObserver(`dynamic-observer-${i - 3}`);
        }

        await system.notifyObservers("tiktok", i * 10, (i - 1) * 10);
      }

      expect([...system.observers.keys()]).toEqual(Array.from({ length: 20 }, (_, i) => `dynamic-observer-${i}`).filter((_, i) => ![0, 3, 6, 9, 12, 15].includes(i)));
      expectSystemStability(system);
    });
  });

  describe("System State Edge Cases", () => {
    test("should handle rapid online/offline transitions without state corruption", async () => {
      const { system } = createEdgeCaseTestEnvironment();

      const observer = createEdgeCaseObserver("rapid-transition-observer");
      system.addObserver(observer);

      const transitions = [
        { platform: "tiktok", isLive: false },
        { platform: "tiktok", isLive: true },
        { platform: "tiktok", isLive: false },
        { platform: "tiktok", isLive: true },
      ];

      for (const transition of transitions) {
        await system.updateStreamStatus(transition.platform, transition.isLive);
      }

      expect(observer.statusChanges.map(u => u.isLive)).toEqual([true, false, true]);
      expect(system.isStreamLive("tiktok")).toBe(true);
      expectSystemStability(system);
    });

    test("should handle concurrent operations without race conditions", async () => {
      const { system, httpSlots } = createEdgeCaseTestEnvironment({ platforms: { tiktok: {}, twitch: { returnValue: 200 } } });
      const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<number>();
      const boundary = requirePlatform(httpSlots, "tiktok");
      boundary.respond(async () => { entered.resolve(); return release.promise; });
      await system.updateStreamStatus("tiktok", true);
      const observer = createEdgeCaseObserver("concurrent"); system.addObserver(observer);
      const poll = system.pollPlatform("tiktok");
      try {
        await entered.promise; await system.pollPlatform("twitch");
        await system.updateStreamStatus("youtube", true); await system.updateViewerCount("youtube", 300);
        await system.updateStreamStatus("tiktok", false);
        release.resolve(100); await poll;
        expect(boundary.getCallCount()).toBe(1);
        expect(system.getViewerCounts()).toEqual({ tiktok: 0, twitch: 200, youtube: 300 });
        expect(observer.receivedUpdates.map(u => [u.platform, u.count])).toEqual([["twitch", 200], ["youtube", 300], ["tiktok", 0]]);
        expect(observer.statusChanges.map(u => [u.platform, u.isLive])).toEqual([["youtube", true], ["tiktok", false]]);
      } finally { release.resolve(100); await poll; }
    });

    test("should maintain system stability during shutdown while operations are active", async () => {
      const { system } = createEdgeCaseTestEnvironment();

      const observer = createEdgeCaseObserver("shutdown-observer");
      system.addObserver(observer);

      system.startPolling();

      const operationPromise = system.notifyObservers("tiktok", 100, 50);
      await system.cleanup();
      await operationPromise;

      expectSystemStability(system);
    });

    test("delivers to every registered observer at 1000 observers", async () => {
      const { system } = createEdgeCaseTestEnvironment();

      for (let i = 0; i < 1000; i++) {
        const observer = createEdgeCaseObserver(`resource-observer-${i}`);
        system.addObserver(observer);
      }

      await system.notifyObservers("tiktok", 500, 400);

      expect(system.observers.size).toBe(1000);
      for (const observer of system.observers.values()) {
        expect((observer as EdgeCaseObserver).receivedUpdates).toEqual([expect.objectContaining({ platform: "tiktok", count: 500, previousCount: 400 })]);
      }
      expectSystemStability(system);
    });

    test("should handle clock changes and timezone issues appropriately", async () => {
      const { system } = createEdgeCaseTestEnvironment();

      const observer = createEdgeCaseObserver("time-observer");
      system.addObserver(observer);

      const futureDate = new Date(testClock.now() + 86400000);

      await system.notifyObservers("tiktok", 100, 50);

      setSystemTime(futureDate);

      await system.notifyObservers("twitch", 200, 150);

      expect(observer.receivedUpdates).toHaveLength(2);
      expect(requireUpdate(observer, 0).timestamp).toBeInstanceOf(Date);
      expect(requireUpdate(observer, 1).timestamp).toBeInstanceOf(Date);
      expectSystemStability(system);
    });
  });

  describe("OBS Integration Edge Cases", () => {
    for (const [platform, count, message] of [
      ["youtube", 1000, 'Source "synthetic-youtube-viewers" not found'],
      ["twitch", 500, "Source is not a text source"],
      ["tiktok", 750, "WebSocket protocol error"],
    ] as const) {
      test(`OBS external failure then recovery: ${message}`, async () => {
        const calls: Array<[string, Record<string, unknown>]> = [];
        let fail = true;
        const manager = await createObsBoundary(async (method, data) => {
          calls.push([method, data]); if (fail) throw new Error(message); return {};
        });
        const observer = new OBSViewerCountObserver(manager, noOpLogger, { config: obsConfig() });
        const update = { platform, count, isStreamLive: true };
        await observer.onViewerCountUpdate(update); fail = false; await observer.onViewerCountUpdate(update);
        expect(calls).toEqual(Array.from({ length: 2 }, () => ["SetInputSettings", { inputName: `synthetic-${platform}-viewers`, inputSettings: { text: count === 1000 ? "1K" : String(count) }, overlay: true }]));
      });
    }
    test("awaits a held external OBS write while another platform count completes", async () => {
      const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
      const writes: string[] = [];
      const manager = await createObsBoundary(async (_method, data) => {
        writes.push(String(data.inputName));
        if (data.inputName === "synthetic-youtube-viewers") { entered.resolve(); await release.promise; }
        return {};
      });
      const observer = new OBSViewerCountObserver(manager, noOpLogger, { config: obsConfig() });
      let completed = false;
      const update = observer.onViewerCountUpdate({ platform: "youtube", count: 1200, isStreamLive: true }).then(() => { completed = true; });
      try {
        await entered.promise; expect(completed).toBe(false);
        await observer.onViewerCountUpdate({ platform: "twitch", count: 300, isStreamLive: true });
        expect(writes).toEqual(["synthetic-youtube-viewers", "synthetic-twitch-viewers"]);
        expect(completed).toBe(false);
        release.resolve(); await update; expect(completed).toBe(true);
      } finally { release.resolve(); await update; await observer.cleanup(); }
    });
    test("OBS scene source disappearance does not prevent a later recovered write", async () => {
      const calls: Record<string, unknown>[] = [];
      let sourceExists = true;
      const manager = await createObsBoundary(async (_method, data) => { calls.push(data); if (!sourceExists) throw new Error("Source not found in current scene"); return {}; });
      const observer = new OBSViewerCountObserver(manager, noOpLogger, { config: obsConfig() });
      await observer.onViewerCountUpdate({ platform: "twitch", count: 300, isStreamLive: true });
      sourceExists = false; await observer.onViewerCountUpdate({ platform: "twitch", count: 350, isStreamLive: true });
      sourceExists = true; await observer.onViewerCountUpdate({ platform: "twitch", count: 400, isStreamLive: true });
      expect(calls.map(data => data.inputSettings)).toEqual([{ text: "300" }, { text: "350" }, { text: "400" }]);
    });
  });

  describe("Platform Connection Edge Cases", () => {
    test("should handle platform API format changes gracefully", async () => {
      const { system, httpSlots } = createEdgeCaseTestEnvironment({
        platforms: {
          tiktok: {
            responseSequence: [200, { viewers: 250 }, "300 viewers", [350]],
          },
        },
      });

      const observer = createEdgeCaseObserver("format-change-observer");
      system.addObserver(observer);
      await system.updateStreamStatus("tiktok", true);

      for (let i = 0; i < 4; i++) {
        await system.pollPlatform("tiktok");
      }

      expect(observer.receivedUpdates).toHaveLength(1);
      expect(requireUpdate(observer, 0).count).toBe(200);
      const boundary = requirePlatform(httpSlots, "tiktok");
      expect(boundary.getCallCount()).toBe(4);
      expect(boundary.provider.getErrorStats()).toMatchObject({ totalErrors: 3, consecutiveErrors: 3 });
      expect(system.getViewerCount("tiktok")).toBe(200);
      boundary.respond(async () => 400); await system.pollPlatform("tiktok");
      expect(boundary.getCallCount()).toBe(5); expect(system.getViewerCount("tiktok")).toBe(400);
      expect(observer.receivedUpdates.map(u => u.count)).toEqual([200, 400]);
      expectSystemStability(system);
    });

    test("should handle unexpected platform events without disruption", async () => {
      const unexpectedValues = [
        null,
        undefined,
        {},
        [],
        Symbol("test"),
        () => {},
      ];
      const { system, httpSlots } = createEdgeCaseTestEnvironment({
        platforms: {
          youtube: { responseSequence: unexpectedValues },
        },
      });

      await system.updateViewerCount("youtube", 42);
      const observer = createEdgeCaseObserver("unexpected-event-observer");
      system.addObserver(observer);
      await system.updateStreamStatus("youtube", true);

      for (let index = 0; index < unexpectedValues.length; index++) {
        await system.pollPlatform("youtube");
      }

      const boundary = requirePlatform(httpSlots, "youtube");
      expect(boundary.getCallCount()).toBe(unexpectedValues.length);
      expect(observer.receivedUpdates).toHaveLength(0);
      expect(system.getViewerCount("youtube")).toBe(42);
      boundary.respond(async () => 350); await system.pollPlatform("youtube");
      expect(boundary.getCallCount()).toBe(unexpectedValues.length + 1);
      expect(system.getViewerCount("youtube")).toBe(350);
      expect(observer.receivedUpdates.map(u => [u.count, u.previousCount])).toEqual([[350, 42]]);
      expectSystemStability(system);
    });

    test("should handle platform authentication issues during operation", async () => {
      const { system, httpSlots } = createEdgeCaseTestEnvironment({ platforms: { twitch: {} } });
      const boundary = requirePlatform(httpSlots, "twitch");
      boundary.respond(async () => { if (boundary.getCallCount() > 2) throw Object.assign(new Error("Authentication expired"), { response: { status: 401 } }); return boundary.getCallCount() === 1 ? 100 : 150; });
      const observer = createEdgeCaseObserver("auth"); system.addObserver(observer);
      for (let i = 0; i < 4; i++) await system.pollPlatform("twitch");
      expect(boundary.getCallCount()).toBe(4);
      expect(boundary.provider.getErrorStats()).toMatchObject({ totalErrors: 2, consecutiveErrors: 2, errorTypes: { authentication: 2 } });
      expect(observer.receivedUpdates.map(u => u.count)).toEqual([100, 150]);
      expect(system.getViewerCount("twitch")).toBe(150);
    });

    test("should handle complete platform service outages", async () => {
      const { system, httpSlots } = createEdgeCaseTestEnvironment({
        platforms: {
          tiktok: { shouldThrow: true, errorMessage: "Service unavailable" },
          twitch: { shouldThrow: true, errorMessage: "DNS resolution failed" },
          youtube: { shouldThrow: true, errorMessage: "Connection timeout" },
        },
      });

      const observer = createEdgeCaseObserver("outage-observer");
      system.addObserver(observer);

      for (const platform of Object.keys(httpSlots)) {
        await system.updateStreamStatus(platform, true);
        await system.updateViewerCount(platform, 42);
      }
      observer.receivedUpdates.length = 0;
      for (const platform of Object.keys(httpSlots)) await system.pollPlatform(platform);
      expect(observer.receivedUpdates).toHaveLength(0);
      expect(Object.values(httpSlots).map(h => h.getCallCount())).toEqual([1, 1, 1]);
      expect(system.getViewerCounts()).toEqual({ tiktok: 42, twitch: 42, youtube: 42 });
      expect(Object.values(httpSlots).map(h => h.provider.getErrorStats().lastError)).toEqual(["Service unavailable", "DNS resolution failed", "Connection timeout"]);
      expectSystemStability(system);
    });

    test("should handle mixed platform states efficiently", async () => {
      const { system, httpSlots } = createEdgeCaseTestEnvironment({
        platforms: {
          tiktok: { returnValue: 500 },
          twitch: { shouldThrow: true },
          youtube: { returnValue: 300 },
        },
      });

      const observer = createEdgeCaseObserver("mixed-state-observer");
      system.addObserver(observer);

      for (const platform of Object.keys(httpSlots)) {
        await system.updateStreamStatus(platform, true);
        await system.pollPlatform(platform);
      }

      expect(observer.receivedUpdates.map((update) => update.platform).sort()).toEqual(["tiktok", "youtube"]);
      expect(observer.receivedUpdates.map((update) => update.count).sort()).toEqual([300, 500]);
      expectSystemStability(system);
    });

    test("performs memory optimization housekeeping when limits are exceeded", () => {
      const { system } = createEdgeCaseTestEnvironment();
      const now = testClock.now();

      system.memoryConfig.lastCleanup =
        now - system.memoryConfig.cleanupInterval;
      system.statusChangeHistory.set("tiktok", [
        { timestamp: 1, from: false, to: true, reason: "stream_started" },
        { timestamp: 2, from: true, to: false, reason: "stream_ended" },
        { timestamp: 3, from: false, to: true, reason: "stream_started" },
        { timestamp: 4, from: true, to: false, reason: "stream_ended" },
      ]);
      system.lastStatusUpdate = new Map([
        ["tiktok", 1],
        ["twitch", 2],
        ["youtube", 3],
        ["extra", 4],
      ]);
      system.pollingStats.totalPolls = 15000;
      system.pollingStats.successfulPolls = 12000;

      const originalGc = global.gc;
      const gcSpy = vi.fn<(...args: unknown[]) => unknown>();
      global.gc = async () => {
        gcSpy();
      };

      try {
        system._performMemoryOptimization();
      } finally {
        global.gc = originalGc;
      }

      expect(requireStatusHistory(system, "tiktok").length).toBe(2);
      expect(system.lastStatusUpdate.size).toBe(3);
      expect(system.pollingStats.totalPolls).toBe(1000);
      expect(system.pollingStats.successfulPolls).toBe(1000);
      expect(gcSpy).toHaveBeenCalledTimes(1);
    });

    test("performs memory cleanup by resetting polling and observer state", async () => {
      const { system } = createEdgeCaseTestEnvironment();
      system.addObserver(createEdgeCaseObserver("cleanup-observer"));
      system.statusChangeHistory.set("tiktok", [
        { timestamp: 1, from: false, to: true, reason: "stream_started" },
      ]);
      system.lastStatusUpdate.set("tiktok", 1);
      system.pollingHandles = {
        tiktok: safeSetInterval(() => {}, 1000),
        youtube: safeSetInterval(() => {}, 1000),
      };
      system.memoryOptimizationInterval = safeSetInterval(() => {}, 1000);
      await system.updateViewerCount("tiktok", 123);
      system.pollingStats.totalPolls = 100;

      system._performMemoryCleanup();

      expect(system.pollingHandles).toEqual({});
      expect(system.observers.size).toBe(0);
      expect(system.statusChangeHistory.size).toBe(0);
      expect(system.lastStatusUpdate.size).toBe(0);
      expect(system.getViewerCount("tiktok")).toBe(0);
      expect(system.memoryOptimizationInterval).toBeNull();
      expect(system.pollingStats.totalPolls).toBe(0);
    });
  });
});
