import { describe, test, expect, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../../../../helpers/bun-mock-utils";

import { YouTubePlatform } from "../../../../../src/platforms/youtube";
import { createYouTubeSuperChatEvent } from "../../../../helpers/youtube-test-data";
import { createMockPlatformDependencies } from "../../../../helpers/test-setup";
import { createYouTubeConfigFixture } from "../../../../helpers/config-fixture";

type YouTubeGiftEvent = {
  platform: "youtube";
  type: "platform:gift";
  username: string;
  giftType: string;
  giftCount: number;
  amount: number;
  currency: string;
  message?: string;
  userId?: string;
  id?: string;
  timestamp?: string;
  metadata?: { missingFields?: string[] };
};

type YouTubeMembershipEvent = {
  platform: "youtube";
  type: "platform:paypiggy";
  username: string;
  userId: string;
  avatarUrl?: string;
  membershipLevel?: string;
  message?: string;
  months?: number;
  timestamp?: string;
};

const expectSingleEvent = <Event>(events: Event[]): Event => {
  expect(events).toHaveLength(1);
  const [event] = events;
  expect(event).toBeDefined();
  if (event === undefined) {
    throw new Error("Expected one YouTube event");
  }
  return event;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const expectGiftEvent = (event: unknown): YouTubeGiftEvent => {
  expect(isRecord(event)).toBe(true);
  expect(isRecord(event) ? event.platform : undefined).toBe("youtube");
  expect(isRecord(event) ? event.type : undefined).toBe("platform:gift");
  return event as YouTubeGiftEvent;
};

const expectMembershipEvent = (event: unknown): YouTubeMembershipEvent => {
  expect(isRecord(event)).toBe(true);
  expect(isRecord(event) ? event.platform : undefined).toBe("youtube");
  expect(isRecord(event) ? event.type : undefined).toBe("platform:paypiggy");
  return event as YouTubeMembershipEvent;
};

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
    const giftEvents: YouTubeGiftEvent[] = [];
    youtubePlatform.handlers = {
      ...youtubePlatform.handlers,
      onGift: (event: unknown) => {
        giftEvents.push(expectGiftEvent(event));
      },
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

    const giftEvent = expectSingleEvent(giftEvents);
    expect(giftEvent).toMatchObject({
      platform: "youtube",
      type: "platform:gift",
      username: "SuperChatUser",
      giftType: "Super Chat",
      giftCount: 1,
      amount: 10,
      currency: "USD",
    });
    expect(giftEvent.message).toBe(
      "Thanks for the amazing content! Keep it up!",
    );
    expect(giftEvent.userId).toBeTruthy();
    expect(giftEvent.id).toBeTruthy();
  });

  test("emits paypiggy events for LiveChatMembershipItem payloads", async () => {
    const youtubePlatform = createPlatform();
    const membershipEvents: YouTubeMembershipEvent[] = [];
    youtubePlatform.handlers = {
      ...youtubePlatform.handlers,
      onPaypiggy: (event: unknown) => {
        membershipEvents.push(expectMembershipEvent(event));
      },
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

    const membershipEvent = expectSingleEvent(membershipEvents);
    expect(membershipEvent).toMatchObject({
      platform: "youtube",
      type: "platform:paypiggy",
      username: "MemberUser",
      userId: "UC_TEST_CHANNEL_00999",
      membershipLevel: "Gold Member",
      message: "Welcome to the membership",
      months: 3,
    });
    expect(membershipEvent.timestamp).toBe(
      new Date(1704067200000).toISOString(),
    );
  });

  test("emits a YouTube jewels gift event for GiftMessageView without fabricating userId", async () => {
    const youtubePlatform = createPlatform();
    const giftEvents: YouTubeGiftEvent[] = [];
    youtubePlatform.handlers = {
      ...youtubePlatform.handlers,
      onGift: (event: unknown) => {
        giftEvents.push(expectGiftEvent(event));
      },
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

    const giftEvent = expectSingleEvent(giftEvents);
    expect(giftEvent).toMatchObject({
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
    expect(giftEvent.timestamp).toBe(new Date(1704067200000).toISOString());
    expect(giftEvent.userId).toBeUndefined();
  });

  test("resolves GiftMessageView usernames from snake_case author_name payloads", async () => {
    const youtubePlatform = createPlatform();
    const giftEvents: YouTubeGiftEvent[] = [];
    youtubePlatform.handlers = {
      ...youtubePlatform.handlers,
      onGift: (event: unknown) => {
        giftEvents.push(expectGiftEvent(event));
      },
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

    const giftEvent = expectSingleEvent(giftEvents);
    expect(giftEvent.username).toBe("test-snake-gifter");
    expect(giftEvent.currency).toBe("jewels");
  });

  test("emits renewal paypiggy events for real snake_case YouTube membership milestone payloads", async () => {
    const youtubePlatform = createPlatform();
    const membershipEvents: YouTubeMembershipEvent[] = [];
    youtubePlatform.handlers = {
      ...youtubePlatform.handlers,
      onPaypiggy: (event: unknown) => {
        membershipEvents.push(expectMembershipEvent(event));
      },
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

    const membershipEvent = expectSingleEvent(membershipEvents);
    expect(membershipEvent).toMatchObject({
      platform: "youtube",
      type: "platform:paypiggy",
      username: "MilestoneUser",
      userId: "UC_TEST_CHANNEL_01000",
      avatarUrl: "https://example.invalid/youtube-membership-avatar.png",
      months: 10,
      message: "Thanks for the membership!",
    });
    expect(membershipEvent.timestamp).toBe(
      new Date(1773660646737).toISOString(),
    );
  });
});
