import { describe, it, expect } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { EventEmitter } from "events";
import { PlatformEventRouter } from "../../../src/services/PlatformEventRouter.ts";

type RoutedNotification = {
  type: string;
  platform: string;
  username: string;
  payload: unknown;
};

type PlatformEventPayload = {
  type: string;
  platform: string;
  data: {
    username: string;
    userId: string;
    timestamp: string;
    metadata: Record<string, unknown>;
  };
};

type RouterEventBus = {
  subscribe: (
    eventName: string,
    handler: (event: unknown) => Promise<void>,
  ) => () => void;
  emit: (eventName: string, payload: unknown) => boolean;
};

const getOnlyHandledNotification = (
  handled: readonly RoutedNotification[],
): RoutedNotification => {
  expect(handled).toHaveLength(1);
  const notification = handled[0];
  expect(notification).toBeDefined();
  if (!notification) {
    throw new Error("Expected one routed notification");
  }
  return notification;
};

function createAppRuntimeMocks() {
  const handled: RoutedNotification[] = [];
  return {
    handled,
    runtime: {
      handleFollowNotification: (
        platform: string,
        username: unknown,
        payload: Record<string, unknown>,
      ) => {
        expect(typeof username).toBe("string");
        if (typeof username !== "string") {
          throw new Error("Expected follow username to be a string");
        }
        handled.push({ type: "platform:follow", platform, username, payload });
      },
      handleShareNotification: (
        platform: string,
        username: unknown,
        payload: Record<string, unknown>,
      ) => {
        expect(typeof username).toBe("string");
        if (typeof username !== "string") {
          throw new Error("Expected share username to be a string");
        }
        handled.push({ type: "platform:share", platform, username, payload });
      },
    },
  };
}

function createMockEventBus(): RouterEventBus {
  const bus = new EventEmitter();
  return {
    subscribe: (eventName: string, handler: (event: unknown) => Promise<void>) => {
      bus.on(eventName, handler);
      return () => bus.off(eventName, handler);
    },
    emit: (eventName: string, payload: unknown) => bus.emit(eventName, payload),
  };
}

describe("TikTok follow/share routing", () => {
  it("routes follow events through platform:event to PlatformEventRouter", async () => {
    const eventBus = createMockEventBus();
    const { runtime, handled } = createAppRuntimeMocks();
    new PlatformEventRouter({
      eventBus,
      runtime,
      notificationManager: { handleNotification: createMockFn<[], Promise<unknown>>().mockResolvedValue(undefined) },
      config: createConfigFixture({
        general: {
          followsEnabled: true,
          giftsEnabled: true,
          messagesEnabled: true,
          sharesEnabled: true,
        },
      }),
      logger: noOpLogger,
    });

    await eventBus.emit("platform:event", {
      type: "platform:follow",
      platform: "tiktok",
      data: {
        username: "Follower",
        userId: "user-1",
        timestamp: new Date().toISOString(),
        metadata: {},
      },
    });

    const notification = getOnlyHandledNotification(handled);
    expect(notification).toMatchObject({
      type: "platform:follow",
      username: "Follower",
    });
  });

  it("routes share events through platform:event to PlatformEventRouter", () => {
    const eventBus = createMockEventBus();
    const { runtime, handled } = createAppRuntimeMocks();
    new PlatformEventRouter({
      eventBus,
      runtime,
      notificationManager: { handleNotification: createMockFn<[], Promise<unknown>>().mockResolvedValue(undefined) },
      config: createConfigFixture({
        general: {
          followsEnabled: true,
          giftsEnabled: true,
          messagesEnabled: true,
          sharesEnabled: true,
        },
      }),
      logger: noOpLogger,
    });
    const emitted: PlatformEventPayload[] = [];
    eventBus.subscribe("platform:event", async (payload: unknown) => {
      expect(isPlatformEventPayload(payload)).toBe(true);
      if (!isPlatformEventPayload(payload)) {
        throw new Error("Expected platform event payload");
      }
      emitted.push(payload);
    });

    eventBus.emit("platform:event", {
      type: "platform:share",
      platform: "tiktok",
      data: {
        username: "Sharer",
        userId: "user-2",
        timestamp: new Date().toISOString(),
        metadata: {},
      },
    });

    expect(emitted.find((p) => p.type === "platform:share")).toBeDefined();
    const notification = getOnlyHandledNotification(handled);
    expect(notification).toMatchObject({
      type: "platform:share",
      username: "Sharer",
    });
  });
});

function isPlatformEventPayload(value: unknown): value is PlatformEventPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const event = value as Record<string, unknown>;
  const data = event.data;
  return (
    typeof event.type === "string" &&
    typeof event.platform === "string" &&
    !!data &&
    typeof data === "object"
  );
}
