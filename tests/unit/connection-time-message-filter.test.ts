import { afterEach, describe, expect, test } from "bun:test";

import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { createConfigFixture } from "../helpers/config-fixture";
import { noOpLogger } from "../helpers/mock-factories";
import testClock from "../helpers/test-clock";
import { createTestUser, initializeTestLogging } from "../helpers/test-setup";
import { ChatNotificationRouter } from "../../src/services/ChatNotificationRouter.ts";

type RouterDependencies = ConstructorParameters<typeof ChatNotificationRouter>[0];
type RouterRuntime = RouterDependencies["runtime"];
type PlatformLifecycleService = NonNullable<RouterRuntime["platformLifecycleService"]>;
type GracefulExitService = NonNullable<RouterRuntime["gracefulExitService"]>;

type RouterOverrides = {
  general?: Partial<RouterRuntime["config"]["general"]>;
  connectionTime?: number | null;
  gracefulExitService?: GracefulExitService;
};

initializeTestLogging();

describe("Connection-Time Message Filter", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const buildRouter = (overrides: RouterOverrides = {}) => {
    const config = createConfigFixture({
      general: {
        filterOldMessages: true,
        ...overrides.general,
      },
      twitch: { messagesEnabled: true, greetingsEnabled: true },
    });
    const getPlatformConnectionTime = createMockFn<
      Parameters<PlatformLifecycleService["getPlatformConnectionTime"]>,
      ReturnType<PlatformLifecycleService["getPlatformConnectionTime"]>
    >(() => overrides.connectionTime ?? null);
    const runtime = {
      config,
      platformLifecycleService: {
        getPlatformConnectionTime,
      },
      ...(overrides.gracefulExitService ? { gracefulExitService: overrides.gracefulExitService } : {}),
    } satisfies RouterRuntime;

    const router = new ChatNotificationRouter({
      runtime,
      logger: noOpLogger,
      config,
    });

    router.enqueueChatMessage = createMockFn<Parameters<typeof router.enqueueChatMessage>, ReturnType<typeof router.enqueueChatMessage>>(() => undefined);
    router.detectCommand = createMockFn<Parameters<typeof router.detectCommand>, ReturnType<typeof router.detectCommand>>(async () => null);
    router.processCommand = createMockFn<Parameters<typeof router.processCommand>, ReturnType<typeof router.processCommand>>(async () => undefined);
    router.isFirstMessage = createMockFn<Parameters<typeof router.isFirstMessage>, ReturnType<typeof router.isFirstMessage>>(() => false);
    router.isGreetingEnabled = createMockFn<Parameters<typeof router.isGreetingEnabled>, ReturnType<typeof router.isGreetingEnabled>>(() => false);

    return { router, runtime, getPlatformConnectionTime };
  };

  const createMessage = (timestamp: string) =>
    createTestUser({
      username: "testuser",
      userId: "test12345",
      message: "Hello world",
      timestamp,
    });

  test("skips messages sent before the latest platform connection", async () => {
    const connectionTime = testClock.now();
    const { router, getPlatformConnectionTime } = buildRouter({ connectionTime });
    getPlatformConnectionTime.mockReturnValue(
      connectionTime,
    );

    const oldTimestamp = new Date(connectionTime - 1000).toISOString();
    await router.handleChatMessage("twitch", createMessage(oldTimestamp));

    expect(router.enqueueChatMessage).not.toHaveBeenCalled();
  });

  test("allows messages when filterOldMessages is disabled", async () => {
    const connectionTime = testClock.now();
    const { router, getPlatformConnectionTime } = buildRouter({
      connectionTime,
      general: { filterOldMessages: false },
    });
    getPlatformConnectionTime.mockReturnValue(
      connectionTime,
    );

    const oldTimestamp = new Date(connectionTime - 2000).toISOString();
    await router.handleChatMessage("twitch", createMessage(oldTimestamp));

    expect(router.enqueueChatMessage).toHaveBeenCalled();
  });

  test("allows messages when connection time is unavailable", async () => {
    const { router } = buildRouter({ connectionTime: null });
    await router.handleChatMessage(
      "twitch",
      createMessage(new Date(testClock.now()).toISOString()),
    );

    expect(router.enqueueChatMessage).toHaveBeenCalled();
  });

  test("shouldSkipForConnection returns false for invalid timestamps", () => {
    const { router, getPlatformConnectionTime } = buildRouter({
      connectionTime: testClock.now(),
    });
    getPlatformConnectionTime.mockReturnValue(
      testClock.now(),
    );

    expect(router.shouldSkipForConnection("twitch", "not-a-date")).toBe(false);
  });
});
