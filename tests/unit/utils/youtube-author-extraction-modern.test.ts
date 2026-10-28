import { describe, expect, it } from "bun:test";
import { getSyntheticFixture } from "../../helpers/platform-test-data";
import * as YouTubeAuthorExtractor from "../../../src/platforms/youtube/youtube-author-extractor";
const realChatMessage = getSyntheticFixture("youtube", "chat-message");
const realChatNoAtPrefix = getSyntheticFixture("youtube", "chat-no-at-prefix");
const realSuperSticker = getSyntheticFixture("youtube", "supersticker");
const realSuperChat = getSyntheticFixture("youtube", "superchat");
const giftPurchaseHeaderOnly = getSyntheticFixture(
  "youtube",
  "gift-purchase-header",
);

type ExtractedAuthor = NonNullable<
  ReturnType<typeof YouTubeAuthorExtractor.extractAuthor>
>;

const expectExtractedAuthor = (author: ExtractedAuthor | null): ExtractedAuthor => {
  expect(author).not.toBeNull();
  if (author === null) {
    throw new Error("Expected YouTube author extraction to succeed");
  }
  return author;
};

describe("YouTube Author Extraction - Modern (Production Data)", () => {
  it("normalizes canonical identity and selects the first usable thumbnail", () => {
    const author = YouTubeAuthorExtractor.extractAuthor({ item: { author: {
      id: "  UC_TEST_STABLE_CHANNEL  ", name: "  @  Test Viewer  ",
      thumbnails: [null, "bad", [], { url: null }, { url: "  " }, { url: " https://example.invalid/test-avatar.png " }, { url: "https://example.invalid/later.png" }],
    } } });
    expect(author).toMatchObject({ id: "UC_TEST_STABLE_CHANNEL", name: "Test Viewer", thumbnailUrl: "https://example.invalid/test-avatar.png" });
  });

  it("filters malformed badge entries without losing native badge prototypes", () => {
    class SyntheticNativeBadge {
      tooltip = "Test member";
      custom_thumbnail = [{ url: "https://example.invalid/test-badge.png" }];
    }
    const nativeBadge = new SyntheticNativeBadge();
    const ownerBadge = { icon_type: "OWNER" };
    const author = expectExtractedAuthor(YouTubeAuthorExtractor.extractAuthor({ item: { author: {
      id: "UC_TEST_STABLE_CHANNEL", name: "@test-viewer", badges: [null, undefined, 1, true, "member", [], nativeBadge, ownerBadge],
    } } }));
    expect(author.badges).toEqual([nativeBadge, ownerBadge]);
    expect(author.badges[0]).toBe(nativeBadge);
    expect(author.badges[0]).toBeInstanceOf(SyntheticNativeBadge);
  });

  it("does not fabricate authors from empty handles, sentinels, or array-shaped records", () => {
    for (const name of ["@", " @   ", "@N/A", " @ N/A ", null]) {
      expect(YouTubeAuthorExtractor.extractAuthor({ item: { author: { id: "UC_TEST_STABLE_CHANNEL", name } } })).toBeNull();
    }
    const authorArray = Object.assign([], { id: "UC_TEST_STABLE_CHANNEL", name: "test-viewer" });
    expect(YouTubeAuthorExtractor.extractAuthor({ item: { author: authorArray } })).toBeNull();
  });
  describe("Real Chat Message Format", () => {
    it("extracts author from chat message with @ prefix in name", () => {
      const author = expectExtractedAuthor(
        YouTubeAuthorExtractor.extractAuthor(realChatMessage),
      );

      expect(author.id).toBe("UC1234567890ABCDE1234567");
      expect(author.name).toBe("TestUser");
      expect(author.thumbnailUrl).toContain("yt-user-64.jpg");
      expect(author.isModerator).toBe(false);
      expect(author.isVerified).toBe(false);
    });

    it("extracts author from chat message without @ prefix in name", () => {
      const author = expectExtractedAuthor(
        YouTubeAuthorExtractor.extractAuthor(realChatNoAtPrefix),
      );

      expect(author.id).toBe("UC7654321098ZYXWVUTSRQ10");
      expect(author.name).toBe("UserWithoutAtPrefix");
      expect(author.thumbnailUrl).toContain("yt-user-no-at-64.jpg");
    });

    it("does NOT create fake displayName field", () => {
      const author = expectExtractedAuthor(
        YouTubeAuthorExtractor.extractAuthor(realChatMessage),
      );

      expect(author).not.toHaveProperty("displayName");
      expect(Object.keys(author)).not.toContain("displayName");
    });

    it("extracts badges array", () => {
      const author = expectExtractedAuthor(
        YouTubeAuthorExtractor.extractAuthor(realChatMessage),
      );

      expect(Array.isArray(author.badges)).toBe(true);
      expect(author.badges).toEqual([]);
    });
  });

  describe("Real SuperSticker Format", () => {
    it("extracts author from SuperSticker event", () => {
      const author = expectExtractedAuthor(
        YouTubeAuthorExtractor.extractAuthor(realSuperSticker),
      );

      expect(author.id).toBe("UC1234567890ABCDE1234567");
      expect(author.name).toBe("StickerSupporter");
      expect(author.thumbnailUrl).toContain("yt-sticker-64.jpg");
    });

    it("extracts member badge from SuperSticker donor", () => {
      const author = expectExtractedAuthor(
        YouTubeAuthorExtractor.extractAuthor(realSuperSticker),
      );

      expect(Array.isArray(author.badges)).toBe(true);
      expect(author.badges.length).toBe(1);
      const [badge] = author.badges;
      expect(badge).toMatchObject({ tooltip: "New member" });
    });

    it("reads snake_case fields from YouTube API correctly", () => {
      const author = expectExtractedAuthor(
        YouTubeAuthorExtractor.extractAuthor(realSuperSticker),
      );

      expect(author.isModerator).toBe(false);
      expect(author.isVerified).toBe(false);
    });
  });

  describe("Real SuperChat Format", () => {
    it("extracts author from SuperChat event", () => {
      const author = expectExtractedAuthor(
        YouTubeAuthorExtractor.extractAuthor(realSuperChat),
      );

      expect(author.id).toBe("UC1234567890ABCDE1234567");
      expect(author.name).toBe("SuperChatDonor");
      expect(author.thumbnailUrl).toContain("yt-donor-64.jpg");
    });
  });

  describe("Error Handling - User Experience", () => {
    it("returns null for null input", () => {
      const author = YouTubeAuthorExtractor.extractAuthor(null);

      expect(author).toBeNull();
    });

    it("returns null for undefined input", () => {
      const author = YouTubeAuthorExtractor.extractAuthor(undefined);

      expect(author).toBeNull();
    });

    it("returns null for invalid object", () => {
      const author = YouTubeAuthorExtractor.extractAuthor({});

      expect(author).toBeNull();
    });

    it("returns null for malformed item", () => {
      const malformed = {
        type: "AddChatItemAction",
        item: {
          type: "LiveChatTextMessage",
          message: { text: "test" },
        },
      };

      const author = YouTubeAuthorExtractor.extractAuthor(malformed);

      expect(author).toBeNull();
    });

    it("returns null when author lacks canonical id", () => {
      const malformed = {
        item: {
          author: {
            channelId: "UC-FAKE-ALIAS-123",
            name: "AliasUser",
            thumbnails: [{ url: "https://example.com/alias-user.jpg" }],
          },
        },
      };

      const author = YouTubeAuthorExtractor.extractAuthor(malformed);

      expect(author).toBeNull();
    });

    it("returns null when author id is not a string", () => {
      const malformed = {
        item: {
          author: {
            id: 12345,
            name: "NumericIdUser",
            thumbnails: [{ url: "https://example.com/numeric-id-user.jpg" }],
          },
        },
      };

      const author = YouTubeAuthorExtractor.extractAuthor(malformed);

      expect(author).toBeNull();
    });

    it("returns null when item.author is missing even if header data exists", () => {
      const headerOnly = {
        ...giftPurchaseHeaderOnly,
        item: {
          ...giftPurchaseHeaderOnly.item,
          author: undefined,
        },
      };
      const author = YouTubeAuthorExtractor.extractAuthor(headerOnly);

      expect(author).toBeNull();
    });
  });

  describe("Output Structure - Consistency", () => {
    it("always returns consistent field structure", () => {
      const author = expectExtractedAuthor(
        YouTubeAuthorExtractor.extractAuthor(realChatMessage),
      );

      expect(author).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        thumbnailUrl: expect.any(String),
        badges: expect.any(Array),
        isModerator: expect.any(Boolean),
        isVerified: expect.any(Boolean),
      });
    });

    it("does NOT include debugging metadata in output", () => {
      const author = expectExtractedAuthor(
        YouTubeAuthorExtractor.extractAuthor(realChatMessage),
      );

      expect(author).not.toHaveProperty("source");
      expect(author).not.toHaveProperty("format");
      expect(author).not.toHaveProperty("isAnonymous");
    });
  });
});
