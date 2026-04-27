import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createRequire } from "node:module";

import {
  createMockFn,
  restoreAllMocks,
} from "../helpers/bun-mock-utils";
import { createConfigFixture } from "../helpers/config-fixture";
import { noOpLogger } from "../helpers/mock-factories";

const load = createRequire(import.meta.url);

type ViewerCountSystemInstance = {
  streamStatus: Record<string, boolean>;
  counts: Record<string, number>;
  startPolling: () => void;
  stopPolling: () => void;
  pollPlatform: (platform: string) => Promise<void>;
  addObserver: (observer: {
    getObserverId: () => string;
    onViewerCountUpdate: (...args: unknown[]) => Promise<void>;
  }) => void;
  pollingInterval: number | null;
  isPolling: boolean;
};

type ViewerCountSystemConstructor = new (args: {
  platforms: unknown;
  logger: unknown;
  config: unknown;
}) => ViewerCountSystemInstance;

describe("Twitch Viewer Count System Debug", () => {
  let ViewerCountSystem: ViewerCountSystemConstructor;
  let mockTwitchPlatform: { getViewerCount: ReturnType<typeof createMockFn> };
  let mockPlatforms: {
    twitch: { getViewerCount: ReturnType<typeof createMockFn> };
    youtube: { getViewerCount: ReturnType<typeof createMockFn> };
    tiktok: { getViewerCount: ReturnType<typeof createMockFn> };
  };
  let testConfig: ReturnType<typeof createConfigFixture>;

  beforeEach(() => {
    ({ ViewerCountSystem } = load("../../src/utils/viewer-count"));

    testConfig = createConfigFixture({
      general: { viewerCountPollingIntervalMs: 30000 },
    });

    mockTwitchPlatform = {
      getViewerCount: createMockFn().mockResolvedValue(42),
    };

    mockPlatforms = {
      twitch: mockTwitchPlatform,
      youtube: { getViewerCount: createMockFn().mockResolvedValue(100) },
      tiktok: { getViewerCount: createMockFn().mockResolvedValue(25) },
    };
  });

  afterEach(() => {
    restoreAllMocks();
  });

  const createViewerSystem = () => {
    return new ViewerCountSystem({
      platforms: mockPlatforms,
      logger: noOpLogger,
      config: testConfig,
    });
  };

  test("initializes with Twitch set to always live", () => {
    const viewerSystem = createViewerSystem();

    expect(viewerSystem.streamStatus.twitch).toBe(true);
    expect(viewerSystem.streamStatus.youtube).toBe(false);
    expect(viewerSystem.streamStatus.tiktok).toBe(false);
    expect(viewerSystem.counts.twitch).toBe(0);
  });

  test("starts polling live Twitch counts immediately", async () => {
    const viewerSystem = createViewerSystem();

    viewerSystem.startPolling();
    await new Promise((resolve) => setImmediate(resolve));

    expect(viewerSystem.isPolling).toBe(true);
    expect(viewerSystem.counts.twitch).toBe(42);
    expect(viewerSystem.counts.youtube).toBe(0);
    expect(viewerSystem.counts.tiktok).toBe(0);

    viewerSystem.stopPolling();
  });

  test("fetches Twitch viewer count when polling", async () => {
    const viewerSystem = createViewerSystem();

    const mockObserver = {
      getObserverId: createMockFn().mockReturnValue("testObserver"),
      onViewerCountUpdate: createMockFn().mockResolvedValue(),
    };
    viewerSystem.addObserver(mockObserver);

    await viewerSystem.pollPlatform("twitch");

    expect(mockTwitchPlatform.getViewerCount).toHaveBeenCalled();
    expect(viewerSystem.counts.twitch).toBe(42);
    expect(mockObserver.onViewerCountUpdate).toHaveBeenCalledTimes(1);
    expect(mockObserver.onViewerCountUpdate.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        platform: "twitch",
        count: 42,
        previousCount: 0,
      }),
    );
  });

  test("handles Twitch API errors gracefully", async () => {
    const viewerSystem = createViewerSystem();
    mockTwitchPlatform.getViewerCount.mockRejectedValue(
      new Error("Twitch API rate limit exceeded"),
    );

    await viewerSystem.pollPlatform("twitch");

    expect(mockTwitchPlatform.getViewerCount).toHaveBeenCalled();
    expect(viewerSystem.counts.twitch).toBe(0);
  });

  test("uses correct polling configuration", () => {
    const viewerSystem = createViewerSystem();
    viewerSystem.startPolling();

    expect(viewerSystem.pollingInterval).toBe(30 * 1000);
    expect(viewerSystem.isPolling).toBe(true);
  });
});
