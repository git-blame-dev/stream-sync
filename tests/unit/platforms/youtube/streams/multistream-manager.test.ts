import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockFn } from "../../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../../helpers/mock-factories";
import {
  useFakeTimers,
  useRealTimers,
  setSystemTime,
  advanceTimersByTime,
} from "../../../../helpers/bun-timers";
import * as testClock from "../../../../helpers/test-clock";
import {
  safeSetInterval,
  validateTimeout,
} from "../../../../../src/utils/timeout-validator";

import { createYouTubeMultiStreamManager } from "../../../../../src/platforms/youtube/streams/youtube-multistream-manager.ts";

type PlatformEventType = string;
type PlatformEventRecord = { type: PlatformEventType; payload: Record<string, unknown> };
type DisconnectRecord = {
  videoId: string;
  reason: string;
  options?: { requestImmediateRefresh?: boolean; source?: string } | undefined;
};
type WarnRecord = { msg: string; scope: string };
type ShortageStateFixture = {
  lastWarningTime: number | null;
  isInShortage: boolean;
  lastKnownAvailable: number;
  lastKnownRequired: number;
};
type LoggerFixture = {
  debug: (message: string, scope: string) => void;
  info: (message: string, scope: string) => void;
  warn: (message: string, scope: string) => void;
};
type MultiStreamPlatformFixture = {
  config: { maxStreams: number; streamPollingInterval: number; fullCheckInterval: number };
  connectionManager: {
    getConnectionCount: () => number;
    getAllVideoIds: () => string[];
    hasConnection: (videoId: string) => boolean;
  };
  getActiveYouTubeVideoIds: () => string[];
  getLiveVideoIds: () => Promise<string[]>;
  connectToYouTubeStream: (videoId: string) => Promise<void>;
  disconnectFromYouTubeStream: (
    videoId: string,
    reason: string,
    options?: { requestImmediateRefresh?: boolean; source?: string },
  ) => Promise<void>;
  checkStreamShortageAndWarn: (availableCount: number, maxStreams: number) => void;
  _logMultiStreamStatus: (includeDetails?: boolean, includeActiveStreamsList?: boolean) => void;
  _handleProcessingError: (message: string, error: unknown, category: string) => void;
  _handleConnectionErrorLogging: (message: string, error: unknown, category: string) => void;
  _handleError: (error: unknown, context: string) => void;
  logger: LoggerFixture;
  _emitPlatformEvent: (type: PlatformEventType, payload: Record<string, unknown>) => void;
  shortageState: ShortageStateFixture;
  monitoringInterval: number | ReturnType<typeof setInterval> | null;
  monitoringIntervalStart?: number;
  lastYouTubeVideoIdsUpdateTime?: number;
  lastFullStreamCheck: number | null;
  checkMultiStream: (options?: { throwOnError?: boolean }) => Promise<void>;
};

function createLoggerFixture(overrides: Partial<LoggerFixture> = {}): LoggerFixture {
  return {
    debug: (_message: string, _scope: string) => noOpLogger.debug(),
    info: (_message: string, _scope: string) => noOpLogger.info(),
    warn: (_message: string, _scope: string) => noOpLogger.warn(),
    ...overrides,
  };
}

describe("YouTube multi-stream manager", () => {
  beforeEach(() => {
    useFakeTimers();
    setSystemTime(new Date("2025-01-15T12:00:00.000Z"));
    testClock.set(1736942400000);
  });

  afterEach(() => {
    useRealTimers();
    testClock.reset();
  });

  const buildPlatform = (
    overrides: Partial<MultiStreamPlatformFixture> = {},
  ): MultiStreamPlatformFixture => {
    const shortageState: ShortageStateFixture = {
      lastWarningTime: null,
      isInShortage: false,
      lastKnownAvailable: 0,
      lastKnownRequired: 0,
    };
    const platform = {
      config: {
        maxStreams: 0,
        streamPollingInterval: 60,
        fullCheckInterval: 1000,
      },
      connectionManager: {
        getConnectionCount: createMockFn(() => 0),
        getAllVideoIds: createMockFn(() => []),
        hasConnection: createMockFn(() => false),
      },
      getActiveYouTubeVideoIds: createMockFn(() => []),
      getLiveVideoIds: createMockFn(async () => []),
      connectToYouTubeStream: createMockFn<[string], Promise<void>>().mockResolvedValue(undefined),
      disconnectFromYouTubeStream: createMockFn<
        [string, string, { requestImmediateRefresh?: boolean; source?: string }?],
        Promise<void>
      >().mockResolvedValue(undefined),
      checkStreamShortageAndWarn: createMockFn(),
      _logMultiStreamStatus: createMockFn(),
      _handleProcessingError: createMockFn(),
      _handleConnectionErrorLogging: createMockFn(),
      _handleError: createMockFn(),
      logger: createLoggerFixture(),
      _emitPlatformEvent: createMockFn(),
      shortageState,
      monitoringInterval: null,
      lastFullStreamCheck: null,
      checkMultiStream: createMockFn<[{ throwOnError?: boolean }?], Promise<void>>().mockResolvedValue(undefined),
      ...overrides,
    };

    return platform;
  };

  const buildManager = (platform: MultiStreamPlatformFixture) =>
    createYouTubeMultiStreamManager({
      platform,
      safeSetInterval,
      validateTimeout,
      now: testClock.now,
    });

  test("emits stream-detected platform:event when new streams appear", async () => {
    const emitted: PlatformEventRecord[] = [];
    const platform = buildPlatform({
      getLiveVideoIds: createMockFn(async () => ["stream-1"]),
      _emitPlatformEvent: (type: PlatformEventType, payload: Record<string, unknown>) => emitted.push({ type, payload }),
    });
    const manager = buildManager(platform);

    await manager.checkMultiStream();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: "platform:stream-detected",
      payload: expect.objectContaining({
        eventType: "stream-detected",
        newStreamIds: ["stream-1"],
        allStreamIds: ["stream-1"],
        detectionTime: testClock.now(),
      }),
    });
  });

  test("does not emit stream-detected when no new streams are found", async () => {
    const emitted: PlatformEventRecord[] = [];
    const platform = buildPlatform({
      getLiveVideoIds: createMockFn(async () => []),
      _emitPlatformEvent: (type: PlatformEventType, payload: Record<string, unknown>) => emitted.push({ type, payload }),
    });
    const manager = buildManager(platform);

    await manager.checkMultiStream();

    expect(emitted).toEqual([]);
  });

  describe("validation", () => {
    test("throws when platform is missing", () => {
      expect(() =>
        createYouTubeMultiStreamManager({
          safeSetInterval,
          validateTimeout,
          now: testClock.now,
        }),
      ).toThrow("YouTube multistream manager requires platform instance");
    });

    test("throws when safeSetInterval is missing", () => {
      expect(() =>
        createYouTubeMultiStreamManager({
          platform: buildPlatform(),
          validateTimeout,
          now: testClock.now,
        }),
      ).toThrow(
        "YouTube multistream manager requires safeSetInterval function",
      );
    });

    test("throws when validateTimeout is missing", () => {
      expect(() =>
        createYouTubeMultiStreamManager({
          platform: buildPlatform(),
          safeSetInterval,
          now: testClock.now,
        }),
      ).toThrow(
        "YouTube multistream manager requires validateTimeout function",
      );
    });

    test("throws when now is missing", () => {
      expect(() =>
        createYouTubeMultiStreamManager({
          platform: buildPlatform(),
          safeSetInterval,
          validateTimeout,
        }),
      ).toThrow("YouTube multistream manager requires now function");
    });
  });

  describe("startMonitoring", () => {
    test("clears existing monitoring interval before starting new one", async () => {
      const emitted: PlatformEventRecord[] = [];
      const platform = buildPlatform({
        monitoringInterval: 123,
        config: {
          streamPollingInterval: 1,
          fullCheckInterval: 1000,
          maxStreams: 0,
        },
        getLiveVideoIds: createMockFn(async () => ["stream-1"]),
        _emitPlatformEvent: (type: PlatformEventType, payload: Record<string, unknown>) => emitted.push({ type, payload }),
      });
      const manager = buildManager(platform);
      platform.checkMultiStream = () => manager.checkMultiStream();

      await manager.startMonitoring();
      const firstEmitCount = emitted.length;

      await manager.startMonitoring();

      expect(emitted.length).toBeGreaterThanOrEqual(firstEmitCount);
    });

    test("performs periodic checks at configured interval", async () => {
      const emitted: PlatformEventRecord[] = [];
      const platform = buildPlatform({
        config: {
          streamPollingInterval: 1,
          fullCheckInterval: 1000,
          maxStreams: 0,
        },
        getLiveVideoIds: createMockFn(async () => ["stream-1"]),
        _emitPlatformEvent: (type: PlatformEventType, payload: Record<string, unknown>) => emitted.push({ type, payload }),
      });
      const manager = buildManager(platform);
      platform.checkMultiStream = () => manager.checkMultiStream();

      await manager.startMonitoring();
      const initialEmitCount = emitted.length;

      await advanceTimersByTime(1100);

      expect(emitted.length).toBeGreaterThan(initialEmitCount);
    });

    test("records monitoring start time", async () => {
      setSystemTime(new Date("2025-01-15T12:05:00.000Z"));
      const expectedTime = testClock.now();

      const platform = buildPlatform({
        getLiveVideoIds: createMockFn(async () => []),
      });
      const manager = buildManager(platform);

      await manager.startMonitoring();

      expect(platform.monitoringIntervalStart).toBe(expectedTime);
    });

    test("propagates error from initial check when throwOnError is true", async () => {
      const initialError = new Error("stream detection failed");
      const platform = buildPlatform({
        checkMultiStream: createMockFn(async () => {
          throw initialError;
        }),
      });
      const manager = buildManager(platform);

      await expect(manager.startMonitoring()).rejects.toThrow(
        "stream detection failed",
      );
    });
  });

  describe("requestImmediateRefresh", () => {
    test("coalesces duplicate immediate refresh requests into one check", async () => {
      const getLiveVideoIds = createMockFn(async () => []);
      const platform = buildPlatform({
        getLiveVideoIds,
      });
      const manager = buildManager(platform);

      await Promise.all([
        manager.requestImmediateRefresh({ source: "duplicate-1" }),
        manager.requestImmediateRefresh({ source: "duplicate-2" }),
      ]);

      expect(getLiveVideoIds).toHaveBeenCalledTimes(1);
    });

    test("runs one follow-up check when requested during an in-progress check", async () => {
      let releaseFirstCheck: () => void = () => undefined;
      const firstCheckGate = new Promise<void>((resolve) => {
        releaseFirstCheck = resolve;
      });
      let callCount = 0;
      const getLiveVideoIds = createMockFn(async () => {
        callCount += 1;
        if (callCount === 1) {
          await firstCheckGate;
        }
        return [];
      });

      const platform = buildPlatform({ getLiveVideoIds });
      const manager = buildManager(platform);

      const inProgressCheck = manager.checkMultiStream();
      const immediateRefresh = manager.requestImmediateRefresh({
        source: "during-check",
      });

      expect(getLiveVideoIds).toHaveBeenCalledTimes(1);

      releaseFirstCheck();
      await inProgressCheck;
      await immediateRefresh;

      expect(getLiveVideoIds).toHaveBeenCalledTimes(2);
    });
  });

  describe("checkMultiStream at capacity", () => {
    test("skips full check when at maxStreams and within full check interval", async () => {
      const currentTime = testClock.now();
      const platform = buildPlatform({
        config: {
          maxStreams: 2,
          streamPollingInterval: 60,
          fullCheckInterval: 60000,
        },
        connectionManager: {
          getConnectionCount: createMockFn(() => 2),
          getAllVideoIds: createMockFn(() => ["stream-1", "stream-2"]),
          hasConnection: createMockFn(() => true),
        },
        getActiveYouTubeVideoIds: createMockFn(() => ["stream-1", "stream-2"]),
        lastFullStreamCheck: currentTime - 50,
      });
      const manager = buildManager(platform);

      await manager.checkMultiStream();

      expect(platform.lastFullStreamCheck).toBe(currentTime - 50);
    });

    test("updates lastFullStreamCheck when performing full check after interval exceeded", async () => {
      const currentTime = testClock.now();
      const platform = buildPlatform({
        config: {
          maxStreams: 2,
          streamPollingInterval: 60,
          fullCheckInterval: 1000,
        },
        connectionManager: {
          getConnectionCount: createMockFn(() => 2),
          getAllVideoIds: createMockFn(() => ["stream-1", "stream-2"]),
          hasConnection: createMockFn(() => true),
        },
        getActiveYouTubeVideoIds: createMockFn(() => ["stream-1", "stream-2"]),
        getLiveVideoIds: createMockFn(async () => ["stream-1", "stream-2"]),
        lastFullStreamCheck: currentTime - 5000,
      });
      const manager = buildManager(platform);

      await manager.checkMultiStream();

      expect(platform.lastFullStreamCheck).toBe(currentTime);
    });

    test("preserves streams omitted from a partial full check", async () => {
      const currentTime = testClock.now();
      const disconnected: DisconnectRecord[] = [];
      const platform = buildPlatform({
        config: {
          maxStreams: 2,
          streamPollingInterval: 60,
          fullCheckInterval: 1000,
        },
        connectionManager: {
          getConnectionCount: createMockFn(() => 2),
          getAllVideoIds: createMockFn(() => ["stream-1", "stream-2"]),
          hasConnection: createMockFn(() => true),
        },
        getActiveYouTubeVideoIds: createMockFn(() => ["stream-1", "stream-2"]),
        getLiveVideoIds: createMockFn(async () => ["stream-1"]),
        disconnectFromYouTubeStream: createMockFn(
          async (videoId: string, reason: string, options?: { requestImmediateRefresh?: boolean; source?: string }) => {
            disconnected.push({ videoId, reason, options });
          },
        ),
        lastFullStreamCheck: currentTime - 5000,
      });
      const manager = buildManager(platform);

      await manager.checkMultiStream();

      expect(disconnected).toEqual([]);
    });

    test("defers newly detected streams at capacity without evicting existing streams", async () => {
      const currentTime = testClock.now();
      const connected: string[] = [];
      const disconnected: DisconnectRecord[] = [];
      const platform = buildPlatform({
        config: {
          maxStreams: 2,
          streamPollingInterval: 60,
          fullCheckInterval: 1000,
        },
        connectionManager: {
          getConnectionCount: createMockFn(() => 2),
          getAllVideoIds: createMockFn(() => ["stream-1", "stream-2"]),
          hasConnection: createMockFn((videoId: string) =>
            videoId === "stream-1" || videoId === "stream-2",
          ),
        },
        getActiveYouTubeVideoIds: createMockFn(() => ["stream-1", "stream-2"]),
        getLiveVideoIds: createMockFn(async () => ["stream-1", "stream-3"]),
        connectToYouTubeStream: createMockFn(async (videoId: string) => {
          connected.push(videoId);
        }),
        disconnectFromYouTubeStream: createMockFn(
          async (videoId: string, reason: string, options?: { requestImmediateRefresh?: boolean; source?: string }) => {
            disconnected.push({ videoId, reason, options });
          },
        ),
        lastFullStreamCheck: currentTime - 5000,
      });
      const manager = buildManager(platform);

      await manager.checkMultiStream();

      expect(connected).toEqual([]);
      expect(disconnected).toEqual([]);
    });

    test("preserves connections when stream detection returns empty at capacity", async () => {
      const currentTime = testClock.now();
      const disconnected: string[] = [];
      const platform = buildPlatform({
        config: {
          maxStreams: 2,
          streamPollingInterval: 60,
          fullCheckInterval: 1000,
        },
        connectionManager: {
          getConnectionCount: createMockFn(() => 2),
          getAllVideoIds: createMockFn(() => ["stream-1", "stream-2"]),
          hasConnection: createMockFn(() => true),
        },
        getActiveYouTubeVideoIds: createMockFn(() => ["stream-1", "stream-2"]),
        getLiveVideoIds: createMockFn(async () => []),
        disconnectFromYouTubeStream: createMockFn(async (videoId: string) => {
          disconnected.push(videoId);
        }),
        lastFullStreamCheck: currentTime - 5000,
      });
      const manager = buildManager(platform);

      await manager.checkMultiStream();

      expect(disconnected).toEqual([]);
    });
  });

  describe("maxStreams limiting", () => {
    test("limits streams to maxStreams when more are detected", async () => {
      const connected: string[] = [];
      const platform = buildPlatform({
        config: {
          maxStreams: 2,
          streamPollingInterval: 60,
          fullCheckInterval: 1000,
        },
        getLiveVideoIds: createMockFn(async () => ["s1", "s2", "s3", "s4"]),
        connectToYouTubeStream: createMockFn(async (videoId: string) => {
          connected.push(videoId);
        }),
      });
      const manager = buildManager(platform);

      await manager.checkMultiStream();

      expect(connected).toEqual(["s1", "s2"]);
    });
  });

  describe("connection error handling", () => {
    test("continues connecting other streams when one stream connection fails", async () => {
      const connected: string[] = [];
      const platform = buildPlatform({
        getLiveVideoIds: createMockFn(async () => ["s1", "s2"]),
        connectToYouTubeStream: createMockFn(async (videoId: string) => {
          if (videoId === "s1") throw new Error("connection failed");
          connected.push(videoId);
        }),
      });
      const manager = buildManager(platform);

      await manager.checkMultiStream();

      expect(connected).toEqual(["s2"]);
    });

    test("retries a stream on later checks when prior connection attempt failed", async () => {
      const attempted: string[] = [];
      let shouldFail = true;
      const connectedVideoIds = new Set<string>();

      const platform = buildPlatform({
        connectionManager: {
          getConnectionCount: createMockFn(() => connectedVideoIds.size),
          getAllVideoIds: createMockFn(() => Array.from(connectedVideoIds)),
          hasConnection: createMockFn((videoId: string) =>
            connectedVideoIds.has(videoId),
          ),
        },
        getActiveYouTubeVideoIds: createMockFn(() =>
          Array.from(connectedVideoIds),
        ),
        getLiveVideoIds: createMockFn(async () => ["retry-stream"]),
        connectToYouTubeStream: createMockFn(async (videoId: string) => {
          attempted.push(videoId);
          if (shouldFail) {
            shouldFail = false;
            throw new Error("first attempt failed");
          }
          connectedVideoIds.add(videoId);
        }),
      });
      const manager = buildManager(platform);

      await manager.checkMultiStream();
      expect(attempted).toEqual(["retry-stream"]);
      expect(connectedVideoIds.has("retry-stream")).toBe(false);

      await manager.checkMultiStream();
      expect(attempted).toEqual(["retry-stream", "retry-stream"]);
      expect(connectedVideoIds.has("retry-stream")).toBe(true);
    });
  });

  describe("stream detection failure preservation", () => {
    test("preserves existing connections when detection returns empty", async () => {
      const disconnected: string[] = [];
      const platform = buildPlatform({
        connectionManager: {
          getConnectionCount: createMockFn(() => 1),
          getAllVideoIds: createMockFn(() => ["existing-stream"]),
          hasConnection: createMockFn(() => true),
        },
        getActiveYouTubeVideoIds: createMockFn(() => []),
        getLiveVideoIds: createMockFn(async () => []),
        disconnectFromYouTubeStream: createMockFn(async (videoId: string) => {
          disconnected.push(videoId);
        }),
      });
      const manager = buildManager(platform);

      await manager.checkMultiStream();

      expect(disconnected).toEqual([]);
    });

    test("preserves omitted existing streams while connecting newly detected streams", async () => {
      const connected: string[] = [];
      const disconnected: DisconnectRecord[] = [];
      const platform = buildPlatform({
        config: {
          maxStreams: 2,
          streamPollingInterval: 60,
          fullCheckInterval: 1000,
        },
        connectionManager: {
          getConnectionCount: createMockFn(() => 1),
          getAllVideoIds: createMockFn(() => ["old-stream"]),
          hasConnection: createMockFn((videoId: string) => videoId === "old-stream"),
        },
        getActiveYouTubeVideoIds: createMockFn(() => ["old-stream"]),
        getLiveVideoIds: createMockFn(async () => ["new-stream"]),
        connectToYouTubeStream: createMockFn(async (videoId: string) => {
          connected.push(videoId);
        }),
        disconnectFromYouTubeStream: createMockFn(
          async (videoId: string, reason: string, options?: { requestImmediateRefresh?: boolean; source?: string }) => {
            disconnected.push({ videoId, reason, options });
          },
        ),
      });
      const manager = buildManager(platform);

      await manager.checkMultiStream();

      expect(connected).toEqual(["new-stream"]);
      expect(disconnected).toEqual([]);
    });

    test("connects only available slots when preserving existing streams", async () => {
      const connected: string[] = [];
      const platform = buildPlatform({
        config: {
          maxStreams: 2,
          streamPollingInterval: 60,
          fullCheckInterval: 1000,
        },
        connectionManager: {
          getConnectionCount: createMockFn(() => 1),
          getAllVideoIds: createMockFn(() => ["existing-stream"]),
          hasConnection: createMockFn((videoId: string) => videoId === "existing-stream"),
        },
        getActiveYouTubeVideoIds: createMockFn(() => ["existing-stream"]),
        getLiveVideoIds: createMockFn(async () => ["new-stream-1", "new-stream-2", "new-stream-3"]),
        connectToYouTubeStream: createMockFn(async (videoId: string) => {
          connected.push(videoId);
        }),
      });
      const manager = buildManager(platform);

      await manager.checkMultiStream();

      expect(connected).toEqual(["new-stream-1"]);
    });
  });

  describe("checkMultiStream error handling", () => {
    test("completes without throwing when stream detection fails and throwOnError is false", async () => {
      const platform = buildPlatform({
        getLiveVideoIds: createMockFn(async () => {
          throw new Error("api error");
        }),
      });
      const manager = buildManager(platform);

      await expect(manager.checkMultiStream()).resolves.toBeUndefined();
    });

    test("throws error when stream detection fails and throwOnError is true", async () => {
      const platform = buildPlatform({
        getLiveVideoIds: createMockFn(async () => {
          throw new Error("api error");
        }),
      });
      const manager = buildManager(platform);

      await expect(
        manager.checkMultiStream({ throwOnError: true }),
      ).rejects.toThrow("api error");
    });
  });

  describe("checkStreamShortageAndWarn", () => {
    test("warns when available streams are less than maxStreams", () => {
      const warnCalls: WarnRecord[] = [];
      const platform = buildPlatform({
        logger: createLoggerFixture({
          warn: (msg: string, scope: string) => {
            warnCalls.push({ msg, scope });
          },
        }),
      });
      const manager = buildManager(platform);

      manager.checkStreamShortageAndWarn(1, 3);

      expect(warnCalls).toHaveLength(1);
      expect(warnCalls[0]?.msg).toContain("Stream shortage detected");
      expect(platform.shortageState.isInShortage).toBe(true);
    });

    test("throttles warning when shortage persists within interval", () => {
      const currentTime = testClock.now();
      const warnCalls: string[] = [];
      const infoCalls: string[] = [];
      const platform = buildPlatform({
        config: { maxStreams: 0, streamPollingInterval: 60, fullCheckInterval: 60000 },
        shortageState: {
          lastWarningTime: currentTime - 100,
          isInShortage: true,
          lastKnownAvailable: 1,
          lastKnownRequired: 3,
        },
        logger: createLoggerFixture({
          warn: (msg: string) => {
            warnCalls.push(msg);
          },
          info: (msg: string) => {
            infoCalls.push(msg);
          },
        }),
      });
      const manager = buildManager(platform);

      manager.checkStreamShortageAndWarn(1, 3);

      expect(warnCalls).toHaveLength(0);
      expect(infoCalls.some((msg) => msg.includes("shortage persists"))).toBe(
        true,
      );
    });

    test("logs resolution when shortage is resolved", () => {
      const currentTime = testClock.now();
      const infoCalls: string[] = [];
      const platform = buildPlatform({
        shortageState: {
          lastWarningTime: currentTime - 500,
          isInShortage: true,
          lastKnownAvailable: 1,
          lastKnownRequired: 3,
        },
        logger: createLoggerFixture({
          info: (msg: string) => {
            infoCalls.push(msg);
          },
        }),
      });
      const manager = buildManager(platform);

      manager.checkStreamShortageAndWarn(3, 3);

      expect(infoCalls.some((msg) => msg.includes("shortage resolved"))).toBe(
        true,
      );
      expect(platform.shortageState.isInShortage).toBe(false);
    });

    test("does not log resolution when not previously in shortage", () => {
      const infoCalls: string[] = [];
      const platform = buildPlatform({
        shortageState: {
          lastWarningTime: null,
          isInShortage: false,
          lastKnownAvailable: 0,
          lastKnownRequired: 0,
        },
        logger: createLoggerFixture({
          info: (msg: string) => {
            infoCalls.push(msg);
          },
        }),
      });
      const manager = buildManager(platform);

      manager.checkStreamShortageAndWarn(3, 3);

      expect(infoCalls.filter((msg) => msg.includes("shortage"))).toHaveLength(
        0,
      );
    });
  });

  describe("logStatus", () => {
    test("logs ready and total connection counts", () => {
      const infoCalls: string[] = [];
      const platform = buildPlatform({
        connectionManager: {
          getConnectionCount: createMockFn(() => 2),
          getAllVideoIds: createMockFn(() => ["s1", "s2"]),
          hasConnection: createMockFn(() => true),
        },
        getActiveYouTubeVideoIds: createMockFn(() => ["s1"]),
        logger: createLoggerFixture({
          info: (msg: string) => {
            infoCalls.push(msg);
          },
        }),
      });
      const manager = buildManager(platform);

      manager.logStatus();

      expect(infoCalls.some((msg) => msg.includes("1 ready"))).toBe(true);
      expect(infoCalls.some((msg) => msg.includes("2 total"))).toBe(true);
    });

    test("logs pending connections when includeDetails is true", () => {
      const infoCalls: string[] = [];
      const platform = buildPlatform({
        connectionManager: {
          getConnectionCount: createMockFn(() => 2),
          getAllVideoIds: createMockFn(() => ["s1", "s2"]),
          hasConnection: createMockFn(() => true),
        },
        getActiveYouTubeVideoIds: createMockFn(() => ["s1"]),
        logger: createLoggerFixture({
          info: (msg: string) => {
            infoCalls.push(msg);
          },
        }),
      });
      const manager = buildManager(platform);

      manager.logStatus(true);

      expect(
        infoCalls.some((msg) => msg.includes("Waiting for stream to start")),
      ).toBe(true);
    });

    test("logs active streams list when includeActiveStreamsList is true", () => {
      const infoCalls: string[] = [];
      const debugCalls: string[] = [];
      const platform = buildPlatform({
        connectionManager: {
          getConnectionCount: createMockFn(() => 1),
          getAllVideoIds: createMockFn(() => ["s1"]),
          hasConnection: createMockFn(() => true),
        },
        getActiveYouTubeVideoIds: createMockFn(() => ["s1"]),
        logger: createLoggerFixture({
          info: (msg: string) => {
            infoCalls.push(msg);
          },
          debug: (msg: string) => {
            debugCalls.push(msg);
          },
        }),
      });
      const manager = buildManager(platform);

      manager.logStatus(false, true);

      expect(infoCalls.some((msg) => msg.includes("Active streams"))).toBe(
        true,
      );
    });

    test("logs no connections message when none exist", () => {
      const debugCalls: string[] = [];
      const platform = buildPlatform({
        connectionManager: {
          getConnectionCount: createMockFn(() => 0),
          getAllVideoIds: createMockFn(() => []),
          hasConnection: createMockFn(() => false),
        },
        getActiveYouTubeVideoIds: createMockFn(() => []),
        logger: createLoggerFixture({
          debug: (msg: string) => {
            debugCalls.push(msg);
          },
        }),
      });
      const manager = buildManager(platform);

      manager.logStatus();

      expect(
        debugCalls.some((msg) => msg.includes("No YouTube connections")),
      ).toBe(true);
    });
  });
});
