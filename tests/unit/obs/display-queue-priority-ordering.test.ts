import { describe, expect, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { initializeTestLogging } from "../../helpers/test-setup";
import { DisplayQueue } from "../../../src/obs/display-queue.ts";
import { noOpLogger } from "../../helpers/mock-factories";
import { createSourcesConfigFixture } from "../../helpers/config-fixture";
import { createOBSSourcesManager } from "../../../src/obs/sources.ts";
import { PRIORITY_LEVELS } from "../../../src/core/constants";

initializeTestLogging();

describe("DisplayQueue priority ordering", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const constants = {
    PRIORITY_LEVELS,
    CHAT_MESSAGE_DURATION: 4500,
    CHAT_TRANSITION_DELAY: 200,
  };

  const config = {
    autoProcess: false,
    chat: {
      sourceName: "chat",
      sceneName: "scene",
      groupName: "group",
      platformLogos: {},
    },
    notification: {
      sourceName: "notification",
      sceneName: "scene",
      groupName: "group",
      platformLogos: {},
    },
  };

  const createQueue = () => {
    type SourcesObsManager = Parameters<typeof createOBSSourcesManager>[0];
    type DisplayQueueObsManager = ConstructorParameters<typeof DisplayQueue>[0];
    type QueueItem = Parameters<DisplayQueue["displayItem"]>[0];

    const mockCall = createMockFn<
      [requestType: string, payload?: Record<string, unknown>],
      Promise<unknown>
    >((method) => {
      if (method === "GetGroupSceneItemList") {
        return Promise.resolve({
          sceneItems: [
            { sourceName: "chat", sceneItemId: 1 },
            { sourceName: "notification", sceneItemId: 2 },
          ],
        });
      }
      if (method === "GetInputSettings") {
        return Promise.resolve({ inputSettings: {} });
      }
      if (method === "GetSceneItemId") {
        return Promise.resolve({ sceneItemId: 42 });
      }
      return Promise.resolve({});
    });

    const mockOBS: SourcesObsManager & DisplayQueueObsManager = {
      ensureConnected: createMockFn<[], Promise<void>>().mockResolvedValue(),
      call: mockCall,
      addEventListener: createMockFn<
        [eventName: string, handler: (data?: { reason?: unknown; code?: unknown }) => void],
        void
      >(),
      removeEventListener: createMockFn<
        [eventName: string, handler: (data?: { reason?: unknown; code?: unknown }) => void],
        void
      >(),
      isConnected: createMockFn<[], boolean>().mockReturnValue(true),
      isReady: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
    };

    const realSourcesManager = createOBSSourcesManager(mockOBS, {
      ...createSourcesConfigFixture(),
      logger: noOpLogger,
      ensureOBSConnected: createMockFn<[], Promise<void>>().mockResolvedValue(),
      obsCall: mockCall,
    });

    const queue = new DisplayQueue(mockOBS, config, constants, null, {
      sourcesManager: realSourcesManager,
      delay: () => Promise.resolve(),
    });
    queue.getDuration = createMockFn().mockReturnValue(0);
    const displayItem = createMockFn<[QueueItem], Promise<boolean>>().mockResolvedValue(true);
    queue.displayItem = displayItem;
    return queue;
  };

  it("front-loads higher priority items even when added later", () => {
    const queue = createQueue();
    const processed: string[] = [];
    queue.displayItem = createMockFn<[Parameters<DisplayQueue["displayItem"]>[0]], Promise<boolean>>(async (item) => {
      processed.push(item.type);
      return true;
    });

    queue.addItem({
      type: "chat",
      platform: "twitch",
      data: { username: "Viewer", message: "first chat" },
    });

    queue.addItem({
      type: "platform:raid",
      platform: "twitch",
      data: { username: "Raider", viewerCount: 5 },
    });

    return queue.processQueue().then(() => {
      expect(processed).toEqual(["platform:raid", "chat"]);
    });
  });

  it("preserves FIFO ordering for same-priority items", () => {
    const queue = createQueue();
    const processedUsers: string[] = [];
    queue.displayItem = createMockFn<[Parameters<DisplayQueue["displayItem"]>[0]], Promise<boolean>>(async (item) => {
      expect(item.data.username).toBeString();
      if (typeof item.data.username !== "string") {
        throw new Error("Expected processed item username");
      }
      processedUsers.push(item.data.username);
      return true;
    });

    queue.addItem({
      type: "platform:gift",
      platform: "twitch",
      data: {
        username: "Gifter1",
        giftType: "bits",
        giftCount: 1,
        amount: 100,
        currency: "bits",
      },
    });

    queue.addItem({
      type: "platform:gift",
      platform: "twitch",
      data: {
        username: "Gifter2",
        giftType: "bits",
        giftCount: 1,
        amount: 250,
        currency: "bits",
      },
    });

    return queue.processQueue().then(() => {
      expect(processedUsers).toEqual(["Gifter1", "Gifter2"]);
    });
  });

  it("retains priority 0 without overwriting with default", () => {
    const queue = createQueue();

    queue.addItem({
      type: "custom",
      platform: "twitch",
      priority: 0,
      data: { username: "testUser", message: "low priority" },
    });

    expect(queue.queue[0]).toBeDefined();
    expect(queue.queue[0]?.priority).toBe(0);
  });
});
