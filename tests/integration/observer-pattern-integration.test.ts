import { describe, test, beforeEach, afterEach, expect } from "bun:test";
import {
  clearAllMocks,
  createMockFn,
  restoreAllMocks,
  type TestMockFn,
} from "../helpers/bun-mock-utils";
import { expectNoTechnicalArtifacts } from "../helpers/behavior-validation";
import { createConfigFixture } from "../helpers/config-fixture";
import { createMockOBSManager } from "../helpers/mock-factories";
import { waitForDelay } from "../helpers/time-utils";
import testClock from "../helpers/test-clock";
import { OBSViewerCountObserver } from "../../src/observers/obs-viewer-count-observer";
import { ViewerCountSystem } from "../../src/utils/viewer-count";

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

type TestObserver = {
  getObserverId: () => string;
  onViewerCountUpdate: TestMockFn<[ViewerCountUpdate], unknown>;
  onStreamStatusChange: TestMockFn<[StreamStatusUpdate], unknown>;
  initialize: TestMockFn<[], unknown>;
  cleanup: TestMockFn<[], unknown>;
};

const createViewerCountLogger = () => ({
  debug: (_message: string, _context?: string, _payload?: unknown) => undefined,
  info: (_message: string, _context?: string, _payload?: unknown) => undefined,
  warn: (_message: string, _context?: string, _payload?: unknown) => undefined,
  error: (_message: string, _context?: string, _payload?: unknown) => undefined,
});

const expectFirstArg = <Args extends unknown[]>(
  mockFn: TestMockFn<Args, unknown>,
): Args[0] => {
  const firstCall = mockFn.mock.calls[0];
  expect(firstCall).toBeDefined();
  if (!firstCall) {
    throw new Error("Expected mock to have at least one call");
  }
  return firstCall[0];
};

const expectCallArg = <Args extends unknown[]>(
  mockFn: TestMockFn<Args, unknown>,
  callIndex: number,
): Args[0] => {
  const call = mockFn.mock.calls[callIndex];
  expect(call).toBeDefined();
  if (!call) {
    throw new Error(`Expected mock call ${callIndex} to exist`);
  }
  return call[0];
};

const isObsInputSettingsRequest = (
  value: unknown,
): value is { inputSettings: { text: string } } => {
  return (
    typeof value === "object" &&
    value !== null &&
    "inputSettings" in value &&
    typeof value.inputSettings === "object" &&
    value.inputSettings !== null &&
    "text" in value.inputSettings &&
    typeof value.inputSettings.text === "string"
  );
};

const createTimeProvider = () => ({
  now: () => testClock.now(),
  createDate: (timestamp: number) => new Date(timestamp),
});

describe("Observer Pattern Integration", () => {
  let viewerCountSystem: InstanceType<typeof ViewerCountSystem>;
  let platforms: {
    youtube: {
      getViewerCount: TestMockFn<[], Promise<unknown>>;
    };
    twitch: {
      getViewerCount: TestMockFn<[], Promise<unknown>>;
    };
  };
  let logger: ReturnType<typeof createViewerCountLogger>;
  let testConfig: ReturnType<typeof createConfigFixture>;

  beforeEach(async () => {
    testClock.reset();
    testConfig = createConfigFixture();
    logger = createViewerCountLogger();
    platforms = {
      youtube: {
        getViewerCount: createMockFn<[], Promise<unknown>>(async () => 1000),
      },
      twitch: {
        getViewerCount: createMockFn<[], Promise<unknown>>(async () => 2000),
      },
    };

    viewerCountSystem = new ViewerCountSystem({
      platforms,
      logger,
      timeProvider: createTimeProvider(),
      config: testConfig,
    });
    await viewerCountSystem.initialize();
  });

  afterEach(async () => {
    if (viewerCountSystem) {
      viewerCountSystem.stopPolling();
      await viewerCountSystem.cleanup();
    }
    clearAllMocks();
    restoreAllMocks();
  });

  describe("Observer Registration and Management", () => {
    test("should register observers and assign unique IDs", () => {
      const observer1 = createTestObserver("analytics-observer");
      const observer2 = createTestObserver("metrics-observer");

      viewerCountSystem.addObserver(observer1);
      viewerCountSystem.addObserver(observer2);

      expect(viewerCountSystem.observers.size).toBe(2);
      expect(viewerCountSystem.observers.has("analytics-observer")).toBe(true);
      expect(viewerCountSystem.observers.has("metrics-observer")).toBe(true);
    });

    test("should reject observers without required interface methods", () => {
      const invalidObserver = {
        onViewerCountUpdate: createMockFn(),
      };

      expect(() => {
        const addInvalidObserver = viewerCountSystem.addObserver.bind(
          viewerCountSystem,
        ) as (observer: Record<string, unknown>) => void;
        addInvalidObserver(invalidObserver);
      }).toThrow("Observer must implement getObserverId() method");
    });

    test("should allow observer removal by ID", () => {
      const observer = createTestObserver("removable-observer");
      viewerCountSystem.addObserver(observer);
      expect(viewerCountSystem.observers.size).toBe(1);

      viewerCountSystem.removeObserver("removable-observer");

      expect(viewerCountSystem.observers.size).toBe(0);
      expect(viewerCountSystem.observers.has("removable-observer")).toBe(false);
    });

    test("should handle duplicate observer IDs by replacing existing", () => {
      const observer1 = createTestObserver("duplicate-id");
      const observer2 = createTestObserver("duplicate-id");

      viewerCountSystem.addObserver(observer1);
      viewerCountSystem.addObserver(observer2);

      expect(viewerCountSystem.observers.size).toBe(1);
      expect(viewerCountSystem.observers.get("duplicate-id")).toBe(observer2);
    });
  });

  describe("Observer Notifications", () => {
    test("should notify all observers of viewer count updates", async () => {
      const observers = [
        createTestObserver("observer-1"),
        createTestObserver("observer-2"),
        createTestObserver("observer-3"),
      ];
      observers.forEach((observer) => viewerCountSystem.addObserver(observer));

      const expectedTimestampMs = testClock.now();
      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(50);

      observers.forEach((observer) => {
        expect(observer.onViewerCountUpdate).toHaveBeenCalled();
        const updateCall = expectFirstArg(observer.onViewerCountUpdate);
        expect(updateCall).toMatchObject({
          platform: "youtube",
          count: 1000,
          isStreamLive: true,
        });
        expect(updateCall.timestamp).toBeInstanceOf(Date);
        expect(updateCall.timestamp.getTime()).toBe(expectedTimestampMs);
      });
    });

    test("should notify observers of stream status changes", async () => {
      const observer = createTestObserver("status-observer");
      viewerCountSystem.addObserver(observer);

      const firstTimestampMs = testClock.now();
      await viewerCountSystem.updateStreamStatus("youtube", true);
      testClock.advance(1000);
      const secondTimestampMs = testClock.now();
      await viewerCountSystem.updateStreamStatus("youtube", false);

      expect(observer.onStreamStatusChange).toHaveBeenCalledTimes(2);
      const firstCall = expectCallArg(observer.onStreamStatusChange, 0);
      const secondCall = expectCallArg(observer.onStreamStatusChange, 1);
      expect(firstCall).toMatchObject({
        platform: "youtube",
        isLive: true,
        wasLive: false,
      });
      expect(secondCall).toMatchObject({
        platform: "youtube",
        isLive: false,
        wasLive: true,
      });
      expect(firstCall.timestamp).toBeInstanceOf(Date);
      expect(secondCall.timestamp).toBeInstanceOf(Date);
      expect(firstCall.timestamp.getTime()).toBe(firstTimestampMs);
      expect(secondCall.timestamp.getTime()).toBe(secondTimestampMs);
    });

    test("should include correct metadata in observer notifications", async () => {
      const observer = createTestObserver("metadata-observer");
      viewerCountSystem.addObserver(observer);

      const expectedTimestampMs = testClock.now();
      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(50);

      const updateCall = expectFirstArg(observer.onViewerCountUpdate);
      expect(updateCall).toMatchObject({
        platform: "youtube",
        count: 1000,
        previousCount: 0,
        isStreamLive: true,
      });
      expect(updateCall.timestamp instanceof Date).toBe(true);
      expect(Number.isFinite(updateCall.timestamp.getTime())).toBe(true);
      expect(updateCall.timestamp.getTime()).toBe(expectedTimestampMs);
    });
  });

  describe("OBS Observer Integration", () => {
    const createConfigFixture = () => ({
      twitch: {
        viewerCountEnabled: true,
        viewerCountSource: "test-viewer-count-source",
      },
      youtube: {
        viewerCountEnabled: true,
        viewerCountSource: "test-viewer-count-source",
      },
      tiktok: {
        viewerCountEnabled: true,
        viewerCountSource: "test-viewer-count-source",
      },
    });

    test("should integrate OBS observer with ViewerCountSystem", async () => {
      const obsManager = createMockOBSManager();
      const obsObserver = new OBSViewerCountObserver(
        obsManager,
        createViewerCountLogger(),
        {
          config: createConfigFixture(),
        },
      );
      viewerCountSystem.addObserver(obsObserver);

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(50);

      const obsUpdateCalls = obsManager.call.mock.calls.filter(
        (call) => call[0] === "SetInputSettings",
      );
      expect(obsUpdateCalls.length).toBeGreaterThan(0);
      expect(viewerCountSystem.counts.youtube).toBe(1000);

      const latestObsCall = obsUpdateCalls[obsUpdateCalls.length - 1];
      expect(latestObsCall).toBeDefined();
      if (!latestObsCall) {
        throw new Error("Expected OBS update call to exist");
      }
      const latestObsUpdate = latestObsCall[1];
      expect(isObsInputSettingsRequest(latestObsUpdate)).toBe(true);
      if (!isObsInputSettingsRequest(latestObsUpdate)) {
        throw new Error("Expected OBS update call to include inputSettings.text");
      }
      expect(latestObsUpdate.inputSettings.text).toMatch(
        /^\d{1,3}(,\d{3})*(\.\d+)?[KMB]?$/,
      );
      expect(latestObsUpdate.inputSettings.text).not.toBe("0");
    });

    test("should handle OBS observer initialization and cleanup", async () => {
      const obsManager = createMockOBSManager();
      const obsObserver = new OBSViewerCountObserver(
        obsManager,
        createViewerCountLogger(),
        {
          config: createConfigFixture(),
        },
      );

      viewerCountSystem.addObserver(obsObserver);
      await viewerCountSystem.initializeObservers();

      const initializedToZero = obsManager.call.mock.calls.some(
        (call) =>
          call[0] === "SetInputSettings" &&
          isObsInputSettingsRequest(call[1]) && call[1].inputSettings.text === "0",
      );
      expect(initializedToZero).toBe(true);

      await viewerCountSystem.cleanup();

      expect(viewerCountSystem.observers.size).toBe(0);
    });
  });

  describe("Error Handling and Resilience", () => {
    test("should handle observer errors gracefully without affecting others", async () => {
      const healthyObserver = createTestObserver("healthy-observer");
      const faultyObserver = createTestObserver("faulty-observer");
      faultyObserver.onViewerCountUpdate.mockRejectedValue(
        new Error("Observer crashed"),
      );

      viewerCountSystem.addObserver(healthyObserver);
      viewerCountSystem.addObserver(faultyObserver);

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(100);

      expect(healthyObserver.onViewerCountUpdate).toHaveBeenCalled();
      expect(faultyObserver.onViewerCountUpdate).toHaveBeenCalled();
      expect(viewerCountSystem.counts.youtube).toBe(1000);
    });

    test("should handle observers that throw during initialization", async () => {
      const faultyObserver = createTestObserver("init-faulty-observer");
      faultyObserver.initialize.mockRejectedValue(new Error("Init failed"));
      const healthyObserver = createTestObserver("init-healthy-observer");

      viewerCountSystem.addObserver(faultyObserver);
      viewerCountSystem.addObserver(healthyObserver);

      await expect(
        viewerCountSystem.initializeObservers(),
      ).resolves.toBeUndefined();

      expect(healthyObserver.initialize).toHaveBeenCalled();
    });

    test("should handle observers that throw during cleanup", async () => {
      const faultyObserver = createTestObserver("cleanup-faulty-observer");
      faultyObserver.cleanup.mockRejectedValue(new Error("Cleanup failed"));
      const healthyObserver = createTestObserver("cleanup-healthy-observer");

      viewerCountSystem.addObserver(faultyObserver);
      viewerCountSystem.addObserver(healthyObserver);

      await expect(viewerCountSystem.cleanup()).resolves.toBeUndefined();

      expect(faultyObserver.cleanup).toHaveBeenCalled();
      expect(healthyObserver.cleanup).toHaveBeenCalled();
      expect(viewerCountSystem.observers.size).toBe(0);
    });
  });

  describe("Multiple Platform Observer Integration", () => {
    test("should notify observers of updates from multiple platforms", async () => {
      const multiPlatformObserver = createTestObserver(
        "multi-platform-observer",
      );
      viewerCountSystem.addObserver(multiPlatformObserver);

      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.updateStreamStatus("twitch", true);
      viewerCountSystem.startPolling();
      await waitForDelay(100);

      const calls = multiPlatformObserver.onViewerCountUpdate.mock.calls;
      const platforms = calls.map((call) => call[0].platform);

      expect(platforms).toContain("youtube");
      expect(platforms).toContain("twitch");
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });

    test("should handle platform-specific observer filtering", async () => {
      const youtubeObserver = {
        getObserverId: () => "youtube-only-observer",
        onViewerCountUpdate: createMockFn<[ViewerCountUpdate], void>((update) => {
          if (update.platform !== "youtube") return;
        }),
        onStreamStatusChange: createMockFn(),
      };
      viewerCountSystem.addObserver(youtubeObserver);

      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.updateStreamStatus("twitch", true);
      viewerCountSystem.startPolling();
      await waitForDelay(100);

      expect(youtubeObserver.onViewerCountUpdate).toHaveBeenCalled();

      const calls = youtubeObserver.onViewerCountUpdate.mock.calls;
      expect(calls.some((call) => call[0].platform === "youtube")).toBe(true);
      expect(calls.some((call) => call[0].platform === "twitch")).toBe(true);
    });
  });

  describe("Observer Lifecycle Management", () => {
    test("should properly initialize observers during system startup", async () => {
      const observer1 = createTestObserver("lifecycle-observer-1");
      const observer2 = createTestObserver("lifecycle-observer-2");

      viewerCountSystem.addObserver(observer1);
      viewerCountSystem.addObserver(observer2);

      await viewerCountSystem.initializeObservers();

      expect(observer1.initialize).toHaveBeenCalled();
      expect(observer2.initialize).toHaveBeenCalled();
    });

    test("should support dynamic observer addition during runtime", async () => {
      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();

      const dynamicObserver = createTestObserver("dynamic-observer");
      viewerCountSystem.addObserver(dynamicObserver);

      await waitForDelay(100);

      const dynamicUpdates = dynamicObserver.onViewerCountUpdate.mock.calls.map(
        (call) => call[0],
      );
      expect(dynamicUpdates.length).toBeGreaterThan(0);
      expect(
        dynamicUpdates.some(
          (update) => update.platform === "youtube" && update.count === 1000,
        ),
      ).toBe(true);
    });

    test("should support dynamic observer removal during runtime", async () => {
      const removableObserver = createTestObserver("removable-observer");
      viewerCountSystem.addObserver(removableObserver);

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(50);

      removableObserver.onViewerCountUpdate.mockClear();

      viewerCountSystem.removeObserver("removable-observer");

      await waitForDelay(100);

      expect(removableObserver.onViewerCountUpdate).not.toHaveBeenCalled();
    });
  });

  describe("Performance and Scalability", () => {
    test("should handle large numbers of observers with all receiving valid updates", async () => {
      const observers: Array<ReturnType<typeof createTestObserver>> = [];
      for (let i = 0; i < 50; i++) {
        observers.push(createTestObserver(`observer-${i}`));
      }
      observers.forEach((observer) => viewerCountSystem.addObserver(observer));

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(100);

      observers.forEach((observer) => {
        const updates = observer.onViewerCountUpdate.mock.calls.map(
          (call) => call[0],
        );
        expect(
          updates.some(
            (update) =>
              update.platform === "youtube" &&
              update.count === 1000 &&
              update.isStreamLive === true &&
              update.timestamp instanceof Date,
          ),
        ).toBe(true);
      });

      expect(viewerCountSystem.observers.size).toBe(50);
      expect(viewerCountSystem.counts.youtube).toBe(1000);
    });

    test("should handle concurrent observer notifications with all observers receiving updates", async () => {
      const asyncObservers: Array<ReturnType<typeof createTestObserver>> = [];
      for (let i = 0; i < 10; i++) {
        const observer = createTestObserver(`async-observer-${i}`);
        observer.onViewerCountUpdate.mockImplementation(async () => {
          await waitForDelay(10);
        });
        asyncObservers.push(observer);
      }
      asyncObservers.forEach((observer) =>
        viewerCountSystem.addObserver(observer),
      );

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(150);

      asyncObservers.forEach((observer) => {
        const updates = observer.onViewerCountUpdate.mock.calls.map(
          (call) => call[0],
        );
        expect(
          updates.some(
            (update) =>
              update.platform === "youtube" &&
              update.count === 1000 &&
              update.isStreamLive === true &&
              update.timestamp instanceof Date,
          ),
        ).toBe(true);
      });
    });
  });

  describe("Content Quality Validation", () => {
    test("should provide user-friendly data to observers", async () => {
      const qualityObserver = createTestObserver("quality-observer");
      viewerCountSystem.addObserver(qualityObserver);

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(50);

      const updateData = expectFirstArg(qualityObserver.onViewerCountUpdate);

      expect(updateData.platform).toMatch(/^(youtube|twitch|tiktok)$/);
      expect(updateData.count).toBeGreaterThanOrEqual(0);
      expect(updateData.isStreamLive).toBe(true);
      expect(updateData.timestamp).toBeInstanceOf(Date);
      expectNoTechnicalArtifacts(updateData.platform);
    });
  });
});

// Helper function to create test observers
function createTestObserver(id: string): TestObserver {
  return {
    getObserverId: () => id,
    onViewerCountUpdate: createMockFn<[ViewerCountUpdate], unknown>(),
    onStreamStatusChange: createMockFn<[StreamStatusUpdate], unknown>(),
    initialize: createMockFn<[], unknown>(),
    cleanup: createMockFn<[], unknown>(),
  };
}
