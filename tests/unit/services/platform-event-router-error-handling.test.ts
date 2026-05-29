import { describe, expect, it, beforeEach } from "bun:test";
import { createMockFn, type TestMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { PlatformEventRouter } from "../../../src/services/PlatformEventRouter.ts";

type RouterOptions = ConstructorParameters<typeof PlatformEventRouter>[0];
type PlatformEventHandler = Parameters<RouterOptions["eventBus"]["subscribe"]>[1];
type RoutedEventBus = RouterOptions["eventBus"] & {
  emit: (eventName: string, payload: unknown) => Promise<void>;
};
type ChatMessageHandlerMock = TestMockFn<[string, Record<string, unknown>], Promise<unknown>>;
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
      subscribe: createMockFn((event, handler) => {
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
      handleChatMessage: createMockFn<[string, Record<string, unknown>], Promise<unknown>>().mockResolvedValue(),
    };

    mockNotificationManager = {
      handleNotification: createMockFn(),
    };

    mockConfig = createConfigFixture({ general: { messagesEnabled: true } });
  });

  it("continues processing events after handler throws an error", async () => {
    mockRuntime.handleChatMessage
      .mockRejectedValueOnce(new Error("first call fails"))
      .mockResolvedValueOnce();

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
