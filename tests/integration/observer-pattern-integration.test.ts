import { vi, type Mock, describe, test, beforeEach, afterEach, expect } from 'bun:test';
import { EventEmitter } from "node:events";

import { expectNoTechnicalArtifacts } from "../helpers/behavior-validation";
import { createConfigFixture } from "../helpers/config-fixture";
import testClock from "../helpers/test-clock";
import { OBSConnectionManager } from "../../src/obs/connection";
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
  onViewerCountUpdate: Mock<(...args: [ViewerCountUpdate]) => Promise<void>>;
  onStreamStatusChange: Mock<(...args: [StreamStatusUpdate]) => unknown>;
  initialize: Mock<(...args: []) => Promise<void>>;
  cleanup: Mock<(...args: []) => Promise<void>>;
};

class SyntheticObsSocket extends EventEmitter {
  call = vi.fn<(...args: [string, Record<string, unknown>?]) => Promise<Record<string, unknown>>>()
    .mockResolvedValue({ status: "success" });
  async connect() {
    this.emit("Identified");
    return { obsWebSocketVersion: "synthetic" };
  }
  async disconnect() {
    this.emit("ConnectionClosed");
  }
}

const createViewerCountLogger = () => ({
  debug: (_message: string, _context?: string, _payload?: unknown) => undefined,
  info: (_message: string, _context?: string, _payload?: unknown) => undefined,
  warn: (_message: string, _context?: string, _payload?: unknown) => undefined,
  error: (_message: string, _context?: string, _payload?: unknown) => undefined,
});

const expectFirstArg = <Args extends unknown[]>(
  mockFn: Mock<(...args: Args) => unknown>,
): Args[0] => {
  const firstCall = mockFn.mock.calls[0];
  expect(firstCall).toBeDefined();
  if (!firstCall) {
    throw new Error("Expected mock to have at least one call");
  }
  return firstCall[0];
};

const expectCallArg = <Args extends unknown[]>(
  mockFn: Mock<(...args: Args) => unknown>,
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
  const ownedObsManagers: OBSConnectionManager[] = [];
  let viewerCountSystem: InstanceType<typeof ViewerCountSystem>;
  let platforms: {
    youtube: {
      getViewerCount: Mock<(...args: []) => Promise<unknown>>;
    };
    twitch: {
      getViewerCount: Mock<(...args: []) => Promise<unknown>>;
    };
  };
  let logger: ReturnType<typeof createViewerCountLogger>;
  let testConfig: ReturnType<typeof createConfigFixture>;

  const createRealObsManager = async () => {
    const socket = new SyntheticObsSocket();
    const obsManager = new OBSConnectionManager({
      obs: socket,
      config: {
        enabled: true,
        address: "ws://synthetic.invalid",
        password: "synthetic-password",
      },
    });
    ownedObsManagers.push(obsManager);
    await obsManager.connect();
    socket.call.mockClear();
    return { obsManager, socket };
  };

  beforeEach(async () => {
    testClock.reset();
    testConfig = createConfigFixture();
    logger = createViewerCountLogger();
    platforms = {
      youtube: {
        getViewerCount: vi.fn<(...args: []) => Promise<unknown>>(async () => 1000),
      },
      twitch: {
        getViewerCount: vi.fn<(...args: []) => Promise<unknown>>(async () => 2000),
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
    try {
      if (viewerCountSystem) {
        viewerCountSystem.stopPolling();
        await viewerCountSystem.cleanup();
      }
      for (const obsManager of ownedObsManagers.splice(0)) {
        obsManager.dispose();
        await obsManager.disconnect();
      }
    } finally {
      vi.clearAllMocks();
      vi.restoreAllMocks();
    }
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
        onViewerCountUpdate: vi.fn<(...args: unknown[]) => unknown>(),
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
      await viewerCountSystem.pollPlatform("youtube");
      await viewerCountSystem.pollPlatform("twitch");

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
      await viewerCountSystem.pollPlatform("youtube");
      await viewerCountSystem.pollPlatform("twitch");

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
    const createObsConfigFixture = () => ({
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
      const { obsManager, socket } = await createRealObsManager();
      const obsObserver = new OBSViewerCountObserver(
        obsManager,
        createViewerCountLogger(),
        {
          config: createObsConfigFixture(),
        },
      );
      viewerCountSystem.addObserver(obsObserver);

      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.pollPlatform("youtube");
      await viewerCountSystem.pollPlatform("twitch");

      const obsUpdateCalls = socket.call.mock.calls.filter(
        (call) => call[0] === "SetInputSettings",
      );
      expect(obsUpdateCalls.length).toBeGreaterThan(0);
      expect(viewerCountSystem.getViewerCount("youtube")).toBe(1000);

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

    test("initializes OBS from measured snapshots only and cleans up observers", async () => {
      const { obsManager, socket } = await createRealObsManager();
      const obsObserver = new OBSViewerCountObserver(
        obsManager,
        createViewerCountLogger(),
        {
          config: { youtube: { viewerCountEnabled: true, viewerCountSource: "test-viewer-count-source" } },
          getViewerCountSnapshot: platform => viewerCountSystem.getViewerCountSnapshot(platform),
        },
      );

      viewerCountSystem.addObserver(obsObserver);
      await viewerCountSystem.initializeObservers();

      expect(socket.call.mock.calls.filter(call => call[0] === "SetInputSettings")).toEqual([
        ["SetInputSettings", { inputName: "test-viewer-count-source", inputSettings: { text: "—" }, overlay: true }],
      ]);
      socket.call.mockClear();
      viewerCountSystem.removeObserver(obsObserver.getObserverId());
      await viewerCountSystem.updateViewerCount("youtube", 42);
      viewerCountSystem.addObserver(obsObserver);
      await viewerCountSystem.initializeObservers();
      expect(socket.call.mock.calls.filter(call => call[0] === "SetInputSettings")).toEqual([
        ["SetInputSettings", { inputName: "test-viewer-count-source", inputSettings: { text: "42" }, overlay: true }],
      ]);

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
      await viewerCountSystem.pollPlatform("youtube");
      await viewerCountSystem.pollPlatform("twitch");

      expect(healthyObserver.onViewerCountUpdate).toHaveBeenCalled();
      expect(faultyObserver.onViewerCountUpdate).toHaveBeenCalled();
      expect(viewerCountSystem.getViewerCount("youtube")).toBe(1000);
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
      await viewerCountSystem.pollPlatform("youtube");
      await viewerCountSystem.pollPlatform("twitch");

      const calls = multiPlatformObserver.onViewerCountUpdate.mock.calls;
      const platforms = calls.map((call) => call[0].platform);

      expect(platforms).toContain("youtube");
      expect(platforms).toContain("twitch");
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });

    test("broadcasts all platform updates to a registered observer", async () => {
      const youtubeObserver = {
        getObserverId: () => "youtube-only-observer",
        onViewerCountUpdate: vi.fn<(...args: [ViewerCountUpdate]) => void>(),
        onStreamStatusChange: vi.fn<(...args: unknown[]) => unknown>(),
      };
      viewerCountSystem.addObserver(youtubeObserver);

      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.updateStreamStatus("twitch", true);
      await viewerCountSystem.pollPlatform("youtube");
      await viewerCountSystem.pollPlatform("twitch");

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
      const dynamicObserver = createTestObserver("dynamic-observer");
      viewerCountSystem.addObserver(dynamicObserver);

      await viewerCountSystem.pollPlatform("youtube");

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
      const retainedObserver = createTestObserver("retained-observer");
      viewerCountSystem.addObserver(removableObserver);
      viewerCountSystem.addObserver(retainedObserver);
      await viewerCountSystem.updateViewerCount("youtube", 1000);
      expect(removableObserver.onViewerCountUpdate).toHaveBeenCalledTimes(1);
      expect(retainedObserver.onViewerCountUpdate).toHaveBeenCalledTimes(1);
      viewerCountSystem.removeObserver("removable-observer");
      await viewerCountSystem.updateViewerCount("youtube", 1234);
      expect(removableObserver.onViewerCountUpdate).toHaveBeenCalledTimes(1);
      expect(retainedObserver.onViewerCountUpdate).toHaveBeenCalledTimes(2);
      expect(retainedObserver.onViewerCountUpdate.mock.calls.at(-1)?.[0].count).toBe(1234);
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
      await viewerCountSystem.pollPlatform("youtube");
      await viewerCountSystem.pollPlatform("twitch");

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
      expect(viewerCountSystem.getViewerCount("youtube")).toBe(1000);
    });

    test("should handle concurrent observer notifications with all observers receiving updates", async () => {
      const asyncObservers: Array<ReturnType<typeof createTestObserver>> = [];
      for (let i = 0; i < 10; i++) {
        const observer = createTestObserver(`async-observer-${i}`);
        observer.onViewerCountUpdate.mockImplementation(async () => {
          await Promise.resolve();
        });
        asyncObservers.push(observer);
      }
      asyncObservers.forEach((observer) =>
        viewerCountSystem.addObserver(observer),
      );

      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.pollPlatform("youtube");
      await viewerCountSystem.pollPlatform("twitch");

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
      await viewerCountSystem.pollPlatform("youtube");
      await viewerCountSystem.pollPlatform("twitch");

      const updateData = expectFirstArg(qualityObserver.onViewerCountUpdate);

      expect(updateData.platform).toMatch(/^(youtube|twitch|tiktok)$/);
      expect(updateData.count).toBeGreaterThanOrEqual(0);
      expect(updateData.isStreamLive).toBe(true);
      expect(updateData.timestamp).toBeInstanceOf(Date);
      expectNoTechnicalArtifacts(updateData.platform);
    });
  });
});

function createTestObserver(id: string): TestObserver {
  return {
    getObserverId: () => id,
    onViewerCountUpdate: vi.fn<(...args: [ViewerCountUpdate]) => Promise<void>>(),
    onStreamStatusChange: vi.fn<(...args: [StreamStatusUpdate]) => unknown>(),
    initialize: vi.fn<(...args: []) => Promise<void>>(),
    cleanup: vi.fn<(...args: []) => Promise<void>>(),
  };
}
