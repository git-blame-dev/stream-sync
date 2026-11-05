import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import { createFarewellRoutingHarness } from "../helpers/farewell-routing-harness";
import testClock from "../helpers/test-clock";
import { getTimerCount, useFakeTimers, useRealTimers } from "../helpers/bun-timers";

describe("farewell chat routing integration", () => {
  beforeEach(() => { testClock.reset(); });
  afterEach(() => { testClock.useRealTime(); });

  it("admits the same valid farewell at exact expiry and starts a fresh platform cooldown", async () => {
    const harness = createFarewellRoutingHarness({ farewell: { command: "!bye, bye", timeout: 2 } });
    try {
      const route = (platform: string, username: string) => harness.platformEventRouter.routeEvent({
        platform, type: "platform:chat-message",
        data: { username, userId: `${username}-id`, message: { text: "!bye everyone" }, timestamp: new Date(testClock.now()).toISOString() },
      });
      await route("twitch", "synthetic-first");
      testClock.advance(1999);
      await route("twitch", "synthetic-blocked");
      await route("tiktok", "synthetic-cross-platform");
      expect(harness.queuedItems).toHaveLength(2);
      testClock.advance(1);
      await route("twitch", "synthetic-expired");
      expect(harness.queuedItems).toHaveLength(3);
      await route("twitch", "synthetic-blocked-again");
      expect(harness.queuedItems).toHaveLength(3);
      expect(harness.queuedItems.map((item) => ({ platform: item.platform, data: item.data }))).toMatchObject([
        { platform: "twitch", data: { username: "synthetic-first", userId: "synthetic-first-id", displayMessage: "Goodbye, synthetic-first! 👋" } },
        { platform: "tiktok", data: { username: "synthetic-cross-platform", userId: "synthetic-cross-platform-id" } },
        { platform: "twitch", data: { username: "synthetic-expired", userId: "synthetic-expired-id" } },
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  it("prepares and queues source chat with farewell as one sequence", async () => {
    const harness = createFarewellRoutingHarness({
      general: { messagesEnabled: true, logChatMessages: false },
      twitch: { messagesEnabled: true, farewellsEnabled: true },
    });
    try {
      await harness.platformEventRouter.routeEvent({
        platform: "twitch",
        type: "platform:chat-message",
        data: {
          username: "test-user",
          userId: "test-user-id",
          message: { text: "!bye everyone" },
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });

      expect(harness.queuedSequences).toHaveLength(1);
      expect(harness.queuedSequences[0]?.map((item) => item.type)).toEqual(["chat", "farewell"]);
      expect(harness.queuedSequences[0]).toMatchObject([
        { type: "chat", platform: "twitch", data: { username: "test-user", userId: "test-user-id" } },
        { type: "farewell", platform: "twitch", data: { username: "test-user", userId: "test-user-id", displayMessage: "Goodbye, test-user! 👋" } },
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  it("routes farewell notification rows even when messages are disabled", async () => {
    const harness = createFarewellRoutingHarness();
    try {
      await harness.platformEventRouter.routeEvent({
        platform: "twitch",
        type: "platform:chat-message",
        data: {
          username: "test-user",
          userId: "test-user-id",
          message: { text: "!bye everyone" },
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });

      const queuedTypes = harness.queuedItems.map((item) => item.type);
      expect(queuedTypes).toEqual(["farewell"]);
    } finally {
      await harness.cleanup();
    }
  });

  it("suppresses repeated farewells per platform while allowing other platforms", async () => {
    const harness = createFarewellRoutingHarness({
      general: {
        messagesEnabled: false,
        logChatMessages: false,
      },
      farewell: {
        command: "!bye|!bye2|!bye3, bye|goodbye|cya",
        timeout: 300,
      },
      twitch: {
        messagesEnabled: false,
        farewellsEnabled: true,
      },
      tiktok: {
        messagesEnabled: false,
        farewellsEnabled: true,
      },
    });
    try {
      await harness.platformEventRouter.routeEvent({
        platform: "twitch",
        type: "platform:chat-message",
        data: {
          username: "test-user-one",
          userId: "test-user-one-id",
          message: { text: "!bye everyone" },
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });

      await harness.platformEventRouter.routeEvent({
        platform: "twitch",
        type: "platform:chat-message",
        data: {
          username: "test-user-two",
          userId: "test-user-two-id",
          message: { text: "!bye again" },
          timestamp: "2024-01-01T00:00:01.000Z",
        },
      });

      await harness.platformEventRouter.routeEvent({
        platform: "tiktok",
        type: "platform:chat-message",
        data: {
          username: "test-user-three",
          userId: "test-user-three-id",
          message: { text: "!bye from tiktok" },
          timestamp: "2024-01-01T00:00:02.000Z",
        },
      });

      const farewellRows = harness.queuedItems.filter((item) => item.type === "farewell");
      expect(farewellRows.length).toBe(2);

      const farewellPlatforms = farewellRows.map((item) => item.platform);
      expect(farewellPlatforms).toEqual(["twitch", "tiktok"]);
    } finally {
      await harness.cleanup();
    }
  });

  it("maps farewell trigger configuration through command-based VFX lookup", async () => {
    const harness = createFarewellRoutingHarness({
      general: {
        messagesEnabled: false,
        logChatMessages: false,
      },
      farewell: {
        command: "!bye|!bye2|!bye3, bye|goodbye|cya",
        timeout: 300,
      },
      twitch: {
        messagesEnabled: false,
        farewellsEnabled: true,
      },
    });
    try {
      await harness.platformEventRouter.routeEvent({
        platform: "twitch",
        type: "platform:chat-message",
        data: {
          username: "test-user-vfx",
          userId: "test-user-vfx-id",
          message: { text: "!bye everyone" },
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });

      const farewellRows = harness.queuedItems.filter((item) => item.type === "farewell");
      expect(farewellRows.length).toBe(1);

      const farewellRow = farewellRows[0];
      if (!farewellRow) {
        throw new Error("Expected a queued farewell row");
      }
      expect(farewellRow.vfxConfig).toBeDefined();
      const selectedCommand = farewellRow.vfxConfig?.command;
      expect(typeof selectedCommand).toBe("string");
      if (typeof selectedCommand !== "string") throw new Error("Expected a resolved farewell command");
      expect(["!bye", "!bye2", "!bye3"]).toContain(selectedCommand);
    } finally {
      await harness.cleanup();
    }
  });

  it("does not invent a cooldown when the configured farewell timeout is zero", async () => {
    const harness = createFarewellRoutingHarness({ farewell: { command: "!bye, bye", timeout: 0 } });
    try {
      for (const username of ["synthetic-zero-first", "synthetic-zero-second"]) {
        await harness.platformEventRouter.routeEvent({
          platform: "twitch", type: "platform:chat-message",
          data: { username, userId: `${username}-id`, message: { text: "!bye everyone" }, timestamp: new Date(testClock.now()).toISOString() },
        });
      }
      expect(harness.queuedItems.map((item) => item.type)).toEqual(["farewell", "farewell"]);
    } finally {
      await harness.cleanup();
    }
  });

  it("retires its owned cooldown interval and supports repeated cleanup", async () => {
    useFakeTimers();
    const baseline = getTimerCount();
    let harness: ReturnType<typeof createFarewellRoutingHarness> | undefined;
    try {
      harness = createFarewellRoutingHarness();
      expect(getTimerCount()).toBe(baseline + 1);
      expect(harness.platformEventRouter.subscription).toEqual(expect.any(Function));
      await harness.cleanup();
      expect(getTimerCount()).toBe(baseline);
      expect(harness.platformEventRouter.subscription).toBeNull();
      await harness.cleanup();
      expect(getTimerCount()).toBe(baseline);
    } finally {
      try {
        await harness?.cleanup();
      } finally {
        useRealTimers();
      }
    }
  });
});
