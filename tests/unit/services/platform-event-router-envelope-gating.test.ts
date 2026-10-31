import { vi, describe, expect, it, afterEach } from 'bun:test';

import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";

import { PlatformEventRouter } from "../../../src/services/PlatformEventRouter.ts";

type RouterOptions = ConstructorParameters<typeof PlatformEventRouter>[0];

describe("PlatformEventRouter envelope gating", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createRouter = (config: RouterOptions["config"]) =>
    new PlatformEventRouter({
      eventBus: {
        subscribe: vi.fn(() => vi.fn<(...args: unknown[]) => unknown>()),
      },
      runtime: {
        handleEnvelopeNotification: vi.fn<(...args: unknown[]) => unknown>(),
      },
      notificationManager: { handleNotification: vi.fn<(...args: unknown[]) => unknown>() },
      config,
      logger: noOpLogger,
    });

  it("respects giftsEnabled config gating for envelope events", async () => {
    const config = createConfigFixture({ general: { giftsEnabled: false } });

    const router = createRouter(config);

    await router.routeEvent({
      platform: "tiktok",
      type: "platform:envelope",
      data: {
        username: "ChestUser",
        userId: "user-1",
        timestamp: new Date().toISOString(),
        metadata: {},
      },
    });

    expect(router.runtime.handleEnvelopeNotification).not.toHaveBeenCalled();
  });
});
