import { vi, type Mock, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DisplayQueueItem } from "../../../src/interfaces/DisplayQueue";

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
  addItem: ReturnType<typeof vi.fn<(...args: [DisplayQueueItem]) => readonly DisplayQueueItem[]>>;
  addToQueue: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
  processQueue: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
  isQueueEmpty: Mock<(...args: []) => boolean>;
  getQueueLength: Mock<(...args: []) => number>;
  clearQueue: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
};

type EventBusMock = {
  emit: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
  on: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
  off: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
};

describe("NotificationManager error handling", () => {
  let manager: NotificationManagerLike;
  let mockDisplayQueue: DisplayQueueMock;
  let mockEventBus: EventBusMock;

  beforeEach(() => {
    mockDisplayQueue = {
      addItem: vi.fn<(...args: [DisplayQueueItem]) => readonly DisplayQueueItem[]>((item) => [item]),
      addToQueue: vi.fn<(...args: unknown[]) => unknown>(),
      processQueue: vi.fn<(...args: unknown[]) => unknown>(),
      isQueueEmpty: vi.fn<(...args: []) => boolean>().mockReturnValue(true),
      getQueueLength: vi.fn<(...args: []) => number>().mockReturnValue(0),
      clearQueue: vi.fn<(...args: unknown[]) => unknown>(),
    };

    mockEventBus = {
      emit: vi.fn<(...args: unknown[]) => unknown>(),
      on: vi.fn<(...args: unknown[]) => unknown>(),
      off: vi.fn<(...args: unknown[]) => unknown>(),
    };

    manager = new NotificationManager({
      logger: noOpLogger,
      displayQueue: mockDisplayQueue,
      eventBus: mockEventBus,
      constants,
      config: createConfigFixture(),
      vfxCommandService: {
        getVFXConfig: vi.fn<(...args: unknown[]) => Promise<null>>().mockResolvedValue(null),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    mockDisplayQueue.addItem.mockImplementation(item => [item]);

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
