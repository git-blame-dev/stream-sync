import { describe, expect, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";

import { PlatformEventRouter } from "../../../src/services/PlatformEventRouter.ts";

describe("PlatformEventRouter envelope gating", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const createRouter = (config) =>
    new PlatformEventRouter({
      eventBus: {
        subscribe: createMockFn(() => createMockFn()),
        emit: createMockFn(),
      },
      runtime: {
        handleEnvelopeNotification: createMockFn(),
      },
      notificationManager: { handleNotification: createMockFn() },
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
