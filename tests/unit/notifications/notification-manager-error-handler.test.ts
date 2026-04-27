import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";

import NotificationManager from "../../../src/notifications/NotificationManager";
import * as constants from "../../../src/core/constants";

type NotificationManagerLike = {
  handleNotification: (
    type: string,
    platform: string,
    data: Record<string, unknown>,
  ) => Promise<{ success?: boolean; error?: string; details?: string }>;
};

type DisplayQueueMock = {
  addItem: ReturnType<typeof createMockFn>;
  addToQueue: ReturnType<typeof createMockFn>;
  processQueue: ReturnType<typeof createMockFn>;
  isQueueEmpty: ReturnType<typeof createMockFn>;
  clearQueue: ReturnType<typeof createMockFn>;
};

type EventBusMock = {
  emit: ReturnType<typeof createMockFn>;
  on: ReturnType<typeof createMockFn>;
  off: ReturnType<typeof createMockFn>;
};

describe("NotificationManager error handling", () => {
  let manager: NotificationManagerLike;
  let mockDisplayQueue: DisplayQueueMock;
  let mockEventBus: EventBusMock;

  beforeEach(() => {
    mockDisplayQueue = {
      addItem: createMockFn(),
      addToQueue: createMockFn(),
      processQueue: createMockFn(),
      isQueueEmpty: createMockFn().mockReturnValue(true),
      clearQueue: createMockFn(),
    };

    mockEventBus = {
      emit: createMockFn(),
      on: createMockFn(),
      off: createMockFn(),
    };

    manager = new NotificationManager({
      logger: noOpLogger,
      displayQueue: mockDisplayQueue,
      eventBus: mockEventBus,
      constants,
      textProcessing: { formatChatMessage: createMockFn() },
      obsGoals: { processDonationGoal: createMockFn() },
      config: createConfigFixture(),
      vfxCommandService: {
        getVFXConfig: createMockFn().mockResolvedValue(null),
      },
    });
  });

  afterEach(() => {
    restoreAllMocks();
  });

  test("returns failure result when display queue throws error", async () => {
    mockDisplayQueue.addItem.mockImplementation(() => {
      throw new Error("queue fail");
    });

    const result = await manager.handleNotification(
      "platform:follow",
      "tiktok",
      {
        username: "testUser",
        userId: "test-user-id-001",
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Display queue error");
    expect(result.details).toBe("queue fail");
  });

  test("does not emit notification:processed event on display queue failure", async () => {
    mockDisplayQueue.addItem.mockImplementation(() => {
      throw new Error("queue fail");
    });

    await manager.handleNotification("platform:follow", "tiktok", {
      username: "testUser",
      userId: "test-user-id-002",
    });

    const processedEvents = mockEventBus.emit.mock.calls.filter(
      ([event]) => event === "notification:processed",
    );
    expect(processedEvents).toHaveLength(0);
  });

  test("handles notification successfully when display queue works", async () => {
    mockDisplayQueue.addItem.mockReturnValue(undefined);

    const result = await manager.handleNotification(
      "platform:follow",
      "tiktok",
      {
        username: "testUser",
        userId: "test-user-id-003",
      },
    );

    expect(result.success).toBe(true);
    expect(mockDisplayQueue.addItem).toHaveBeenCalled();
  });
});
