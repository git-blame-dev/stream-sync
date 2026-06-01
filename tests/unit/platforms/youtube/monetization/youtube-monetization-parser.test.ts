import { describe, test, expect } from "bun:test";
import { noOpLogger } from "../../../../helpers/mock-factories";
import { getSyntheticFixture } from "../../../../helpers/platform-test-data";
const {
  createYouTubeAuthorThumbnailFixture,
  createYouTubeGiftPurchaseHeaderOnlyFixture,
  createYouTubeGiftMessageViewFixture,
} = require("../../../../helpers/avatar-source-matrix-fixtures");
import { normalizeYouTubeEvent } from "../../../../../src/platforms/youtube/events/event-normalizer.ts";
import { createYouTubeMonetizationParser } from "../../../../../src/platforms/youtube/monetization/monetization-parser.ts";

describe("YouTube monetization parser", () => {
  const createGiftMessageViewItem = (overrides = {}) => ({
    item: {
      type: "GiftMessageView",
      id: "ChwKGkNNRHAzZmpKNVpNREZkM0N3Z1FkQUpZWmNn",
      timestamp_usec: "1704067200000000",
      text: {
        content: "sent Girl power for 300 Jewels",
      },
      authorName: {
        content: "@test-youtube-gifter ",
      },
      ...overrides,
    },
  });

  test("parses GiftMessageView jewels gifts into the canonical monetization shape", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const result = parser.parseGiftMessageView(createGiftMessageViewItem());

    expect(result).toEqual({
      id: "ChwKGkNNRHAzZmpKNVpNREZkM0N3Z1FkQUpZWmNn",
      timestamp: new Date(1704067200000).toISOString(),
      giftType: "Girl power",
      giftCount: 1,
      amount: 300,
      currency: "jewels",
      message: "sent Girl power for 300 Jewels",
      giftImageUrl: "https://www.gstatic.com/youtube/img/pdg/gift/assets/girl_power.png=w480-h480",
    });
  });

  test("prefers allowlisted structured GiftMessageView Jewels fields over text parsing", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const result = parser.parseGiftMessageView(
      createGiftMessageViewItem({
        text: { content: "sent ignored malformed text" },
        giftName: { runs: [{ text: "Six seven" }] },
        jewelAmount: { simpleText: "1,250 Jewels" },
      }),
    );

    expect(result.giftType).toBe("Six seven");
    expect(result.amount).toBe(1250);
    expect(result.giftImageUrl).toBe(
      "https://www.gstatic.com/youtube/img/pdg/gift/assets/six_seven.png=w480-h480",
    );
  });

  test("parses GiftMessageView English fallback amounts with thousands separators", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const result = parser.parseGiftMessageView(
      createGiftMessageViewItem({
        text: { content: "sent Girl power for 1,300 Jewels" },
      }),
    );

    expect(result.giftType).toBe("Girl power");
    expect(result.amount).toBe(1300);
  });

  test("resolves jewels gift image URL variants for known gift types", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });

    const partyHat = parser.parseGiftMessageView(createGiftMessageViewItem({
      text: { content: "sent Party hat for 20 Jewels" },
    }));
    const pressF = parser.parseGiftMessageView(createGiftMessageViewItem({
      text: { content: "sent Press F for 10 Jewels" },
    }));
    const goldCoin = parser.parseGiftMessageView(createGiftMessageViewItem({
      text: { content: "sent Gold coin for 10 Jewels" },
    }));

    expect(partyHat.giftImageUrl).toBe("https://www.gstatic.com/youtube/img/pdg/gift/assets/party_hat_320x320.png=w480-h480");
    expect(pressF.giftImageUrl).toBe("https://www.gstatic.com/youtube/img/pdg/gift/assets/press_f.png=w480-h480");
    expect(goldCoin.giftImageUrl).toBe("https://www.gstatic.com/youtube/img/pdg/gift/assets/gold_coin_v2_320x320.png=w480-h480");
  });

  test("leaves jewels giftImageUrl undefined when mapping is unknown", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const result = parser.parseGiftMessageView(createGiftMessageViewItem({
      text: { content: "sent Star for 2 Jewels" },
    }));

    expect(result.giftImageUrl).toBeUndefined();
  });

  test("parses avatarUrl for Super Chat from author thumbnails", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const result = parser.parseSuperChat(
      createYouTubeAuthorThumbnailFixture("LiveChatPaidMessage"),
    );

    expect(result.avatarUrl).toBe(
      "https://example.invalid/youtube/test-author-avatar.jpg",
    );
  });

  test("parses avatarUrl for membership from author thumbnails", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const result = parser.parseMembership(
      createYouTubeAuthorThumbnailFixture("LiveChatMembershipItem"),
    );

    expect(result.avatarUrl).toBe(
      "https://example.invalid/youtube/test-author-avatar.jpg",
    );
  });

  test("keeps GiftMessageView unresolved for avatar when source has no author thumbnail", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const result = parser.parseGiftMessageView(
      createYouTubeGiftMessageViewFixture(),
    );

    expect(result).not.toHaveProperty("avatarUrl");
  });

  test("parses gift purchase avatar after gift-purchase header hydration", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const normalized = normalizeYouTubeEvent(
      createYouTubeGiftPurchaseHeaderOnlyFixture(),
    );
    const normalizedChatItem = normalized.normalizedChatItem;

    expect(normalizedChatItem).not.toBeNull();
    if (normalizedChatItem === null) {
      throw new Error("Expected gift purchase header fixture to normalize");
    }
    const result = parser.parseGiftPurchase(normalizedChatItem);

    expect(result.avatarUrl).toBe(
      "https://example.invalid/youtube/test-giftpurchase-avatar.jpg",
    );
  });

  test("throws for GiftMessageView payloads that do not match jewels gift grammar", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });

    expect(() =>
      parser.parseGiftMessageView(
        createGiftMessageViewItem({
          text: { content: "sent a gift" },
        }),
      ),
    ).toThrow(
      'YouTube GiftMessageView requires text in "sent <gift> for <amount> Jewels" format',
    );
  });

  test("parses numeric purchase_amount with explicit currency", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const fixture = getSyntheticFixture("youtube", "superchat");
    const chatItem = {
      ...fixture,
      item: {
        ...fixture.item,
        purchase_amount: 25,
        purchase_currency: "usd",
      },
    };

    const result = parser.parseSuperChat(chatItem);

    expect(result.amount).toBe(25);
    expect(result.currency).toBe("USD");
    expect(result.giftType).toBe("Super Chat");
  });

  test("coerces giftMembershipsCount numeric strings", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const fixture = getSyntheticFixture("youtube", "gift-purchase-header");
    const chatItem = {
      ...fixture,
      item: {
        ...fixture.item,
        giftMembershipsCount: "7",
      },
    };

    const result = parser.parseGiftPurchase(chatItem);

    expect(result.giftCount).toBe(7);
  });

  test("coerces membershipGiftCount numeric strings for gift purchase count", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const fixture = getSyntheticFixture("youtube", "gift-purchase-header");
    const chatItem = {
      ...fixture,
      item: {
        ...fixture.item,
        giftMembershipsCount: undefined,
        membershipGiftCount: "9",
      },
    };

    const result = parser.parseGiftPurchase(chatItem);

    expect(result.giftCount).toBe(9);
  });

  test("accepts timestamp_usec for membership timestamps", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const chatItem = {
      item: {
        type: "LiveChatMembershipItem",
        id: "LCC.membership-001",
        timestamp_usec: "1704067200000000",
        author: {
          id: "UC_TEST_CHANNEL_000010",
          name: "MemberUser",
        },
        headerPrimaryText: { text: "Member" },
        headerSubtext: { text: "Welcome" },
      },
    };

    const result = parser.parseMembership(chatItem);

    expect(result.timestamp).toBe(new Date(1704067200000).toISOString());
  });

  test("uses membership subtext text when simpleText is non-string", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const chatItem = {
      item: {
        type: "LiveChatMembershipItem",
        id: "LCC.membership-non-string-simpletext",
        timestamp_usec: "1704067200000000",
        author: {
          id: "UC_TEST_CHANNEL_000021",
          name: "MembershipUser",
        },
        headerPrimaryText: { text: "Member for 3 months" },
        headerSubtext: { simpleText: 123, text: "Welcome to Gold" },
      },
    };

    const result = parser.parseMembership(chatItem);

    expect(result.membershipLevel).toBe("Gold");
  });

  test("throws when timestamp is blank", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const chatItem = {
      item: {
        type: "LiveChatPaidMessage",
        id: "LCC.superchat-blank-ts",
        timestamp: "   ",
        purchase_amount: 5,
        purchase_currency: "USD",
        author: {
          id: "UC_TEST_CHANNEL_000020",
          name: "BlankTsUser",
        },
        message: { text: "Hello" },
      },
    };

    expect(() => parser.parseSuperChat(chatItem)).toThrow("requires timestamp");
  });

  test("throws when monetization timestamp is non-positive", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const chatItem = {
      item: {
        type: "LiveChatPaidMessage",
        id: "LCC.superchat-zero-ts",
        timestamp: 0,
        purchase_amount: 5,
        purchase_currency: "USD",
        author: {
          id: "UC_TEST_CHANNEL_000022",
          name: "ZeroTsUser",
        },
        message: { text: "Hello" },
      },
    };

    expect(() => parser.parseSuperChat(chatItem)).toThrow(
      "YouTube Super Chat requires valid timestamp",
    );
  });

  test("throws when timestamp_usec string is non-integer", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const chatItem = {
      item: {
        timestamp_usec: "1704067200000000.5",
      },
    };

    expect(() => parser.resolveTimestamp(chatItem, "YouTube Super Chat")).toThrow(
      "YouTube Super Chat requires valid timestamp",
    );
  });

  test("converts microsecond timestamps when provided in timestamp field", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const chatItem = {
      item: {
        timestamp: "1704067200000000",
      },
    };

    const result = parser.resolveTimestamp(chatItem, "YouTube Super Chat");

    expect(result).toBe(new Date(1704067200000).toISOString());
  });

  test("uses sticker label when name and altText are missing", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const chatItem = {
      item: {
        type: "LiveChatPaidSticker",
        id: "LCC.sticker-001",
        timestamp_usec: "1704067200000000",
        purchase_amount: 2,
        purchase_currency: "USD",
        sticker: {
          label: { runs: [{ text: "Nice sticker" }] },
        },
      },
    };

    const result = parser.parseSuperSticker(chatItem);

    expect(result.message).toBe("Nice sticker");
  });

  test("prefers top-level sticker accessibility label and normalizes protocol-relative sticker URL", () => {
    const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
    const chatItem = {
      item: {
        type: "LiveChatPaidSticker",
        id: "LCC.test-supersticker-002",
        timestamp_usec: "1704067200000000",
        purchase_amount: "A$7.99",
        sticker_accessibility_label:
          "Pear character lifting some weights saying 'Keep it up'",
        sticker: [
          {
            url: "//lh3.googleusercontent.com/hxUGRWjxbKaI8Gk6earRTJW5Vub52yvfvorXXkfi-4fqpB7VJzu4K6pbBO4UIsDstah8zLKeUz6FQ9W0qnY=s176-rwa",
            width: 176,
            height: 176,
          },
          {
            url: "//lh3.googleusercontent.com/hxUGRWjxbKaI8Gk6earRTJW5Vub52yvfvorXXkfi-4fqpB7VJzu4K6pbBO4UIsDstah8zLKeUz6FQ9W0qnY=s88-rwa",
            width: 88,
            height: 88,
          },
        ],
      },
    };

    const result = parser.parseSuperSticker(chatItem);

    expect(result.message).toBe(
      "Pear character lifting some weights saying 'Keep it up'",
    );
    expect(result.giftImageUrl).toBe(
      "https://lh3.googleusercontent.com/hxUGRWjxbKaI8Gk6earRTJW5Vub52yvfvorXXkfi-4fqpB7VJzu4K6pbBO4UIsDstah8zLKeUz6FQ9W0qnY=s176-rwa",
    );
  });
});
