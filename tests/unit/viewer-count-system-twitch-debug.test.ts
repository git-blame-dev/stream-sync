import { vi, type Mock, describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createRequire } from "node:module";



import { createConfigFixture } from "../helpers/config-fixture";
import { noOpLogger } from "../helpers/mock-factories";

const load = createRequire(import.meta.url);

const flushImmediatePoll = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

type ViewerCountSystemInstance = {
  streamStatus: Record<string, boolean>;
  getViewerCount: (platform: string) => number | undefined;
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

type ViewerCountPlatformFixture = {
  getViewerCount: Mock<(...args: []) => Promise<number>>;
};

type ViewerCountObserverFixture = {
  getObserverId: Mock<(...args: []) => string>;
  onViewerCountUpdate: Mock<(...args: [payload: unknown]) => Promise<void>>;
};

type ViewerCountSystemConstructor = new (args: {
  platforms: unknown;
  logger: unknown;
  config: unknown;
}) => ViewerCountSystemInstance;

describe("Twitch Viewer Count System Debug", () => {
  let ViewerCountSystem: ViewerCountSystemConstructor;
  let mockTwitchPlatform: ViewerCountPlatformFixture;
  let mockPlatforms: {
    twitch: ViewerCountPlatformFixture;
    youtube: ViewerCountPlatformFixture;
    tiktok: ViewerCountPlatformFixture;
  };
  let testConfig: ReturnType<typeof createConfigFixture>;

  beforeEach(() => {
    ({ ViewerCountSystem } = load("../../src/utils/viewer-count"));

    testConfig = createConfigFixture({
      general: { viewerCountPollingIntervalMs: 30000 },
    });

    mockTwitchPlatform = {
      getViewerCount: vi.fn<(...args: []) => Promise<number>>().mockResolvedValue(42),
    };

    mockPlatforms = {
      twitch: mockTwitchPlatform,
      youtube: { getViewerCount: vi.fn<(...args: []) => Promise<number>>().mockResolvedValue(100) },
      tiktok: { getViewerCount: vi.fn<(...args: []) => Promise<number>>().mockResolvedValue(25) },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(viewerSystem.getViewerCount("twitch")).toBe(0);
  });

  test("starts polling live Twitch counts immediately", async () => {
    const viewerSystem = createViewerSystem();

    viewerSystem.startPolling();
    await flushImmediatePoll();

    expect(viewerSystem.isPolling).toBe(true);
    expect(mockTwitchPlatform.getViewerCount).toHaveBeenCalledTimes(1);
    expect(viewerSystem.getViewerCount("twitch")).toBe(42);
    expect(viewerSystem.getViewerCount("youtube")).toBe(0);
    expect(viewerSystem.getViewerCount("tiktok")).toBe(0);

    viewerSystem.stopPolling();
  });

  test("fetches Twitch viewer count when polling", async () => {
    const viewerSystem = createViewerSystem();

    const mockObserver: ViewerCountObserverFixture = {
      getObserverId: vi.fn<(...args: []) => string>().mockReturnValue("testObserver"),
      onViewerCountUpdate: vi.fn<(...args: [payload: unknown]) => Promise<void>>().mockResolvedValue(),
    };
    viewerSystem.addObserver(mockObserver);

    await viewerSystem.pollPlatform("twitch");

    expect(mockTwitchPlatform.getViewerCount).toHaveBeenCalled();
    expect(viewerSystem.getViewerCount("twitch")).toBe(42);
    expect(mockObserver.onViewerCountUpdate).toHaveBeenCalledTimes(1);
    const observerCall = mockObserver.onViewerCountUpdate.mock.calls[0];
    if (!observerCall) {
      throw new Error("Expected one viewer count observer update");
    }
    expect(observerCall[0]).toEqual(
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
    expect(viewerSystem.getViewerCount("twitch")).toBe(0);
  });

  test("uses correct polling configuration", () => {
    const viewerSystem = createViewerSystem();
    viewerSystem.startPolling();

    expect(viewerSystem.pollingInterval).toBe(30 * 1000);
    expect(viewerSystem.isPolling).toBe(true);
  });
});
