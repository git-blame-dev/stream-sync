import { describe, test, expect, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../../../../helpers/bun-mock-utils";

import { YouTubePlatform } from "../../../../../src/platforms/youtube";
import { createYouTubeSuperChatEvent } from "../../../../helpers/youtube-test-data";
import { createMockPlatformDependencies } from "../../../../helpers/test-setup";
import { createYouTubeConfigFixture } from "../../../../helpers/config-fixture";

describe("YouTube monetized event pipeline", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const baseConfig = createYouTubeConfigFixture({
    enabled: true,
    username: "notification-test",
  });

  const createPlatform = () =>
    new YouTubePlatform(baseConfig, {
      ...createMockPlatformDependencies("youtube"),
      streamDetectionService: {
        detectLiveStreams: createMockFn().mockResolvedValue({
          success: true,
          videoIds: [],
        }),
      },
    });

  test("emits a single gift event for SuperChats through the unified pipeline", async () => {
    const youtubePlatform = createPlatform();
    const giftEvents = [];
    youtubePlatform.handlers = {
      ...youtubePlatform.handlers,
      onGift: (event) => giftEvents.push(event),
    };

    const superChat = createYouTubeSuperChatEvent(10, "USD", {
      item: {
        author: {
          id: "youtube-user-1",
          name: "SuperChatUser",
        },
        message: {
          runs: [{ text: "Thanks for the amazing content! Keep it up!" }],
        },
      },
    });

    await youtubePlatform.handleChatMessage(superChat);
    await new Promise((resolve) => setImmediate(resolve));

    expect(giftEvents).toHaveLength(1);
    expect(giftEvents[0]).toMatchObject({
      platform: "youtube",
      type: "platform:gift",
      username: "SuperChatUser",
      giftType: "Super Chat",
      giftCount: 1,
      amount: 10,
      currency: "USD",
    });
    expect(giftEvents[0].message).toBe(
      "Thanks for the amazing content! Keep it up!",
    );
    expect(giftEvents[0].userId).toBeTruthy();
    expect(giftEvents[0].id).toBeTruthy();
  });

  test("emits paypiggy events for LiveChatMembershipItem payloads", async () => {
    const youtubePlatform = createPlatform();
    const membershipEvents = [];
    youtubePlatform.handlers = {
      ...youtubePlatform.handlers,
      onPaypiggy: (event) => membershipEvents.push(event),
    };

    const membershipItem = {
      item: {
        type: "LiveChatMembershipItem",
        id: "LCC.test-membership-001",
        timestamp_usec: "1704067200000000",
        author: {
          id: "UC_TEST_CHANNEL_00999",
          name: "MemberUser",
        },
        headerPrimaryText: { text: "Gold Member" },
        headerSubtext: { text: "Welcome to the membership" },
        memberMilestoneDurationInMonths: 3,
      },
    };

    await youtubePlatform.handleChatMessage(membershipItem);
    await new Promise((resolve) => setImmediate(resolve));

    expect(membershipEvents).toHaveLength(1);
    expect(membershipEvents[0]).toMatchObject({
      platform: "youtube",
      type: "platform:paypiggy",
      username: "MemberUser",
      userId: "UC_TEST_CHANNEL_00999",
      membershipLevel: "Gold Member",
      message: "Welcome to the membership",
      months: 3,
    });
    expect(membershipEvents[0].timestamp).toBe(
      new Date(1704067200000).toISOString(),
    );
  });

  test("emits a YouTube jewels gift event for GiftMessageView without fabricating userId", async () => {
    const youtubePlatform = createPlatform();
    const giftEvents = [];
    youtubePlatform.handlers = {
      ...youtubePlatform.handlers,
      onGift: (event) => giftEvents.push(event),
    };

    await youtubePlatform.handleChatMessage({
      item: {
        type: "GiftMessageView",
        id: "ChwKGkNNRHAzZmpKNVpNREZkM0N3Z1FkQUpZWmNn",
        timestamp_usec: "1704067200000000",
        text: {
          content: "sent Girl power for 300 Jewels",
        },
        authorName: {
          content: "@test-jewels-gifter ",
        },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(giftEvents).toHaveLength(1);
    expect(giftEvents[0]).toMatchObject({
      platform: "youtube",
      type: "platform:gift",
      username: "test-jewels-gifter",
      giftType: "Girl power",
      giftCount: 1,
      amount: 300,
      currency: "jewels",
      id: "ChwKGkNNRHAzZmpKNVpNREZkM0N3Z1FkQUpZWmNn",
      metadata: {
        missingFields: ["userId"],
      },
    });
    expect(giftEvents[0].timestamp).toBe(new Date(1704067200000).toISOString());
    expect(giftEvents[0].userId).toBeUndefined();
  });

  test("resolves GiftMessageView usernames from snake_case author_name payloads", async () => {
    const youtubePlatform = createPlatform();
    const giftEvents = [];
    youtubePlatform.handlers = {
      ...youtubePlatform.handlers,
      onGift: (event) => giftEvents.push(event),
    };

    await youtubePlatform.handleChatMessage({
      item: {
        type: "GiftMessageView",
        id: "ChwKGkNQMnAwNmFnNkpNREZTVHp3Z1FkdFFZeTB3",
        timestamp_usec: "1704067200000000",
        text: {
          content: "sent Six seven for 67 Jewels",
        },
        author_name: {
          content: "@test-snake-gifter ",
        },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(giftEvents).toHaveLength(1);
    expect(giftEvents[0].username).toBe("test-snake-gifter");
    expect(giftEvents[0].currency).toBe("jewels");
  });

  test("emits renewal paypiggy events for real snake_case YouTube membership milestone payloads", async () => {
    const youtubePlatform = createPlatform();
    const membershipEvents = [];
    youtubePlatform.handlers = {
      ...youtubePlatform.handlers,
      onPaypiggy: (event) => membershipEvents.push(event),
    };

    const membershipItem = {
      item: {
        type: "LiveChatMembershipItem",
        id: "LCC.test-membership-snake-001",
        timestamp_usec: "1773660646737554",
        author: {
          id: "UC_TEST_CHANNEL_01000",
          name: "@MilestoneUser",
          thumbnails: [
            {
              url: "https://example.invalid/youtube-membership-avatar.png",
              width: 64,
              height: 64,
            },
          ],
        },
        header_primary_text: {
          text: "Member for 10 months",
          runs: [{ text: "Member for " }, { text: "10" }, { text: " months" }],
        },
        header_subtext: {
          text: "Member",
          rtl: false,
        },
        message: {
          text: "Thanks for the membership!",
          runs: [{ text: "Thanks for the membership!" }],
        },
      },
    };

    await youtubePlatform.handleChatMessage(membershipItem);
    await new Promise((resolve) => setImmediate(resolve));

    expect(membershipEvents).toHaveLength(1);
    expect(membershipEvents[0]).toMatchObject({
      platform: "youtube",
      type: "platform:paypiggy",
      username: "MilestoneUser",
      userId: "UC_TEST_CHANNEL_01000",
      avatarUrl: "https://example.invalid/youtube-membership-avatar.png",
      months: 10,
      message: "Thanks for the membership!",
    });
    expect(membershipEvents[0].timestamp).toBe(
      new Date(1773660646737).toISOString(),
    );
  });
});
