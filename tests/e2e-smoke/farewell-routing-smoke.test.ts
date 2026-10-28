import { afterEach, describe, test, expect } from "bun:test";
import { createFarewellRoutingHarness } from "../helpers/farewell-routing-harness";
import testClock from "../helpers/test-clock";

describe("farewell routing smoke E2E", () => {
  afterEach(() => { testClock.useRealTime(); });
  test("suppresses repeated same-platform farewell and keeps cross-platform farewell + VFX mapping", async () => {
    const { platformEventRouter, queuedItems, cleanup } = createFarewellRoutingHarness({
      farewell: { command: "!bye, bye", timeout: 300 },
    });
    try {
      await platformEventRouter.routeEvent({
        platform: "twitch",
        type: "platform:chat-message",
        data: {
          username: "test-user-one",
          userId: "test-user-one-id",
          message: { text: "!bye everyone" },
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });

      await platformEventRouter.routeEvent({
        platform: "twitch",
        type: "platform:chat-message",
        data: {
          username: "test-user-two",
          userId: "test-user-two-id",
          message: { text: "!bye everyone" },
          timestamp: "2024-01-01T00:00:01.000Z",
        },
      });

      await platformEventRouter.routeEvent({
        platform: "tiktok",
        type: "platform:chat-message",
        data: {
          username: "test-user-three",
          userId: "test-user-three-id",
          message: { text: "!bye everyone" },
          timestamp: "2024-01-01T00:00:02.000Z",
        },
      });

      const queuedTypes = queuedItems.map((item) => item.type);
      expect(queuedTypes).toEqual(["farewell", "farewell"]);

      const farewellRows = queuedItems.filter((item) => item.type === "farewell");
      expect(farewellRows.length).toBe(2);

      const farewellPlatforms = farewellRows.map((item) => item.platform);
      expect(farewellPlatforms).toEqual(["twitch", "tiktok"]);
      expect(farewellRows).toMatchObject([
        { type: "farewell", platform: "twitch", data: { username: "test-user-one", userId: "test-user-one-id", displayMessage: "Goodbye, test-user-one! 👋" } },
        { type: "farewell", platform: "tiktok", data: { username: "test-user-three", userId: "test-user-three-id", displayMessage: "Goodbye, test-user-three! 👋" } },
      ]);

      farewellRows.forEach((row) => {
        expect(row.vfxConfig).toBeDefined();
        expect(["!bye", "!bye2", "!bye3"]).toContain(row.vfxConfig?.command);
        expect(row.vfxConfig?.command).toBe("!bye");
      });
    } finally {
      cleanup();
    }
  });
});
