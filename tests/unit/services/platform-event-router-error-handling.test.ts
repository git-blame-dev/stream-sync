import { vi, type Mock, describe, expect, it, beforeEach } from 'bun:test';

import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { PlatformEventRouter } from "../../../src/services/PlatformEventRouter.ts";

type RouterOptions = ConstructorParameters<typeof PlatformEventRouter>[0];
type PlatformEventHandler = Parameters<RouterOptions["eventBus"]["subscribe"]>[1];
type RoutedEventBus = RouterOptions["eventBus"] & {
  emit: (eventName: string, payload: unknown) => Promise<void>;
};
type ChatMessageHandlerMock = Mock<(...args: [string, Record<string, unknown>]) => Promise<unknown>>;
type RuntimeFake = {
  handleChatMessage: ChatMessageHandlerMock;
};
type NotificationManagerFake = RouterOptions["notificationManager"];

describe("PlatformEventRouter error handling", () => {
  let mockLogger: RouterOptions["logger"];
  let mockEventBus: RoutedEventBus;
  let mockRuntime: RuntimeFake;
  let mockNotificationManager: NotificationManagerFake;
  let mockConfig: RouterOptions["config"];
  let subscriber: PlatformEventHandler | null;

  const baseEvent = {
    platform: "twitch",
    type: "platform:chat-message",
    data: {
      username: "testUser",
      message: { text: "test message" },
      userId: "test-user-1",
      timestamp: new Date().toISOString(),
      metadata: {},
    },
  };

  beforeEach(() => {
    mockLogger = noOpLogger;

    subscriber = null;
    mockEventBus = {
      subscribe: vi.fn((event, handler) => {
        subscriber = handler;
        return () => {};
      }),
      emit: async (_eventName: string, payload: unknown) => {
        if (subscriber) {
          await subscriber(payload);
        }
      },
    };

    mockRuntime = {
      handleChatMessage: vi.fn<(...args: [string, Record<string, unknown>]) => Promise<unknown>>().mockResolvedValue(undefined),
    };

    mockNotificationManager = {
      handleNotification: vi.fn<(...args: unknown[]) => unknown>(),
    };

    mockConfig = createConfigFixture({ general: { messagesEnabled: true } });
  });

  it("continues processing events after handler throws an error", async () => {
    mockRuntime.handleChatMessage
      .mockRejectedValueOnce(new Error("first call fails"))
      .mockResolvedValueOnce(undefined);

    new PlatformEventRouter({
      eventBus: mockEventBus,
      runtime: mockRuntime,
      notificationManager: mockNotificationManager,
      config: mockConfig,
      logger: mockLogger,
    });

    await mockEventBus.emit("platform:event", baseEvent);
    await mockEventBus.emit("platform:event", baseEvent);

    expect(mockRuntime.handleChatMessage).toHaveBeenCalledTimes(2);
  });

  it("does not crash when handler throws non-Error value", async () => {
    mockRuntime.handleChatMessage.mockRejectedValueOnce("string error");

    new PlatformEventRouter({
      eventBus: mockEventBus,
      runtime: mockRuntime,
      notificationManager: mockNotificationManager,
      config: mockConfig,
      logger: mockLogger,
    });

    await expect(
      mockEventBus.emit("platform:event", baseEvent),
    ).resolves.toBeUndefined();
  });
});
