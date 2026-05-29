import { afterEach, describe, expect, test } from "bun:test";

import { createMockFn, restoreAllMocks, type TestMockFn } from "../helpers/bun-mock-utils";
import { createConfigFixture } from "../helpers/config-fixture";
import { noOpLogger } from "../helpers/mock-factories";
import { ChatNotificationRouter } from "../../src/services/ChatNotificationRouter.ts";

type RouterDependencies = ConstructorParameters<typeof ChatNotificationRouter>[0];
type RouterRuntime = RouterDependencies["runtime"];
type DisplayQueue = NonNullable<RouterRuntime["displayQueue"]>;
type AddItemMock = TestMockFn<Parameters<DisplayQueue["addItem"]>, ReturnType<DisplayQueue["addItem"]>>;
type GetVfxConfig = NonNullable<NonNullable<RouterRuntime["vfxCommandService"]>["getVFXConfig"]>;
type GetVfxConfigMock = TestMockFn<Parameters<GetVfxConfig>, ReturnType<GetVfxConfig>>;

type RouterOverrides = {
  displayQueue?: { addItem: AddItemMock } | null;
  vfxCommandService?: { getVFXConfig: GetVfxConfigMock } | null;
};

describe("Greeting System Diagnosis", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const buildRouter = (overrides: RouterOverrides = {}) => {
    const logger = noOpLogger;
    const config = createConfigFixture({
      general: { greetingsEnabled: true },
    });
    const displayQueue = overrides.displayQueue || {
      addItem: createMockFn<Parameters<DisplayQueue["addItem"]>, ReturnType<DisplayQueue["addItem"]>>(),
    };
    const runtime = {
      config,
      displayQueue,
      ...(overrides.vfxCommandService ? { vfxCommandService: overrides.vfxCommandService } : {}),
    } satisfies RouterRuntime;

    const router = new ChatNotificationRouter({
      runtime,
      logger,
      config,
    });
    return { router, displayQueue };
  };

  test("queueGreeting enqueues greeting items with username preserved", async () => {
    const { router, displayQueue } = buildRouter();
    const addItemSpy = displayQueue.addItem;

    await router.queueGreeting("tiktok", "ItzBurgs", {});

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
    const getVFXConfig = createMockFn<Parameters<GetVfxConfig>, ReturnType<GetVfxConfig>>(
      async () => vfxConfig,
    );
    const { router, displayQueue } = buildRouter({
      vfxCommandService: {
        getVFXConfig,
      },
    });

    await router.queueGreeting("youtube", "TestUser", {});

    expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
    expect(displayQueue.addItem.mock.calls).toContainEqual([
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
    const { router } = buildRouter({ displayQueue: null });

    await expect(
      router.queueGreeting("tiktok", "Userless", {}),
    ).resolves.toBeUndefined();
  });
});
