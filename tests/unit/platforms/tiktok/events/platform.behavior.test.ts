import { vi, describe, it, expect, afterEach } from 'bun:test';

import { noOpLogger } from "../../../../helpers/mock-factories";
import {
  useFakeTimers,
  useRealTimers,
  setSystemTime,
} from "../../../../helpers/bun-timers";

import { TikTokPlatform } from "../../../../../src/platforms/tiktok.ts";
import { PlatformEvents } from "../../../../../src/interfaces/PlatformEvents";
type PlatformEventPayload = Record<string, unknown> & {
  type?: string;
  platform?: string;
  data?: Record<string, unknown>;
  timestamp?: string;
  userId?: string;
  username?: string;
  giftType?: string;
  amount?: number;
  currency?: string;
  aggregatedCount?: number;
  isAggregated?: boolean;
  metadata?: unknown;
};
type RoutedGiftEvent = {
  type: string;
  platform: string;
  data: PlatformEventPayload;
};
type DependencyOverrides = {
  logger?: typeof noOpLogger;
  notificationManager?: unknown;
  connectionFactory?: {
    createConnection: (platform: string, config: unknown, dependencies: unknown) => unknown;
  };
  TikTokWebSocketClient?: unknown;
};

const isPlatformEventPayload = (value: unknown): value is PlatformEventPayload =>
  typeof value === "object" && value !== null;

const expectDefined = <T>(value: T | undefined): T => {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error("Expected value to be defined");
  }
  return value;
};

const createPlatform = (
  configOverrides: Record<string, unknown> = {},
  dependencyOverrides: DependencyOverrides = {},
) => {
  const logger = dependencyOverrides.logger || noOpLogger;
  const notificationManager = dependencyOverrides.notificationManager || {
    emit: vi.fn<(...args: unknown[]) => unknown>(),
    on: vi.fn<(...args: unknown[]) => unknown>(),
    removeListener: vi.fn<(...args: unknown[]) => unknown>(),
    handleNotification: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
  };
  const connectionFactory = dependencyOverrides.connectionFactory || {
    createConnection: vi.fn<(...args: unknown[]) => { on: import("bun:test").Mock<(...args: unknown[]) => unknown>; emit: import("bun:test").Mock<(...args: unknown[]) => unknown>; removeAllListeners: import("bun:test").Mock<(...args: unknown[]) => unknown>; connect: import("bun:test").Mock<(..._args: unknown[]) => Promise<undefined>>; disconnect: import("bun:test").Mock<(..._args: unknown[]) => Promise<undefined>>; }>().mockReturnValue({
      on: vi.fn<(...args: unknown[]) => unknown>(),
      emit: vi.fn<(...args: unknown[]) => unknown>(),
      removeAllListeners: vi.fn<(...args: unknown[]) => unknown>(),
      connect: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      disconnect: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
    }),
  };

  const TikTokWebSocketClient =
    dependencyOverrides.TikTokWebSocketClient ||
    vi.fn(() => ({
      on: vi.fn<(...args: unknown[]) => unknown>(),
      off: vi.fn<(...args: unknown[]) => unknown>(),
      connect: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      disconnect: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      getState: vi.fn<(...args: unknown[]) => string>().mockReturnValue("DISCONNECTED"),
      isConnecting: false,
      isConnected: false,
    }));

  const config = {
    enabled: true,
    username: "tester",
    giftAggregationEnabled: true,
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

describe("TikTokPlatform behavior alignment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("gift handling", () => {
    it("emits a user-facing error when gift count is zero and does not throw", async () => {
      const platform = createPlatform();
      const errors: PlatformEventPayload[] = [];
      const routedGifts: PlatformEventPayload[] = [];
      platform.on("platform:event", (payload: PlatformEventPayload) => {
        if (payload.type === PlatformEvents.ERROR) {
          errors.push(payload);
        }
      });
      platform.handlers = {
        ...platform.handlers,
        onGift: (data: unknown) => {
          if (isPlatformEventPayload(data)) routedGifts.push(data);
        },
      };

      await expect(
        platform.handleTikTokGift({
          repeatCount: 0,
          giftDetails: { giftName: "Rose", diamondCount: 1, giftType: 0 },
          common: { msgId: "gift-zero" },
          user: {
            uniqueId: "alice",
            nickname: "Alice",
            userId: "alice-id",
          },
        }),
      ).resolves.toBeUndefined();

      expect(errors.length).toBe(1);
      expect(expectDefined(errors[0])).toMatchObject({
        type: PlatformEvents.ERROR,
        platform: "tiktok",
        data: expect.objectContaining({
          type: PlatformEvents.ERROR,
          platform: "tiktok",
          recoverable: true,
          context: expect.objectContaining({
            reason: "gift-count-invalid",
          }),
        }),
      });
      expect(routedGifts).toHaveLength(1);
      const routedGift = expectDefined(routedGifts[0]);
      expect(routedGift).toMatchObject({
        platform: "tiktok",
        username: "alice",
        userId: "alice-id",
        isError: true,
      });
      expect(routedGift).not.toHaveProperty("giftCount");
      expect(routedGift).not.toHaveProperty("amount");
      expect(routedGift).not.toHaveProperty("currency");
    });

    it("emits a user-facing error when gift normalization fails", async () => {
      const platform = createPlatform();
      const routedGifts: PlatformEventPayload[] = [];
      platform.handlers = {
        ...platform.handlers,
        onGift: (data: unknown) => {
          if (isPlatformEventPayload(data)) routedGifts.push(data);
        },
      };

      await expect(
        platform.handleTikTokGift({
          repeatCount: 1,
          giftDetails: { giftName: "Rose", diamondCount: 1, giftType: 0 },
          common: { msgId: "gift-missing-user" },
          timestamp: "2024-01-01T00:00:00.000Z",
        }),
      ).resolves.toBeUndefined();

      expect(routedGifts).toHaveLength(1);
      const routedGift = expectDefined(routedGifts[0]);
      expect(routedGift).toMatchObject({
        platform: "tiktok",
        isError: true,
        type: PlatformEvents.GIFT,
        eventType: PlatformEvents.GIFT,
        avatarUrl: expect.any(String),
      });
      expect(routedGift.timestamp).toEqual(expect.any(String));
    });

    it("emits a user-facing error when gift timestamps are missing", async () => {
      const platform = createPlatform();
      const routedGifts: PlatformEventPayload[] = [];
      platform.handlers = {
        ...platform.handlers,
        onGift: (data: unknown) => {
          if (isPlatformEventPayload(data)) routedGifts.push(data);
        },
      };

      await expect(
        platform.handleTikTokGift({
          repeatCount: 1,
          giftDetails: { giftName: "Rose", diamondCount: 1, giftType: 0 },
          common: { msgId: "gift-missing-timestamp" },
          user: {
            uniqueId: "alice",
            nickname: "Alice",
            userId: "alice-id",
          },
        }),
      ).resolves.toBeUndefined();

      expect(routedGifts).toHaveLength(1);
      const routedGift = expectDefined(routedGifts[0]);
      expect(routedGift).toMatchObject({
        platform: "tiktok",
        isError: true,
        type: PlatformEvents.GIFT,
        eventType: PlatformEvents.GIFT,
        avatarUrl: expect.any(String),
      });
      expect(routedGift.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it("uses system time when gift timestamps are missing", async () => {
      useFakeTimers();
      setSystemTime(new Date("2025-01-20T10:00:00.000Z"));
      try {
        const platform = createPlatform();
        const routedGifts: PlatformEventPayload[] = [];
        platform.handlers = {
          ...platform.handlers,
          onGift: (data: unknown) => {
            if (isPlatformEventPayload(data)) routedGifts.push(data);
          },
        };

        await expect(
          platform.handleTikTokGift({
            repeatCount: 1,
            giftDetails: { giftName: "Rose", diamondCount: 1, giftType: 0 },
            common: { msgId: "test-gift-missing-timestamp" },
            user: {
              uniqueId: "test-alice",
              nickname: "test-alice",
              userId: "test-alice-id",
            },
          }),
        ).resolves.toBeUndefined();

        expect(routedGifts).toHaveLength(1);
        expect(expectDefined(routedGifts[0]).timestamp).toBe("2025-01-20T10:00:00.000Z");
      } finally {
        useRealTimers();
      }
    });
  });

  describe("connection lifecycle events", () => {
    it("emits connected and disconnected events with correlation metadata", async () => {
      const platform = createPlatform();
      const connectedEvents: PlatformEventPayload[] = [];
      const disconnectedEvents: PlatformEventPayload[] = [];
      const connectionStates: Record<string, unknown>[] = [];
      platform.handlers = {
        ...platform.handlers,
        onConnection: (payload) => connectionStates.push(payload as Record<string, unknown>),
      };

      platform.on("platform:event", (payload: PlatformEventPayload) => {
        if (payload.type === PlatformEvents.CHAT_CONNECTED) {
          connectedEvents.push(payload);
        }
        if (payload.type === PlatformEvents.CHAT_DISCONNECTED) {
          disconnectedEvents.push(payload);
        }
      });

      await platform._handleConnection();
      await platform._handleDisconnection("test-close");

      expect(connectedEvents.length).toBe(1);
      expect(expectDefined(connectedEvents[0])).toMatchObject({
        type: PlatformEvents.CHAT_CONNECTED,
        platform: "tiktok",
        data: expect.objectContaining({
          type: PlatformEvents.CHAT_CONNECTED,
          platform: "tiktok",
          metadata: expect.objectContaining({
            correlationId: expect.any(String),
          }),
        }),
      });

      expect(disconnectedEvents.length).toBe(1);
      expect(expectDefined(disconnectedEvents[0])).toMatchObject({
        type: PlatformEvents.CHAT_DISCONNECTED,
        platform: "tiktok",
        data: expect.objectContaining({
          type: PlatformEvents.CHAT_DISCONNECTED,
          platform: "tiktok",
          reason: "test-close",
          metadata: expect.objectContaining({
            correlationId: expect.any(String),
          }),
        }),
      });
      expect(connectionStates).toEqual([
        expect.objectContaining({ status: "connected", willReconnect: false }),
        expect.objectContaining({ status: "reconnecting", willReconnect: true }),
      ]);
    });
  });

  describe("gift aggregation and routing", () => {
    it("emits aggregated gift payload with correct schema", async () => {
      const platform = createPlatform();
      const routedEvents: RoutedGiftEvent[] = [];
      const errors: PlatformEventPayload[] = [];

      platform.handlers = {
        ...platform.handlers,
        onGift: (data: unknown) => {
          if (isPlatformEventPayload(data)) {
            routedEvents.push({
              type: "platform:gift",
              platform: "tiktok",
              data,
            });
          }
        },
      };

      platform.on("platform:event", (payload: PlatformEventPayload) => {
        if (payload.type === PlatformEvents.ERROR) {
          errors.push(payload);
        }
      });

      await platform._handleGift({
        platform: "tiktok",
        userId: "alice-id",
        username: "alice",
        giftType: "Rose",
        giftCount: 3,
        repeatCount: 3,
        amount: 3,
        currency: "coins",
        unitAmount: 1,
        id: "gift-agg-1",
        timestamp: new Date().toISOString(),
        aggregatedCount: 3,
        isAggregated: true,
        enhancedGiftData: {
          giftType: "Rose",
          giftCount: 3,
          amount: 3,
          currency: "coins",
          isAggregated: true,
        },
      });

      expect(errors).toEqual([]);
      expect(routedEvents.length).toBe(1);

      const routed = expectDefined(routedEvents[0]);
      expect(routed.type).toBe("platform:gift");
      expect(routed.platform).toBe("tiktok");

      const payload = routed.data;
      expect(payload.type).toBe(PlatformEvents.GIFT);
      expect(payload.userId).toBe("alice-id");
      expect(payload.username).toBe("alice");
      expect(payload.giftType).toBe("Rose");
      expect(payload.amount).toBe(3);
      expect(payload.currency).toBe("coins");
      expect(payload.aggregatedCount).toBe(3);
      expect(payload.isAggregated).toBe(true);
      expect(payload.metadata).toBeUndefined();
    });
  });

  describe("connection state and viewer count", () => {
    it("keeps unknown counts null and retires observations with the connection", async () => {
      const platform = createPlatform();
      const listeners: Record<string, (payload: unknown) => void | Promise<void>> = {};
      const connection = {
        on: (event: string, handler: (payload: unknown) => void | Promise<void>) => { listeners[event] = handler; },
        removeAllListeners: () => {},
        connect: async () => {},
        disconnect: async () => {},
      };
      const payload = { viewerCount: 42, common: { createTime: Date.parse("2025-01-01T00:00:00Z") } };
      try {
        expect(platform.getViewerCount()).toBeNull();
        platform.connection = connection;
        platform.setupEventListeners();
        const retiredRoomUser = expectDefined(listeners.roomUser);
        await retiredRoomUser(payload);
        expect(platform.getViewerCount()).toBe(42);
        platform.setupEventListeners();
        expect(platform.getViewerCount()).toBe(42);
        platform.cleanupEventListeners();
        expect(platform.getViewerCount()).toBeNull();
        platform.connection = { ...connection };
        platform.setupEventListeners();
        await retiredRoomUser(payload);
        expect(platform.getViewerCount()).toBeNull();
        await expectDefined(listeners.roomUser)({ ...payload, viewerCount: "invalid" });
        expect(platform.getViewerCount()).toBeNull();
        await expectDefined(listeners.roomUser)({ ...payload, viewerCount: 0 });
        expect(platform.getViewerCount()).toBe(0);
        await platform.cleanup();
        expect(platform.getViewerCount()).toBeNull();
      } finally { await platform.cleanup(); }
    });

    it("caches viewer count and emits viewer-count event", async () => {
      const events: Array<{ type: string; platform: string; data: PlatformEventPayload }> = [];
      const platform = createPlatform(
        {},
        {
          connectionFactory: { createConnection: vi.fn<(...args: unknown[]) => unknown>() },
        },
      );

      const listeners: Record<string, (payload: unknown) => void | Promise<void>> = {};
      const connection = {
        on: vi.fn<(...args: [event: string, handler: (payload: unknown) => void | Promise<void>]) => void>((event, handler) => {
          listeners[event] = handler;
        }),
        off: vi.fn<(...args: unknown[]) => unknown>(),
        connect: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
        disconnect: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
        removeAllListeners: vi.fn<(...args: unknown[]) => unknown>(),
        isConnecting: false,
        isConnected: false,
      };

      platform.connection = connection;

      platform.handlers = {
        ...platform.handlers,
        onViewerCount: (data: unknown) => {
          if (isPlatformEventPayload(data)) {
            events.push({ type: "viewer-count", platform: "tiktok", data });
          }
        },
      };

      platform.setupEventListeners();

      const viewerTimestamp = Date.parse("2024-01-01T00:00:00Z");
      await listeners["roomUser"]?.({
        viewerCount: 42,
        common: { createTime: viewerTimestamp },
      });

      expect(platform.cachedViewerCount).toBe(42);
      const viewerEvent = events.find((evt) => evt.type === "viewer-count");
      expect(viewerEvent).toBeDefined();
      expect(expectDefined(viewerEvent).data.count).toBe(42);
    });
  });

  describe("dependency validation", () => {
    it("fails fast when TikTokWebSocketClient is missing", () => {
      expect(
        () =>
          new TikTokPlatform(
            { enabled: true, username: "tester" },
            {
              connectionFactory: { createConnection: vi.fn<(...args: unknown[]) => unknown>() },
              logger: noOpLogger,
            },
          ),
      ).toThrow(/TikTokWebSocketClient/i);
    });

    it("uses the current transport vocabulary without event-map injection", async () => {
      const platform = createPlatform();
      expect(platform.WebcastEvent.ROOM_USER).toBe('roomUser');
      expect(platform.WebcastEvent.DISCONNECT).toBe('disconnected');
      expect(platform.ControlEvent.CONNECTED).toBe('connected');
      expect(Object.isFrozen(platform.WebcastEvent)).toBe(true);
      await platform.cleanup();
    });
  });
});
