import { afterEach, describe, expect, test } from "bun:test";

import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { createConfigFixture } from "../helpers/config-fixture";
import { noOpLogger } from "../helpers/mock-factories";
import { ChatNotificationRouter } from "../../src/services/ChatNotificationRouter.ts";

type FlexibleMock = ReturnType<typeof createMockFn> & {
  mockResolvedValue: (value: unknown) => FlexibleMock;
};

type MockFn = ReturnType<typeof createMockFn>;

type RouterOverrides = {
  displayQueue?: { addItem: MockFn } | null;
  vfxCommandService?: { getVFXConfig: MockFn } | null;
};

describe("Greeting System Diagnosis", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const buildRouter = (overrides: RouterOverrides = {}) => {
    const logger = noOpLogger;
    const displayQueue = overrides.displayQueue || { addItem: createMockFn() };
    const runtime = {
      config: { general: { greetingsEnabled: true } },
      displayQueue,
      vfxService: null,
      vfxCommandService: overrides.vfxCommandService || null,
    };

    return new ChatNotificationRouter({
      runtime,
      logger,
      config: createConfigFixture(),
    });
  };

  test("queueGreeting enqueues greeting items with username preserved", async () => {
    const router = buildRouter();
    const addItemSpy = router.runtime.displayQueue.addItem;

    await router.queueGreeting("tiktok", "ItzBurgs");

    expect(addItemSpy).toHaveBeenCalledTimes(1);
    expect(addItemSpy.mock.calls).toContainEqual([
      expect.objectContaining({
        type: "greeting",
        platform: "tiktok",
        data: expect.objectContaining({
          username: "ItzBurgs",
        }),
      }),
    ]);
  });

  test("queueGreeting preserves required VFX fields when available", async () => {
    const vfxConfig = {
      commandKey: "greetings",
      command: "!hello",
      filename: "hello-there2",
      mediaSource: "greeting-source",
      vfxFilePath: "./vfx",
      duration: 5000,
    };
    const router = buildRouter({
      vfxCommandService: {
        getVFXConfig: (createMockFn() as FlexibleMock).mockResolvedValue(
          vfxConfig,
        ),
      },
    });

    await router.queueGreeting("youtube", "TestUser");

    expect(router.runtime.displayQueue.addItem).toHaveBeenCalledTimes(1);
    expect(router.runtime.displayQueue.addItem.mock.calls).toContainEqual([
      expect.objectContaining({
        type: "greeting",
        vfxConfig: expect.objectContaining({
          commandKey: "greetings",
          command: "!hello",
          filename: "hello-there2",
          mediaSource: "greeting-source",
          vfxFilePath: "./vfx",
        }),
      }),
    ]);
  });

  test("queueGreeting exits silently when displayQueue missing", async () => {
    const router = buildRouter({ displayQueue: null });

    await expect(
      router.queueGreeting("tiktok", "Userless"),
    ).resolves.toBeUndefined();
  });
});
