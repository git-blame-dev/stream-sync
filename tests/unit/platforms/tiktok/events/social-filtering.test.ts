import { describe, test, expect, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../../../../helpers/bun-mock-utils";
import { initializeTestLogging } from "../../../../helpers/test-setup";

initializeTestLogging();

import { TikTokPlatform } from "../../../../../src/platforms/tiktok.ts";
const isPreloadMocked =
  !TikTokPlatform ||
  !TikTokPlatform.prototype ||
  !TikTokPlatform.prototype.handleTikTokSocial;
import {
  createMockTikTokPlatformDependencies,
  noOpLogger,
} from "../../../../helpers/mock-factories";
import * as testClock from "../../../../helpers/test-clock";

describe("TikTok social filtering", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const baseConfig = { enabled: true, username: "social_tester" };

  const createPlatform = () =>
    new TikTokPlatform(baseConfig, {
      ...createMockTikTokPlatformDependencies(),
      logger: noOpLogger,
      connectionFactory: { createConnection: createMockFn() },
      timestampService: {
        extractTimestamp: createMockFn(() =>
          new Date(testClock.now()).toISOString(),
        ),
      },
    });

  test.skipIf(isPreloadMocked)(
    "ignores social actions that are not follow/share",
    async () => {
      const platform = createPlatform();
      const interactions = [];
      platform.handlers = {
        ...platform.handlers,
        onInteraction: (data) => interactions.push(data),
      };

      await platform.handleTikTokSocial({
        user: { userId: "tt-user-1", uniqueId: "social_user" },
        displayType: "poke",
        actionType: "poke",
        common: { createTime: testClock.now() },
      });

      expect(interactions).toHaveLength(0);
    },
  );
});
