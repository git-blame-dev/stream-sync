import { describe, expect, beforeEach, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks, type TestMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";

import { PlatformEventRouter } from "../../../src/services/PlatformEventRouter.ts";

type RouterOptions = ConstructorParameters<typeof PlatformEventRouter>[0];
type RuntimeNotificationMock = TestMockFn<[string, unknown, Record<string, unknown>], unknown>;
type RuntimeFake = {
  handlePaypiggyNotification: RuntimeNotificationMock;
};

const firstMockCall = <Args extends unknown[]>(calls: Args[]): Args => {
  const [call] = calls;
  if (!call) {
    throw new Error("Expected mock to have at least one call");
  }
  return call;
};

describe("PlatformEventRouter paypiggy months handling", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let runtime: RuntimeFake;
  let config: RouterOptions["config"];

  const buildRouter = () =>
    new PlatformEventRouter({
      eventBus: {
        subscribe: createMockFn(() => createMockFn()),
      },
      runtime,
      notificationManager: { handleNotification: createMockFn() },
      config,
      logger: noOpLogger,
    });

  beforeEach(() => {
    runtime = {
      handlePaypiggyNotification: createMockFn<[string, unknown, Record<string, unknown>], unknown>(),
    };
    config = createConfigFixture({ general: { paypiggiesEnabled: true } });
  });

  it("passes through superfan tier and months to paypiggy handler", async () => {
    const router = buildRouter();

    await router.routeEvent({
      platform: "tiktok",
      type: "platform:paypiggy",
      data: {
        username: "SuperFanUser",
        userId: "sf-1",
        timestamp: new Date().toISOString(),
        metadata: {},
        tier: "superfan",
        months: 3,
        membershipLevel: "Ultra",
      },
    });

    expect(runtime.handlePaypiggyNotification).toHaveBeenCalledTimes(1);
    const [_platform, username, payload] =
      firstMockCall(runtime.handlePaypiggyNotification.mock.calls);
    expect(_platform).toBe("tiktok");
    expect(username).toBe("SuperFanUser");
    expect(payload.tier).toBe("superfan");
    expect(payload.months).toBe(3);
    expect(payload.membershipLevel).toBe("Ultra");
    expect(payload.sourceType).toBe("platform:paypiggy");
  });

  it("passes through months without aliasing for Twitch paypiggy events", async () => {
    const router = buildRouter();

    await router.routeEvent({
      platform: "twitch",
      type: "platform:paypiggy",
      data: {
        username: "MonthsUser",
        userId: "user-3",
        timestamp: new Date().toISOString(),
        metadata: {},
        months: 6,
      },
    });

    expect(runtime.handlePaypiggyNotification).toHaveBeenCalledTimes(1);
    const [_platform, username, payload] =
      firstMockCall(runtime.handlePaypiggyNotification.mock.calls);
    expect(_platform).toBe("twitch");
    expect(username).toBe("MonthsUser");
    expect(payload.months).toBe(6);
  });
});
