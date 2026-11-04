import { vi, type Mock, describe, test, afterEach, expect } from 'bun:test';


import { noOpLogger } from "../helpers/mock-factories";
import { TwitchViewerCountProvider } from "../../src/utils/viewer-count-providers";
import { ViewerCountSystem } from "../../src/utils/viewer-count.ts";
import { createConfigFixture } from "../helpers/config-fixture";

type PlatformName = "tiktok" | "twitch" | "youtube";
type PlatformBehavior = { viewerCount: number };
type PlatformBehaviors = Partial<Record<PlatformName, PlatformBehavior>>;
type ViewerCountSystemUnderTest = InstanceType<typeof ViewerCountSystem>;
const systems = new Set<ViewerCountSystemUnderTest>();
type PlatformProviderAdapter = {
  getViewerCount: Mock<(...args: []) => Promise<number | null>>;
  initialize: Mock<(...args: []) => Promise<boolean>>;
  setStreamResponse: (next: () => Promise<number>) => void;
};

const createConcretePlatformAdapter = (initialViewerCount: number): PlatformProviderAdapter => {
  let streamResponse: () => Promise<number> = async () => initialViewerCount;
  const provider = new TwitchViewerCountProvider(
    { getStreamInfo: async () => ({ isLive: true, viewerCount: await streamResponse() }) },
    { channel: "synthetic-channel" },
    noOpLogger,
  );
  const getViewerCount = vi.fn<(...args: []) => Promise<number | null>>(() =>
    provider.getViewerCount(),
  );
  const initialize = vi.fn<(...args: []) => Promise<boolean>>().mockResolvedValue(true);

  return {
    getViewerCount,
    initialize,
    setStreamResponse: (next) => {
      streamResponse = next;
    },
  };
};

const hasSeparateEarlyStartMethod = (system: ViewerCountSystemUnderTest) => {
  const candidate = system as unknown as {
    startViewerCountSystemEarly?: unknown;
  };
  return typeof candidate.startViewerCountSystemEarly === "function";
};

const createViewerCountSystemWithBehaviors = (
  platformBehaviors: PlatformBehaviors = {},
) => {
  const defaultPlatformBehaviors = {
    tiktok: { viewerCount: 150 },
    twitch: { viewerCount: 50 },
    youtube: { viewerCount: 200 },
    ...platformBehaviors,
  };

  const platforms: Record<PlatformName, PlatformProviderAdapter> = {} as Record<
    PlatformName,
    PlatformProviderAdapter
  >;
  Object.entries(defaultPlatformBehaviors).forEach(([name, behavior]) => {
    const platformName = name as PlatformName;
    platforms[platformName] = createConcretePlatformAdapter(behavior.viewerCount);
  });

  const system = new ViewerCountSystem({
    platforms,
    logger: noOpLogger,
    config: createConfigFixture(),
  });
  systems.add(system);

  return { system, platforms };
};

const simulatePlatformReadiness = async (
  system: ViewerCountSystemUnderTest,
  platform: PlatformName,
  isReady: boolean,
) => {
  await system.updateStreamStatus(platform, isReady);
};

const validateSystemStability = (system: ViewerCountSystemUnderTest) => {
  const status = system.getSystemStatus();
  return {
    isStable:
      status.isPolling !== undefined && status.viewerCounts !== undefined,
    hasValidCounts: Object.values(status.viewerCounts).every(
      (count) => typeof count === "number",
    ),
    platformsTracked: Object.keys(status.streamStatus).length,
    pollingState: status.isPolling,
    activePollingPlatforms: status.activePollingPlatforms,
  };
};

const simulateNetworkFailure = (
  platform: PlatformProviderAdapter,
  errorType = "connection_timeout",
) => {
  platform.setStreamResponse(async () => {
    throw new Error(`Network ${errorType}`);
  });
  platform.getViewerCount.mockRejectedValue(
    new Error(`Network ${errorType}`),
  );
  platform.initialize.mockRejectedValue(new Error(`Platform ${errorType}`));
};

const expectUserSeesViewerCount = (
  system: ViewerCountSystemUnderTest,
  platform: PlatformName,
  expectedCount: number,
) => {
  const status = system.getSystemStatus();
  const actualCount = status.viewerCounts[platform.toLowerCase()];
  return actualCount === expectedCount;
};

describe("ViewerCount Unified Initialization Behavior", () => {
  afterEach(async () => {
    try {
      await Promise.all([...systems].map((system) => system.cleanup()));
    } finally {
      systems.clear();
      vi.restoreAllMocks();
    }
  });

  describe("Unified Initialization Behavior", () => {
    test("should not have dual initialization artifacts", async () => {
      const { system } = createViewerCountSystemWithBehaviors();

      const hasEarlyInitMethod = hasSeparateEarlyStartMethod(system);
      expect(hasEarlyInitMethod).toBe(false);
      expect(typeof system.initialize === "function").toBe(true);
    });

    test("should handle platform readiness changes without re-initialization", async () => {
      const { system } = createViewerCountSystemWithBehaviors({
        tiktok: { viewerCount: 75 },
        twitch: { viewerCount: 25 },
        youtube: { viewerCount: 150 },
      });

      await system.initialize();
      await simulatePlatformReadiness(system, "twitch", true);
      await simulatePlatformReadiness(system, "youtube", true);

      const stability = validateSystemStability(system);
      expect(stability.isStable).toBe(true);

      await simulatePlatformReadiness(system, "tiktok", true);
      const postReadinessStability = validateSystemStability(system);
      expect(postReadinessStability.isStable).toBe(true);
    });

    test("should prevent race conditions from dual initialization timing", async () => {
      const { system } = createViewerCountSystemWithBehaviors();

      let raceConditionDetected = false;
      try {
        await system.initialize();
      } catch {
        raceConditionDetected = true;
      }

      expect(raceConditionDetected).toBe(false);
    });
  });

  describe("Platform Integration Behavior", () => {
    test("should use unified polling via single startPolling method", async () => {
      const { system } = createViewerCountSystemWithBehaviors();

      await system.initialize();

      const hasStartPolling = typeof system.startPolling === "function";
      const hasSeparateEarlyPolling = hasSeparateEarlyStartMethod(system);

      expect(hasStartPolling).toBe(true);
      expect(hasSeparateEarlyPolling).toBe(false);
    });

    test("should start polling when platform becomes ready", async () => {
      const { system } = createViewerCountSystemWithBehaviors({
        youtube: { viewerCount: 300 },
      });

      await system.initialize();
      system.startPolling();
      await simulatePlatformReadiness(system, "youtube", true);

      const status = system.getSystemStatus();
      expect(status.activePollingPlatforms).toContain("youtube");

      await system.pollPlatform("youtube");
      expect(expectUserSeesViewerCount(system, "youtube", 300)).toBe(true);
    });

    test("should retain Twitch reconciliation polling when the stream goes offline", async () => {
      const { system } = createViewerCountSystemWithBehaviors({
        twitch: { viewerCount: 100 },
      });

      await system.initialize();
      await simulatePlatformReadiness(system, "twitch", true);
      system.startPolling();
      await simulatePlatformReadiness(system, "twitch", false);

      const status = system.getSystemStatus();
      expect(status.activePollingPlatforms).toContain("twitch");
      expect(expectUserSeesViewerCount(system, "twitch", 0)).toBe(true);
    });

    test("should reflect platform readiness changes in viewer count updates", async () => {
      const { system } = createViewerCountSystemWithBehaviors({
        tiktok: { viewerCount: 200 },
        youtube: { viewerCount: 150 },
      });

      await system.initialize();
      system.startPolling();
      await simulatePlatformReadiness(system, "tiktok", true);
      await simulatePlatformReadiness(system, "youtube", false);

      const status = system.getSystemStatus();
      expect(status.activePollingPlatforms).toContain("tiktok");
      expect(status.activePollingPlatforms).not.toContain("youtube");
      expect(expectUserSeesViewerCount(system, "youtube", 0)).toBe(true);

      await system.pollPlatform("tiktok");
      expect(expectUserSeesViewerCount(system, "tiktok", 200)).toBe(true);
    });
  });

  describe("Error Recovery Behavior", () => {
    test("should maintain system stability during platform connection failures", async () => {
      const { system, platforms } = createViewerCountSystemWithBehaviors();
      await system.initialize();

      const initialStability = validateSystemStability(system);
      expect(initialStability.isStable).toBe(true);

      simulateNetworkFailure(platforms.tiktok, "connection_refused");
      await simulatePlatformReadiness(system, "tiktok", true);
      await system.pollPlatform("tiktok");
      expect(platforms.tiktok.getViewerCount).toHaveBeenCalledTimes(1);
      expect(system.getViewerCountSnapshot("tiktok")).toMatchObject({
        count: 0, hasCompleteObservation: false, latestOutcome: "unavailable",
      });

      const recoveryStability = validateSystemStability(system);
      expect(recoveryStability.isStable).toBe(true);
      expect(recoveryStability.hasValidCounts).toBe(true);
    });

    test("should recover when platforms become available later", async () => {
      const { system, platforms } = createViewerCountSystemWithBehaviors({
        youtube: { viewerCount: 250 },
      });

      simulateNetworkFailure(platforms.youtube, "initialization_failed");
      await system.initialize();
      for (const platform of Object.values(platforms)) {
        expect(platform.initialize).not.toHaveBeenCalled();
      }
      await simulatePlatformReadiness(system, "youtube", true);
      await system.pollPlatform("youtube");
      expect(platforms.youtube.getViewerCount).toHaveBeenCalledTimes(1);
      expect(system.getViewerCountSnapshot("youtube")).toMatchObject({
        count: 0, hasCompleteObservation: false, latestOutcome: "unavailable",
      });

      platforms.youtube.setStreamResponse(async () => 250);
      platforms.youtube.getViewerCount.mockResolvedValue(250);
      platforms.youtube.initialize.mockResolvedValue(true);
      await simulatePlatformReadiness(system, "youtube", true);
      await system.pollPlatform("youtube");
      expect(platforms.youtube.getViewerCount).toHaveBeenCalledTimes(2);
      expect(system.getViewerCountSnapshot("youtube")).toMatchObject({
        count: 250, hasCompleteObservation: true, latestOutcome: "complete",
      });
      for (const platform of Object.values(platforms)) {
        expect(platform.initialize).not.toHaveBeenCalled();
      }

      const status = system.getSystemStatus();
      expect(status.streamStatus.youtube).toBe(true);

      system.startPolling();
      const pollingStatus = system.getSystemStatus();
      expect(pollingStatus.isPolling).toBe(true);
    });

    test("should remain stable during simultaneous platform failures", async () => {
      const { system, platforms } = createViewerCountSystemWithBehaviors();
      await system.initialize();

      await simulatePlatformReadiness(system, "tiktok", true);
      await simulatePlatformReadiness(system, "twitch", true);
      await simulatePlatformReadiness(system, "youtube", true);

      Object.values(platforms).forEach((platform) => {
        simulateNetworkFailure(platform, "network_outage");
      });
      await Promise.all(["tiktok", "twitch", "youtube"].map((platform) => system.pollPlatform(platform)));
      for (const [name, platform] of Object.entries(platforms)) {
        expect(platform.getViewerCount).toHaveBeenCalledTimes(1);
        expect(system.getViewerCountSnapshot(name)).toMatchObject({
          count: 0, hasCompleteObservation: false, latestOutcome: "unavailable",
        });
      }

      const stability = validateSystemStability(system);
      expect(stability.isStable).toBe(true);
      expect(stability.hasValidCounts).toBe(true);

      const status = system.getSystemStatus();
      expect(
        Object.values(status.viewerCounts).every((count) => count >= 0),
      ).toBe(true);
    });
  });

  describe("Timing Reliability Behavior", () => {
    test("should work regardless of platform initialization order", async () => {
      const { system } = createViewerCountSystemWithBehaviors();
      await system.initialize();

      const platformOrder: PlatformName[] = ["youtube", "twitch", "tiktok"];
      for (const platform of platformOrder) {
        await simulatePlatformReadiness(system, platform, true);
      }

      const stability = validateSystemStability(system);
      expect(stability.isStable).toBe(true);
      expect(stability.platformsTracked).toBe(3);

      const status = system.getSystemStatus();
      expect(Object.keys(status.streamStatus)).toContain("tiktok");
      expect(Object.keys(status.streamStatus)).toContain("twitch");
      expect(Object.keys(status.streamStatus)).toContain("youtube");
    });

    test("should prevent race conditions with early platform readiness", async () => {
      const { system } = createViewerCountSystemWithBehaviors();

      await simulatePlatformReadiness(system, "twitch", true);
      await system.initialize();

      const stability = validateSystemStability(system);
      expect(stability.isStable).toBe(true);

      const status = system.getSystemStatus();
      expect(status.streamStatus.twitch).toBe(true);
    });

    test("should handle late platform readiness without issues", async () => {
      const { system } = createViewerCountSystemWithBehaviors();
      await system.initialize();
      system.startPolling();

      const published = Promise.withResolvers<void>();
      system.addObserver({
        getObserverId: () => "synthetic-late-readiness-observer",
        onViewerCountUpdate(update) {
          if (update.platform === "tiktok" && update.count === 150) published.resolve();
        },
      });
      await simulatePlatformReadiness(system, "tiktok", true);
      await published.promise;

      const status = system.getSystemStatus();
      expect(status.streamStatus.tiktok).toBe(true);
      expect(system.isPlatformEligibleForPolling("tiktok")).toBe(true);
      expect(system.getViewerCount("tiktok")).toBe(150);
    });

    test("should maintain predictable polling behavior across timing scenarios", async () => {
      const { system } = createViewerCountSystemWithBehaviors();
      await system.initialize();

      await simulatePlatformReadiness(system, "youtube", true);
      system.startPolling();
      await simulatePlatformReadiness(system, "twitch", true);

      const status = system.getSystemStatus();
      expect(status.isPolling).toBe(true);
      expect(status.streamStatus.youtube).toBe(true);
      expect(status.streamStatus.twitch).toBe(true);
      expect(system.isPlatformEligibleForPolling("youtube")).toBe(true);
      expect(system.isPlatformEligibleForPolling("twitch")).toBe(true);
    });
  });
});
