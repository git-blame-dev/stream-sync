import { vi, describe, test, afterEach, expect, spyOn } from 'bun:test';
import { join } from "node:path";

import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import { TwitchPlatform } from "../../src/platforms/twitch.ts";
import { TwitchAuth } from "../../src/auth/TwitchAuth.ts";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture.ts";
import { noOpLogger } from "../helpers/mock-factories";

import { createTwitchConfigFixture } from "../helpers/config-fixture";
import { waitFor } from "../helpers/event-driven-testing";

type PlatformConstructor = Parameters<
  PlatformLifecycleService["initializeAllPlatforms"]
>[0][string];
type CheerPayload = {
  username: string;
  userId: string;
  giftType: string;
  giftCount: number;
  amount: number;
  currency: string;
  message: string;
  id: string;
  repeatCount: number;
  timestamp: string;
  giftImageUrl?: string;
  cheermoteInfo: Record<string, unknown>;
};
type QueueItem = {
  type: string;
  platform: string;
  data: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const requireQueueItem = (value: unknown): QueueItem => {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) {
    throw new Error("Expected queued display item");
  }
  expect(typeof value.type).toBe("string");
  expect(typeof value.platform).toBe("string");
  expect(isRecord(value.data)).toBe(true);
  if (
    typeof value.type !== "string" ||
    typeof value.platform !== "string" ||
    !isRecord(value.data)
  ) {
    throw new Error("Queued display item has invalid shape");
  }
  return { type: value.type, platform: value.platform, data: value.data };
};

describe("Twitch bits gift platform flow (smoke)", () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  const registerCleanup = (fn: () => Promise<void> | void) => {
    let executed = false;
    const idempotentFn = async () => {
      if (executed) return;
      executed = true;
      await fn();
    };
    cleanups.push(idempotentFn);
    return idempotentFn;
  };

  const runCleanups = async () => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      if (cleanup) {
        await cleanup();
      }
    }
  };

  afterEach(async () => {
    try {
      await runCleanups();
    } finally {
      vi.restoreAllMocks();
    }
  });

  const createTwitchHarness = async (payload: CheerPayload) => {
    const presentation = await createMainPresentationFixture();
    presentation.config.general.debugEnabled = false;
    presentation.config.general.envFileReadEnabled = false;
    presentation.config.general.envFileWriteEnabled = false;
    presentation.config.general.giftsEnabled = true;
    presentation.config.general.paypiggiesEnabled = true;
    presentation.config.logging.file.enabled = false;
    presentation.config.twitch.enabled = false;
    presentation.config.twitch.dataLoggingEnabled = false;
    presentation.config.twitch.giftsEnabled = true;
    presentation.config.twitch.paypiggiesEnabled = true;

    await presentation.start();
    const addItemSpy = spyOn(presentation.queue, "addItem");

    const platformLifecycleService = new PlatformLifecycleService({
      config: { twitch: { enabled: true, dataLoggingEnabled: false } },
      eventBus: presentation.bus,
      logger: noOpLogger,
    });

    const auth = new TwitchAuth({
      tokenStorePath: join(presentation.dir, "twitch-tokens.json"),
      clientId: "synthetic-client",
      expectedUsername: "synthetic-user",
      logger: noOpLogger,
    });

    registerCleanup(async () => {
      auth.dispose();
      await platformLifecycleService.disconnectAll();
      platformLifecycleService.dispose();
      vi.restoreAllMocks();
      await presentation.dispose();
    });

    class ConfiguredTwitchPlatform extends TwitchPlatform {
      constructor() {
        super(
          createTwitchConfigFixture({
            enabled: false,
            clientId: "synthetic-client",
            dataLoggingEnabled: false,
          }),
          {
            logger: noOpLogger,
            twitchAuth: auth,
          },
        );
      }

      override async initialize(
        handlers: Parameters<TwitchPlatform["initialize"]>[0] = {},
      ) {
        this.handlers = handlers;
        await super.initialize(handlers);
        await this.handleGiftEvent(payload);
        return undefined;
      }
    }

    return {
      presentation,
      addItemSpy,
      platformLifecycleService,
      ConfiguredTwitchPlatform:
        ConfiguredTwitchPlatform as unknown as PlatformConstructor,
    };
  };

  test("routes bits gift through lifecycle, router, and runtime as gift", async () => {
    const {
      presentation,
      addItemSpy,
      platformLifecycleService,
      ConfiguredTwitchPlatform,
    } = await createTwitchHarness({
      username: "test_user",
      userId: "tw-cheer-1",
      giftType: "mixed bits",
      giftCount: 1,
      amount: 234,
      currency: "bits",
      message: "",
      id: "cheer-event-234",
      repeatCount: 1,
      timestamp: "2024-01-01T00:00:00.000Z",
      cheermoteInfo: {
        count: 2,
        totalBits: 234,
        cleanPrefix: "Cheer",
        types: [
          { prefix: "Cheer", count: 1 },
          { prefix: "Uni", count: 1 },
        ],
        isMixed: true,
      },
    });

    try {
      await platformLifecycleService.initializeAllPlatforms({
        twitch: ConfiguredTwitchPlatform,
      });
      await waitFor(() => addItemSpy.mock.calls.length === 1, {
        timeout: 500,
        interval: 1,
      });
      await presentation.drain();

      expect(addItemSpy).toHaveBeenCalledTimes(1);
      const queued = requireQueueItem(addItemSpy.mock.calls[0]?.[0]);
      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("twitch");
      expect(queued.data.username).toBe("test_user");
      expect(queued.data.amount).toBe(234);
      expect(queued.data.currency).toBe("bits");
      expect(queued.data.displayMessage).toBe("test_user sent 234 mixed bits");
      expect(queued.data.parts).toBeUndefined();
    } finally {
      await runCleanups();
    }
  });

  test("routes single-type bits gift with inline image parts", async () => {
    const {
      presentation,
      addItemSpy,
      platformLifecycleService,
      ConfiguredTwitchPlatform,
    } = await createTwitchHarness({
      username: "test_user",
      userId: "tw-cheer-2",
      giftType: "bits",
      giftCount: 1,
      amount: 100,
      currency: "bits",
      message: "go team",
      id: "cheer-event-100",
      repeatCount: 1,
      timestamp: "2024-01-01T00:00:00.000Z",
      giftImageUrl:
        "https://example.invalid/twitch/cheer-100-dark-animated-3.gif",
      cheermoteInfo: {
        cleanPrefix: "Cheer",
        tier: 100,
        isMixed: false,
      },
    });

    try {
      await platformLifecycleService.initializeAllPlatforms({
        twitch: ConfiguredTwitchPlatform,
      });
      await waitFor(() => addItemSpy.mock.calls.length === 1, {
        timeout: 500,
        interval: 1,
      });
      await presentation.drain();

      expect(addItemSpy).toHaveBeenCalledTimes(1);
      const queued = requireQueueItem(addItemSpy.mock.calls[0]?.[0]);
      expect(queued.type).toBe("platform:gift");
      expect(queued.platform).toBe("twitch");
      expect(queued.data.parts).toEqual([
        { type: "text", text: "sent 100 " },
        {
          type: "emote",
          platform: "twitch",
          emoteId: "Cheer-100",
          imageUrl:
            "https://example.invalid/twitch/cheer-100-dark-animated-3.gif",
        },
        { type: "text", text: ": go team" },
      ]);
    } finally {
      await runCleanups();
    }
  });
});
