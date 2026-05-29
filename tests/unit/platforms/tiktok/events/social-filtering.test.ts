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

type TikTokDependencies = NonNullable<ConstructorParameters<typeof TikTokPlatform>[1]>;
type TikTokWebcastEvent = NonNullable<TikTokDependencies["WebcastEvent"]>;

const WEBCAST_EVENT = {
  CHAT: "chat",
  GIFT: "gift",
  FOLLOW: "follow",
  SOCIAL: "social",
  ROOM_USER: "roomUser",
  ERROR: "error",
  DISCONNECT: "disconnect",
} satisfies TikTokWebcastEvent;

describe("TikTok social filtering", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const baseConfig = { enabled: true, username: "social_tester" };

  const createPlatform = () => {
    const dependencies = {
      ...createMockTikTokPlatformDependencies(),
      logger: noOpLogger,
      connectionFactory: { createConnection: createMockFn() },
      WebcastEvent: WEBCAST_EVENT,
    } satisfies ConstructorParameters<typeof TikTokPlatform>[1];

    return new TikTokPlatform(baseConfig, dependencies);
  };

  test.skipIf(isPreloadMocked)(
    "ignores social actions that are not follow/share",
    async () => {
      const platform = createPlatform();
      const interactions: unknown[] = [];
      platform.handlers = {
        ...platform.handlers,
        onInteraction: (data: unknown) => interactions.push(data),
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
