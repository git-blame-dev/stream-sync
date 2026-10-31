import { vi, describe, it, expect, afterEach, beforeEach } from 'bun:test';

import { noOpLogger } from "../../../../helpers/mock-factories";
const {
  useFakeTimers,
  useRealTimers,
  setSystemTime,
  advanceTimersByTime,
} = require("../../../../helpers/bun-timers");
import { TikTokPlatform } from "../../../../../src/platforms/tiktok.ts";

type TikTokPlatformConfig = ConstructorParameters<typeof TikTokPlatform>[0];
type TikTokPlatformDependencies = ConstructorParameters<typeof TikTokPlatform>[1];

const createPlatform = (
  configOverrides: Partial<TikTokPlatformConfig> = {},
  dependencyOverrides: TikTokPlatformDependencies = {},
) => {
  const logger = dependencyOverrides.logger || noOpLogger;
  const notificationManager = dependencyOverrides.notificationManager || {
    emit: vi.fn<(...args: unknown[]) => unknown>(),
    on: vi.fn<(...args: unknown[]) => unknown>(),
    removeListener: vi.fn<(...args: unknown[]) => unknown>(),
    handleNotification: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
  };
  const connectionFactory = dependencyOverrides.connectionFactory || {
    createConnection: vi.fn<(...args: unknown[]) => { on: import("bun:test").Mock<(...args: unknown[]) => unknown>; emit: import("bun:test").Mock<(...args: unknown[]) => unknown>; removeAllListeners: import("bun:test").Mock<(...args: unknown[]) => unknown>; connect: import("bun:test").Mock<(..._args: unknown[]) => Promise<undefined>>; disconnect: import("bun:test").Mock<(...args: unknown[]) => unknown>; }>().mockReturnValue({
      on: vi.fn<(...args: unknown[]) => unknown>(),
      emit: vi.fn<(...args: unknown[]) => unknown>(),
      removeAllListeners: vi.fn<(...args: unknown[]) => unknown>(),
      connect: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      disconnect: vi.fn<(...args: unknown[]) => unknown>(),
    }),
  };

  const TikTokWebSocketClient =
    dependencyOverrides.TikTokWebSocketClient ||
    vi.fn(() => ({
      on: vi.fn<(...args: unknown[]) => unknown>(),
      off: vi.fn<(...args: unknown[]) => unknown>(),
      connect: vi.fn<(...args: unknown[]) => unknown>(),
      disconnect: vi.fn<(...args: unknown[]) => unknown>(),
      getState: vi.fn<(...args: unknown[]) => string>().mockReturnValue("DISCONNECTED"),
      isConnecting: false,
      isConnected: false,
    }));

  const config = {
    enabled: true,
    username: "testUser",
    ...configOverrides,
  };

  return new TikTokPlatform(config, {
    logger,
    notificationManager,
    TikTokWebSocketClient,
    connectionFactory,
    ...dependencyOverrides,
  });
};

describe("TikTokPlatform _shouldSkipDuplicatePlatformMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("basic deduplication", () => {
    it("returns isDuplicate=false for new messages", () => {
      const platform = createPlatform();

      const result = platform._shouldSkipDuplicatePlatformMessage({
        common: { msgId: "msg-1" },
      });

      expect(result.isDuplicate).toBe(false);
    });

    it("returns isDuplicate=true for duplicate messages within TTL", () => {
      const platform = createPlatform();

      platform._shouldSkipDuplicatePlatformMessage({
        common: { msgId: "msg-1" },
      });
      const result = platform._shouldSkipDuplicatePlatformMessage({
        common: { msgId: "msg-1" },
      });

      expect(result.isDuplicate).toBe(true);
    });

    it("returns isDuplicate=false for messages without msgId", () => {
      const platform = createPlatform();

      const result = platform._shouldSkipDuplicatePlatformMessage({
        someOtherField: "value",
      });

      expect(result.isDuplicate).toBe(false);
    });
  });

  describe("ttl expiry", () => {
    beforeEach(() => {
      useFakeTimers();
      setSystemTime(new Date("2025-01-15T12:00:00.000Z"));
    });

    afterEach(() => {
      useRealTimers();
    });

    it("does not treat a message as duplicate after TTL elapses", () => {
      const platform = createPlatform({}, { deduplicationTtlMs: 1000 });
      const messagePayload = { common: { msgId: "test-msg-ttl-1" } };

      const firstResult =
        platform._shouldSkipDuplicatePlatformMessage(messagePayload);
      const secondResult =
        platform._shouldSkipDuplicatePlatformMessage(messagePayload);

      expect(firstResult.isDuplicate).toBe(false);
      expect(secondResult.isDuplicate).toBe(true);

      advanceTimersByTime(1001);

      const thirdResult =
        platform._shouldSkipDuplicatePlatformMessage(messagePayload);

      expect(thirdResult.isDuplicate).toBe(false);
    });
  });

  describe("cache cleanup with injectable threshold", () => {
    it("performs cleanup when cache exceeds maxCacheSize", () => {
      const platform = createPlatform({}, { deduplicationMaxCacheSize: 3 });

      platform._shouldSkipDuplicatePlatformMessage({
        common: { msgId: "msg-1" },
      });
      platform._shouldSkipDuplicatePlatformMessage({
        common: { msgId: "msg-2" },
      });
      platform._shouldSkipDuplicatePlatformMessage({
        common: { msgId: "msg-3" },
      });
      const result = platform._shouldSkipDuplicatePlatformMessage({
        common: { msgId: "msg-4" },
      });

      expect(result.cleanupPerformed).toBe(true);
    });

    it("evicts oldest entries when cache remains over max after ttl cleanup", () => {
      const platform = createPlatform(
        {},
        {
          deduplicationMaxCacheSize: 3,
          deduplicationTtlMs: 60_000,
        },
      );

      platform._shouldSkipDuplicatePlatformMessage({
        common: { msgId: "msg-1" },
      });
      platform._shouldSkipDuplicatePlatformMessage({
        common: { msgId: "msg-2" },
      });
      platform._shouldSkipDuplicatePlatformMessage({
        common: { msgId: "msg-3" },
      });
      platform._shouldSkipDuplicatePlatformMessage({
        common: { msgId: "msg-4" },
      });

      expect(platform.recentPlatformMessageIds.size).toBe(3);
      expect(platform.recentPlatformMessageIds.has("msg-1")).toBe(false);
      expect(platform.recentPlatformMessageIds.has("msg-4")).toBe(true);
    });

    it("does not perform cleanup when cache is within threshold", () => {
      const platform = createPlatform({}, { deduplicationMaxCacheSize: 10 });

      platform._shouldSkipDuplicatePlatformMessage({
        common: { msgId: "msg-1" },
      });
      platform._shouldSkipDuplicatePlatformMessage({
        common: { msgId: "msg-2" },
      });
      const result = platform._shouldSkipDuplicatePlatformMessage({
        common: { msgId: "msg-3" },
      });

      expect(result.cleanupPerformed).toBe(false);
    });

    it("uses default maxCacheSize of 2000 when not specified", () => {
      const platform = createPlatform();

      expect(platform.deduplicationConfig.maxCacheSize).toBe(2000);
    });

    it("uses injectable maxCacheSize when specified", () => {
      const platform = createPlatform({}, { deduplicationMaxCacheSize: 50 });

      expect(platform.deduplicationConfig.maxCacheSize).toBe(50);
    });
  });
});
