import { describe, expect, it } from "bun:test";
import { ChatNotificationRouter } from "../../../src/services/ChatNotificationRouter";

const routerConfig = {
  general: { maxMessageLength: 500 },
  cooldowns: {
    cmdCooldownMs: 1000,
    heavyCommandCooldownMs: 5000,
    globalCmdCooldownMs: 1000,
  },
  farewell: { timeout: 1000 },
};

describe("chat notification router JS interop", () => {
  it("exposes ChatNotificationRouter as a named export from the JS wrapper", () => {
    expect(typeof ChatNotificationRouter).toBe("function");
  });

  it("constructs the named wrapper export with runtime dependencies", () => {
    const router = new ChatNotificationRouter({
      runtime: {
        config: routerConfig,
        userTrackingService: { isFirstMessage: () => false },
        displayQueue: { addItem() {} },
      },
      logger: { debug() {}, warn() {}, error() {} },
      config: routerConfig,
    });

    expect(typeof router.handleChatMessage).toBe("function");
  });
});
