import { vi, describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TwitchViewerCountProvider } from "../../../src/utils/viewer-count-providers";
import { TwitchApiClient } from "../../../src/utils/api-clients/twitch-api-client";
import { EnhancedHttpClient } from "../../../src/utils/enhanced-http-client";
import { secrets } from "../../../src/core/secrets";

import {
  useFakeTimers,
  useRealTimers,
  advanceTimersByTime,
  getTimerCount,
} from "../../helpers/bun-timers";
import { ViewerCountSystem } from "../../../src/utils/viewer-count";
import {
  noOpLogger,
} from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";

type ViewerCountUpdate = {
  platform: string;
  count: number;
  previousCount: number;
  isStreamLive: boolean;
  timestamp: Date;
};

type StreamStatusUpdate = {
  platform: string;
  isLive: boolean;
  wasLive: boolean;
  timestamp: Date;
};

type MockViewerCountObserver = {
  observerId: string;
  receivedUpdates: ViewerCountUpdate[];
  statusChanges: StreamStatusUpdate[];
  initializationCompleted: boolean;
  cleanupCompleted: boolean;
  getObserverId: () => string;
  onViewerCountUpdate: (update: ViewerCountUpdate) => Promise<unknown>;
  onStreamStatusChange: (statusUpdate: StreamStatusUpdate) => Promise<unknown>;
  initialize: () => Promise<unknown>;
  cleanup: () => Promise<unknown>;
};

type MockObserverBehaviorOverrides = Partial<{
  onUpdate: (update: ViewerCountUpdate) => Promise<unknown> | unknown;
  onStatusChange: (statusUpdate: StreamStatusUpdate) => Promise<unknown> | unknown;
  onInitialize: () => Promise<unknown> | unknown;
  onCleanup: () => Promise<unknown> | unknown;
}>;

type ViewerCountPlatformName = "tiktok" | "twitch" | "youtube";
type ViewerCountEnvironmentConfig = {
  pollingInterval?: number;
  initialStreamStatus?: Partial<Record<ViewerCountPlatformName, boolean>>;
};

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createMockViewerCountObserver = (
  observerId = "testObserver",
  behaviorOverrides: MockObserverBehaviorOverrides = {},
): MockViewerCountObserver => {
  return {
    observerId,
    receivedUpdates: [],
    statusChanges: [],
    initializationCompleted: false,
    cleanupCompleted: false,

    getObserverId() {
      return this.observerId;
    },

    async onViewerCountUpdate(update: ViewerCountUpdate) {
      this.receivedUpdates.push(update);
      if (behaviorOverrides.onUpdate) {
        return await behaviorOverrides.onUpdate(update);
      }
      return undefined;
    },

    async onStreamStatusChange(statusUpdate: StreamStatusUpdate) {
      this.statusChanges.push(statusUpdate);
      if (behaviorOverrides.onStatusChange) {
        return await behaviorOverrides.onStatusChange(statusUpdate);
      }
      return undefined;
    },

    async initialize() {
      this.initializationCompleted = true;
      if (behaviorOverrides.onInitialize) {
        return await behaviorOverrides.onInitialize();
      }
      return undefined;
    },

    async cleanup() {
      this.cleanupCompleted = true;
      if (behaviorOverrides.onCleanup) {
        return await behaviorOverrides.onCleanup();
      }
      return undefined;
    },
  };
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
    new TwitchApiClient(null, {}, noOpLogger, { enhancedHttpClient: http }), { channel: "synthetic-channel" }, noOpLogger
  );
  return { provider, attempts, respond: (next: () => Promise<unknown>) => { response = next; } };
};
const ownedSystems: ViewerCountSystem[] = [];
const ownSystem = (system: ViewerCountSystem) => { ownedSystems.push(system); return system; };
const drain = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
let savedToken: string | null;

const buildConfig = (pollingIntervalMs = 60000) => createConfigFixture({
  general: { viewerCountPollingIntervalMs: pollingIntervalMs, envFileReadEnabled: false, envFileWriteEnabled: false, logChatMessages: false },
  logging: { fileLoggingEnabled: false },
});
const createViewerCountTestEnvironment = (envConfig: ViewerCountEnvironmentConfig = {}) => {
  const http = { tiktok: createHttpProvider(), twitch: createHttpProvider(), youtube: createHttpProvider() };
  const platforms = Object.fromEntries(Object.entries(http).map(([name, boundary]) => [name, boundary.provider]));
  const system = ownSystem(new ViewerCountSystem({ platforms, config: buildConfig(envConfig.pollingInterval ?? 1000), logger: noOpLogger }));
  Object.assign(system.streamStatus, envConfig.initialStreamStatus ?? { tiktok: true, twitch: true, youtube: false });
  return { system, http, platforms };
};

const expectValidViewerCountUpdate = (update: ViewerCountUpdate | undefined) => {
  expect(update).toBeDefined();
  if (!update) {
    throw new Error("Expected viewer count update");
  }
  expect(update).toHaveProperty("platform");
  expect(update).toHaveProperty("count");
  expect(update).toHaveProperty("previousCount");
  expect(update).toHaveProperty("isStreamLive");
  expect(update).toHaveProperty("timestamp");

  expect(typeof update.platform).toBe("string");
  expect(typeof update.count).toBe("number");
  expect(typeof update.previousCount).toBe("number");
  expect(typeof update.isStreamLive).toBe("boolean");
  expect(update.timestamp).toBeInstanceOf(Date);

  expect(update.platform).not.toMatch(/\bmock\b|\btest\b|\bfake\b/i);
};

const expectValidStreamStatusChange = (
  statusUpdate: StreamStatusUpdate | undefined,
) => {
  expect(statusUpdate).toBeDefined();
  if (!statusUpdate) {
    throw new Error("Expected stream status update");
  }
  expect(statusUpdate).toHaveProperty("platform");
  expect(statusUpdate).toHaveProperty("isLive");
  expect(statusUpdate).toHaveProperty("wasLive");
  expect(statusUpdate).toHaveProperty("timestamp");

  expect(typeof statusUpdate.platform).toBe("string");
  expect(typeof statusUpdate.isLive).toBe("boolean");
  expect(typeof statusUpdate.wasLive).toBe("boolean");
  expect(statusUpdate.timestamp).toBeInstanceOf(Date);
};

describe("ViewerCountSystem - Comprehensive Behavior Tests", () => {
  beforeEach(() => { savedToken = secrets.twitch.accessToken; secrets.twitch.accessToken = "synthetic-token"; useFakeTimers(); });
  afterEach(async () => {
    for (const system of ownedSystems.splice(0)) await system.cleanup();
    await drain();
    expect(getTimerCount()).toBe(0);
    secrets.twitch.accessToken = savedToken;
    vi.restoreAllMocks();
    useRealTimers();
  });

  describe("System Initialization & Configuration", () => {
    test("initialization does not acquire a maintenance timer for bounded counter state", async () => {
      const timerBaseline = getTimerCount();
      const { system } = createViewerCountTestEnvironment();
      await system.initialize();
      expect(getTimerCount()).toBe(timerBaseline);
      await system.initialize();
      expect(getTimerCount()).toBe(timerBaseline);
      await system.cleanup();
      expect(getTimerCount()).toBe(timerBaseline);
    });

    test("should initialize with proper default viewer counts for all platforms", () => {
      const { system } = createViewerCountTestEnvironment();
      expect(system.getViewerCount("tiktok")).toBe(0);
      expect(system.getViewerCount("twitch")).toBe(0);
      expect(system.getViewerCount("youtube")).toBe(0);
    });

    test("should initialize in idle state without active polling", () => {
      const { system } = createViewerCountTestEnvironment();
      expect(system.isPolling).toBe(false);
      expect(system.pollingInterval).toBe(null);
      expect(Object.keys(system.pollingHandles)).toHaveLength(0);
    });

    test("should respect configured polling intervals from config", () => {
      const system = ownSystem(new ViewerCountSystem({
        platforms: {},
        config: buildConfig(60000),
        logger: noOpLogger,
      }));
      system.startPolling();
      expect(system.pollingInterval).toBe(60000);
      expect(system.isPolling).toBe(true);
    });

    test("should handle missing configuration gracefully with defaults", () => {
      const system = ownSystem(new ViewerCountSystem({
        platforms: {},
        config: buildConfig(60000),
        logger: noOpLogger,
      }));
      expect(() => system.startPolling()).not.toThrow();
    });

    test("should validate polling interval boundaries and disable for invalid values", async () => {
      const system = ownSystem(new ViewerCountSystem({ platforms: {}, config: buildConfig(0), logger: noOpLogger }));
      system.startPolling();
      expect(system.isPolling).toBe(false);
      expect(system.pollingHandles).toEqual({});
      expect(getTimerCount()).toBe(0);
    });

    test("should handle negative polling intervals by disabling polling", async () => {
      const system = ownSystem(new ViewerCountSystem({ platforms: {}, config: buildConfig(-10000), logger: noOpLogger }));
      system.startPolling();
      expect(system.isPolling).toBe(false);
      expect(system.pollingHandles).toEqual({});
      expect(getTimerCount()).toBe(0);
    });
  });

  describe("Observer Pattern Management", () => {
    test("should register observers with unique IDs successfully", () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("observer-1");
      system.addObserver(observer);
      expect(system.observers.has("observer-1")).toBe(true);
      expect(system.observers.size).toBe(1);
    });

    test("should notify multiple observers of viewer count changes", async () => {
      const { system } = createViewerCountTestEnvironment();

      const observer1 = createMockViewerCountObserver("observer-1");
      const observer2 = createMockViewerCountObserver("observer-2");

      system.addObserver(observer1);
      system.addObserver(observer2);
      await system.notifyObservers("tiktok", 100, 50);
      expect(observer1.receivedUpdates).toHaveLength(1);
      expect(observer2.receivedUpdates).toHaveLength(1);

      const update1 = observer1.receivedUpdates[0];
      const update2 = observer2.receivedUpdates[0];

      expectValidViewerCountUpdate(update1);
      expectValidViewerCountUpdate(update2);
      expect(update1!.count).toBe(100);
      expect(update2!.count).toBe(100);
    });

    test("should handle observer registration and removal during operation", () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("test-observer");

      system.addObserver(observer);
      expect(system.observers.size).toBe(1);

      system.removeObserver("test-observer");
      expect(system.observers.size).toBe(0);
      expect(system.observers.has("test-observer")).toBe(false);
    });

    test("should isolate observer failures without affecting others", async () => {
      const { system } = createViewerCountTestEnvironment();

      const workingObserver = createMockViewerCountObserver("working-observer");
      const failingObserver = createMockViewerCountObserver(
        "failing-observer",
        {
          onUpdate: async () => {
            throw new Error("Observer processing failed");
          },
        },
      );

      system.addObserver(workingObserver);
      system.addObserver(failingObserver);

      await system.notifyObservers("tiktok", 100, 50);

      expect(workingObserver.receivedUpdates).toHaveLength(1);
    });

    test("should prevent duplicate observer registration by ID", () => {
      const { system } = createViewerCountTestEnvironment();
      const observer1 = createMockViewerCountObserver("duplicate-id");
      const observer2 = createMockViewerCountObserver("duplicate-id");

      system.addObserver(observer1);
      system.addObserver(observer2);
      expect(system.observers.size).toBe(1);
      expect(system.observers.get("duplicate-id")).toBe(observer2);
    });

    test("should require observers to implement getObserverId method", () => {
      const { system } = createViewerCountTestEnvironment();
      const invalidObserver = {
        /* missing getObserverId */
      };

      expect(() =>
        system.addObserver(
          invalidObserver as unknown as Parameters<
            ViewerCountSystem["addObserver"]
          >[0],
        ),
      ).toThrow(
        "Observer must implement getObserverId() method",
      );
    });
  });

  describe("Platform Polling Behavior", () => {
    for (const ending of ["overlap", "interval", "offline", "stop", "cleanup"] as const) {
      test(`held HTTP poll: ${ending} preserves admission and retirement`, async () => {
        const h = createHttpProvider();
        const entered = createDeferred<void>();
        const release = createDeferred<number>();
        h.respond(async () => { entered.resolve(); return release.promise; });
        const system = ownSystem(new ViewerCountSystem({ platforms: { twitch: h.provider }, config: buildConfig(1), logger: noOpLogger }));
        let poll: Promise<void> | undefined;
        try {
          poll = system.pollPlatform("twitch"); await entered.promise;
          if (ending === "overlap") await system.pollPlatform("twitch");
          if (ending === "interval") { system.startPolling(); advanceTimersByTime(5); }
          if (ending === "offline") await system.updateStreamStatus("twitch", false);
          if (ending === "stop") system.stopPolling();
          if (ending === "cleanup") await system.cleanup();
          expect(h.attempts).toHaveLength(1);
          expect(system.getViewerCount("twitch")).toBe(0);
          release.resolve(120); await poll;
          expect(system.getViewerCount("twitch")).toBe(ending === "overlap" || ending === "interval" ? 120 : 0);
        } finally { release.resolve(120); await poll; await system.cleanup(); }
      });
    }

    test("should poll different platforms independently", async () => {
      const { system, http } = createViewerCountTestEnvironment();
      const entered = createDeferred<void>(); const release = createDeferred<number>();
      http.tiktok.respond(async () => { entered.resolve(); return release.promise; });
      http.twitch.respond(async () => 75);
      const slow = system.pollPlatform("tiktok");
      try {
        await entered.promise;
        await system.pollPlatform("twitch");
        expect(http.tiktok.attempts).toHaveLength(1); expect(http.twitch.attempts).toHaveLength(1);
        expect(system.getViewerCount("twitch")).toBe(75); expect(system.getViewerCount("tiktok")).toBe(0);
        release.resolve(120); await slow;
        expect(system.getViewerCount("tiktok")).toBe(120);
      } finally { release.resolve(120); await slow; }
    });

    test("live cadence admits exact HTTP attempts and skips offline slots", async () => {
      const { system, http } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("cadence"); system.addObserver(observer);
      system.startPolling(); await drain();
      expect(Object.values(http).map(h => h.attempts.length)).toEqual([1, 1, 0]);
      expect(observer.receivedUpdates.map(u => [u.platform, u.count])).toEqual([["tiktok", 100], ["twitch", 100]]);
      advanceTimersByTime(1000); await drain();
      expect(Object.values(http).map(h => h.attempts.length)).toEqual([2, 2, 0]);
      system.stopPlatformPolling("tiktok");
      advanceTimersByTime(1000); await drain();
      expect(Object.values(http).map(h => h.attempts.length)).toEqual([2, 3, 0]);
      expect(system.pollingHandles.tiktok).toBeUndefined(); expect(system.pollingHandles.twitch).toBeDefined();
      expect(observer.receivedUpdates.map(u => u.count)).toEqual([100, 100, 100, 100, 100]);
    });

    test("successive HTTP observations publish exact changing counts", async () => {
      const { system, http } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("counts"); system.addObserver(observer);
      for (const count of [100, 150, 200]) {
        http.tiktok.respond(async () => count); await system.pollPlatform("tiktok");
      }
      expect(http.tiktok.attempts).toHaveLength(3);
      expect(observer.receivedUpdates.map(u => [u.count, u.previousCount])).toEqual([[100, 0], [150, 100], [200, 150]]);
      expect(system.getViewerCount("tiktok")).toBe(200);
    });
  });

  describe("Stream Status Management", () => {
    test("should track live/offline status per platform accurately", async () => {
      const { system } = createViewerCountTestEnvironment();
      expect(system.isStreamLive("tiktok")).toBe(true);
      expect(system.isStreamLive("twitch")).toBe(true);
      expect(system.isStreamLive("youtube")).toBe(false);
      await system.updateStreamStatus("youtube", true);

      expect(system.isStreamLive("youtube")).toBe(true);
    });

    test("should stop polling when platform goes offline", async () => {
      const { system } = createViewerCountTestEnvironment();

      system.startPolling();
      expect(system.pollingHandles.tiktok).toBeDefined();
      await system.updateStreamStatus("tiktok", false);
      expect(system.pollingHandles.tiktok).toBeUndefined();
    });

    test("should start polling when platform comes online", async () => {
      const { system } = createViewerCountTestEnvironment({
        initialStreamStatus: { tiktok: false, twitch: true, youtube: false },
      });
      system.startPolling();
      expect(system.pollingHandles.tiktok).toBeUndefined();
      await system.updateStreamStatus("tiktok", true);
      expect(system.pollingHandles.tiktok).toBeDefined();
    });

    test("should notify observers of stream status changes", async () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("status-tracker");
      system.addObserver(observer);
      await system.updateStreamStatus("youtube", true);
      expect(observer.statusChanges).toHaveLength(1);
      const statusChange = observer.statusChanges[0];
      expectValidStreamStatusChange(statusChange);
      expect(statusChange!.platform).toBe("youtube");
      expect(statusChange!.isLive).toBe(true);
      expect(statusChange!.wasLive).toBe(false);
    });

    test("should handle rapid status change scenarios", async () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("rapid-changes");
      system.addObserver(observer);
      await system.updateStreamStatus("tiktok", false);
      await system.updateStreamStatus("tiktok", true);
      await system.updateStreamStatus("tiktok", false);
      expect(observer.statusChanges).toHaveLength(3);
    });

    test("should reset viewer count to zero when platform goes offline", async () => {
      const { system } = createViewerCountTestEnvironment();
      await system.updateViewerCount("tiktok", 500);
      const observer = createMockViewerCountObserver("count-reset");
      system.addObserver(observer);
      await system.updateStreamStatus("tiktok", false);
      expect(system.getViewerCount("tiktok")).toBe(0);
      expect(observer.receivedUpdates).toHaveLength(1);
      expect(observer.receivedUpdates[0]!.count).toBe(0);
      expect(observer.receivedUpdates[0]!.previousCount).toBe(500);
    });
  });

  describe("Viewer Count Change Detection", () => {
    test("should own validated viewer-count transitions", async () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("transition-observer");
      system.addObserver(observer);

      expect(await system.updateViewerCount("TikTok", 25)).toBe(true);
      expect(system.getViewerCount("tiktok")).toBe(25);
      expect(observer.receivedUpdates[0]).toMatchObject({
        platform: "tiktok",
        count: 25,
        previousCount: 0,
      });

      expect(await system.updateViewerCount("tiktok", -1)).toBe(false);
      expect(await system.updateViewerCount("tiktok", 1.5)).toBe(false);
      expect(await system.updateViewerCount("tiktok", Number.NaN)).toBe(false);
      expect(await system.updateViewerCount("tiktok", Number.POSITIVE_INFINITY)).toBe(false);
      expect(await system.updateViewerCount("unknown", 10)).toBe(false);
      expect(system.getViewerCount("tiktok")).toBe(25);
      expect(observer.receivedUpdates).toHaveLength(1);
    });

    test("should return immutable viewer-count snapshots", async () => {
      const { system } = createViewerCountTestEnvironment();
      await system.updateViewerCount("youtube", 40);

      const snapshot = system.getViewerCounts();

      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(system.getViewerCount("youtube")).toBe(40);
      expect(system.getViewerCounts().youtube).toBe(40);
    });

    test("should detect and report significant viewer count changes", async () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("change-detector");
      system.addObserver(observer);
      const previousCount = system.getViewerCount("tiktok");
      expect(previousCount).toBeDefined();
      if (previousCount === undefined) {
        throw new Error("Expected previous tiktok count");
      }
      await system.notifyObservers("tiktok", 250, previousCount);
      const update = observer.receivedUpdates[0];
      expect(update!.count).toBe(250);
      expect(update!.previousCount).toBe(0);
      expect(update!.count - update!.previousCount).toBe(250);
    });

    test("should provide previous count context in notifications", async () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("context-tracker");
      system.addObserver(observer);
      await system.notifyObservers("twitch", 150, 100);
      const update = observer.receivedUpdates[0];
      expect(update!.previousCount).toBe(100);
      expect(update!.count).toBe(150);
    });

    test("should track viewer count history accurately", async () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("history-tracker");
      system.addObserver(observer);
      await system.notifyObservers("tiktok", 100, 0);
      await system.notifyObservers("tiktok", 120, 100);
      await system.notifyObservers("tiktok", 90, 120);
      await system.notifyObservers("tiktok", 110, 90);
      expect(observer.receivedUpdates.length).toBe(4);
      expect(observer.receivedUpdates[0]!.count).toBe(100);
      expect(observer.receivedUpdates[0]!.previousCount).toBe(0);
      expect(observer.receivedUpdates[1]!.count).toBe(120);
      expect(observer.receivedUpdates[1]!.previousCount).toBe(100);
      expect(observer.receivedUpdates[2]!.count).toBe(90);
      expect(observer.receivedUpdates[2]!.previousCount).toBe(120);
      expect(observer.receivedUpdates[3]!.count).toBe(110);
      expect(observer.receivedUpdates[3]!.previousCount).toBe(90);
    }, 10000);

    test("should handle viewer count edge cases (zero, very large numbers)", async () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("edge-case-tracker");
      system.addObserver(observer);
      await system.notifyObservers("tiktok", 0, 100);
      await system.notifyObservers("tiktok", 999999, 0);
      expect(observer.receivedUpdates).toHaveLength(2);
      expect(observer.receivedUpdates[0]!.count).toBe(0);
      expect(observer.receivedUpdates[1]!.count).toBe(999999);
    });

    test("should handle negative viewer counts gracefully", async () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("negative-count");
      system.addObserver(observer);
      await system.notifyObservers("tiktok", -1, 100);
      expect(observer.receivedUpdates).toHaveLength(1);
      expect(observer.receivedUpdates[0]!.count).toBe(-1);
    });
  });

  describe("Error Handling & Recovery", () => {
    for (const failure of ["Network timeout", "Request timeout", "Network error", "Service unavailable"] as const) {
      test(`HTTP failure retains last good and recovers: ${failure}`, async () => {
        const { system, http } = createViewerCountTestEnvironment();
        const observer = createMockViewerCountObserver("recovery"); system.addObserver(observer);
        http.twitch.respond(async () => 200);
        await system.pollPlatform("tiktok");
        http.tiktok.respond(async () => { throw new Error(failure); });
        const failures = failure === "Network error" ? 2 : 1;
        for (let i = 0; i < failures; i++) await system.pollPlatform("tiktok");
        await system.pollPlatform("twitch");
        expect(http.tiktok.attempts).toHaveLength(1 + failures); expect(http.twitch.attempts).toHaveLength(1);
        expect(http.tiktok.provider.getErrorStats()).toMatchObject({ totalErrors: failures, consecutiveErrors: failures, lastError: failure });
        expect(system.getViewerCount("tiktok")).toBe(100);
        expect(observer.receivedUpdates.map(u => [u.platform, u.count])).toEqual([["tiktok", 100], ["twitch", 200]]);
        http.tiktok.respond(async () => 400); await system.pollPlatform("tiktok");
        expect(http.tiktok.attempts).toHaveLength(2 + failures);
        expect(system.getViewerCount("tiktok")).toBe(400);
        expect(http.tiktok.provider.getErrorStats().consecutiveErrors).toBe(0);
        expect(observer.receivedUpdates.at(-1)).toMatchObject({ count: 400, previousCount: 100 });
      });
    }
    test("null availability, external throw, measured zero and offline reset remain distinct", async () => {
      const h = createHttpProvider(42);
      const system = ownSystem(new ViewerCountSystem({ platforms: { twitch: h.provider }, config: buildConfig(), logger: noOpLogger }));
      const observer = createMockViewerCountObserver("availability"); system.addObserver(observer);
      await system.pollPlatform("twitch");
      const lastGood = system.getViewerCountSnapshot("twitch");
      expect(lastGood).toMatchObject({ count: 42, hasCompleteObservation: true, latestOutcome: "complete" });
      h.provider.config = { channel: "" };
      expect(await h.provider.getViewerCount()).toBeNull();
      await system.pollPlatform("twitch");
      expect(h.attempts).toHaveLength(1);
      expect(system.getViewerCountSnapshot("twitch")).toEqual({ ...lastGood, latestOutcome: "unavailable" });
      h.provider.config = { channel: "synthetic-channel" };
      h.respond(async () => { throw new Error("synthetic transport rejection"); });
      expect(await h.provider.getViewerCount()).toBeNull();
      await system.pollPlatform("twitch");
      expect(h.attempts).toHaveLength(3);
      expect(h.provider.getErrorStats()).toMatchObject({ totalErrors: 2, consecutiveErrors: 2 });
      // History remains available, while the current observation is unavailable.
      expect(system.getViewerCountSnapshot("twitch")).toEqual({ ...lastGood, latestOutcome: "unavailable" });
      expect(observer.receivedUpdates.map(u => u.count)).toEqual([42]);
      h.respond(async () => 0); await system.pollPlatform("twitch");
      expect(h.attempts).toHaveLength(4);
      expect(system.getViewerCountSnapshot("twitch")).toMatchObject({ count: 0, hasCompleteObservation: true, latestOutcome: "complete" });
      h.respond(async () => 9); await system.pollPlatform("twitch");
      expect(h.attempts).toHaveLength(5); expect(system.getViewerCount("twitch")).toBe(9);
      await system.updateStreamStatus("twitch", false);
      expect(system.getViewerCount("twitch")).toBe(0);
      await system.pollPlatform("twitch");
      expect(h.attempts).toHaveLength(6); expect(system.getViewerCount("twitch")).toBe(9);
      expect(observer.receivedUpdates.map(u => [u.count, u.previousCount])).toEqual([[42, 0], [0, 42], [9, 0], [0, 9], [9, 0]]);
    });

    test("all failed HTTP slots preserve distinct last good counts", async () => {
      const { system, http } = createViewerCountTestEnvironment({ initialStreamStatus: { tiktok: true, twitch: true, youtube: true } });
      for (const [index, name] of (["tiktok", "twitch", "youtube"] as const).entries()) {
        await system.updateViewerCount(name, index + 10);
        http[name].respond(async () => { throw new Error("synthetic outage"); });
        await system.pollPlatform(name);
      }
      expect(system.getViewerCounts()).toEqual({ tiktok: 10, twitch: 11, youtube: 12 });
      expect(Object.values(http).map(h => h.attempts.length)).toEqual([1, 1, 1]);
      expect(system.pollingStats.successfulPolls).toBe(0);
    });

    test("should handle observer notification failures without affecting others", async () => {
      const { system } = createViewerCountTestEnvironment();

      const workingObserver = createMockViewerCountObserver("working");
      const errorObserver = createMockViewerCountObserver("error", {
        onUpdate: async () => {
          throw new Error("Observer error");
        },
      });

      system.addObserver(workingObserver);
      system.addObserver(errorObserver);

      await system.notifyObservers("tiktok", 100, 50);

      expect(workingObserver.receivedUpdates).toHaveLength(1);
    });
  });

  describe("Resource Management & Cleanup", () => {
    test("should clean up polling handles during shutdown", () => {
      const { system } = createViewerCountTestEnvironment();

      system.startPolling();
      expect(Object.keys(system.pollingHandles).length).toBeGreaterThan(0);

      system.stopPolling();

      expect(system.isPolling).toBe(false);
      expect(Object.keys(system.pollingHandles)).toHaveLength(0);
    });

    test("should remove observers cleanly during cleanup", async () => {
      const { system } = createViewerCountTestEnvironment();

      const observer = createMockViewerCountObserver("cleanup-test");
      system.addObserver(observer);

      await system.cleanup();

      expect(system.observers.size).toBe(0);
      expect(observer.cleanupCompleted).toBe(true);
    });

    test("should handle cleanup during active polling gracefully", async () => {
      const { system } = createViewerCountTestEnvironment();

      system.startPolling();
      expect(system.isPolling).toBe(true);

      await system.cleanup();

      expect(system.isPolling).toBe(false);
    });

    test("should manage resources efficiently under load", async () => {
      const { system } = createViewerCountTestEnvironment();
      for (let i = 0; i < 100; i++) {
        const observer = createMockViewerCountObserver(`observer-${i}`);
        system.addObserver(observer);
      }
      system.startPolling();
      advanceTimersByTime(50);
      expect(system.observers.size).toBe(100);
      expect(system.isPolling).toBe(true);
    });

    test("delivers all 1000 notifications and clears observers on cleanup", async () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("memory-test");
      system.addObserver(observer);
      for (let i = 0; i < 1000; i++) {
        await system.notifyObservers("tiktok", i, i - 1);
      }
      expect(observer.receivedUpdates.map(u => [u.count, u.previousCount])).toEqual(Array.from({ length: 1000 }, (_, i) => [i, i - 1]));
      await system.cleanup();
      expect(system.observers.size).toBe(0);
    });
  });

  describe("Configuration Changes & Runtime Adaptation", () => {
    test("should adapt to polling interval changes at runtime", () => {
      const system = ownSystem(new ViewerCountSystem({
        platforms: {},
        config: buildConfig(60000),
        logger: noOpLogger,
      }));
      system.startPolling();
      expect(system.pollingInterval).toBe(60000);
      system.stopPolling();
      system.pollingIntervalMs = 30000;
      system.startPolling();
      expect(system.pollingInterval).toBe(30000);
    });

    test("should handle platform enable/disable configuration changes", async () => {
      const { system } = createViewerCountTestEnvironment();
      system.startPolling();
      expect(system.pollingHandles.tiktok).toBeDefined();
      await system.updateStreamStatus("tiktok", false);
      expect(system.pollingHandles.tiktok).toBeUndefined();
      await system.updateStreamStatus("tiktok", true);
      expect(system.pollingHandles.tiktok).toBeDefined();
    });

    test("should validate configuration changes before applying", () => {
      const system = ownSystem(new ViewerCountSystem({
        platforms: {},
        config: buildConfig(60000),
        logger: noOpLogger,
      }));
      expect(() => system.startPolling()).not.toThrow();
      expect(system.isPolling).toBe(true);
    });

    test("should maintain operation during configuration reload", async () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("config-reload");
      system.addObserver(observer);
      system.startPolling();
      system.stopPolling();
      system.startPolling();
      advanceTimersByTime(5);
      expect(system.isPolling).toBe(true);
      expect(system.observers.size).toBe(1);
    });
  });

  describe("Notification volume", () => {
    test("delivers three simultaneous platform updates exactly", async () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("simultaneous"); system.addObserver(observer);
      await Promise.all([["tiktok", 100, 50], ["twitch", 200, 150], ["youtube", 300, 250]].map(([platform, count, previous]) => system.notifyObservers(String(platform), Number(count), Number(previous))));
      expect(observer.receivedUpdates.map(u => [u.platform, u.count, u.previousCount])).toEqual([["tiktok", 100, 50], ["twitch", 200, 150], ["youtube", 300, 250]]);
    });
    for (const size of [1, 10, 25, 50]) {
      test(`delivers to each of ${size} registered observers`, async () => {
        const { system } = createViewerCountTestEnvironment();
        const observers = Array.from({ length: size }, (_, i) => createMockViewerCountObserver(`volume-${i}`));
        observers.forEach(observer => system.addObserver(observer));
        await system.notifyObservers("tiktok", 100, 50);
        for (const observer of observers) expect(observer.receivedUpdates).toEqual([expect.objectContaining({ platform: "tiktok", count: 100, previousCount: 50 })]);
      });
    }
    test("delivers all 100 successive updates in order", async () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("successive"); system.addObserver(observer);
      for (let i = 0; i < 100; i++) await system.notifyObservers("tiktok", i, i - 1);
      expect(observer.receivedUpdates.map(u => [u.count, u.previousCount])).toEqual(Array.from({ length: 100 }, (_, i) => [i, i - 1]));
    });
  });

  describe("Integration Points", () => {
    test("should integrate with platform registry correctly", () => {
      const { system, platforms } = createViewerCountTestEnvironment();
      const validation = system.validatePlatformForPolling("tiktok");
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        throw new Error("Expected tiktok platform to be valid for polling");
      }
      expect(validation.platform).toBe(platforms.tiktok!);
    });

    test("should handle empty platform registry properly", () => {
      const system = ownSystem(new ViewerCountSystem({
        platforms: {},
        config: buildConfig(60000),
        logger: noOpLogger,
      }));
      expect(() => system.startPolling()).not.toThrow();
    });

    test("should coordinate stream status updates", async () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("stream-status-observer");
      system.addObserver(observer);
      await system.updateStreamStatus("youtube", true);
      expect(observer.statusChanges).toHaveLength(1);
      expect(observer.statusChanges[0]!.platform).toBe("youtube");
      expect(observer.statusChanges[0]!.isLive).toBe(true);
    });

    test("should maintain proper state during app lifecycle events", async () => {
      const { system } = createViewerCountTestEnvironment();
      await system.initialize();
      system.startPolling();
      expect(system.isPolling).toBe(true);
      await system.cleanup();
      expect(system.observers.size).toBe(0);
    });

    test("should handle observer initialization during system startup", async () => {
      const { system } = createViewerCountTestEnvironment();
      const observer = createMockViewerCountObserver("startup-init");
      system.addObserver(observer);
      await system.initialize();
      expect(observer.initializationCompleted).toBe(true);
    });

    test("should provide accurate stream status to external systems", () => {
      const { system } = createViewerCountTestEnvironment({
        initialStreamStatus: { tiktok: true, twitch: false, youtube: true },
      });
      expect(system.isStreamLive("tiktok")).toBe(true);
      expect(system.isStreamLive("twitch")).toBe(false);
      expect(system.isStreamLive("youtube")).toBe(true);
      expect(system.isStreamLive("unknown")).toBe(false);
    });
  });
});
