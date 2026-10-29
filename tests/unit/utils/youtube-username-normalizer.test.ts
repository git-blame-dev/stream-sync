import { describe, test, expect } from "bun:test";
const {
  normalizeYouTubeUsername,
} = require("../../../src/platforms/youtube/youtube-username-normalizer");
import {
  INTERNATIONAL_USERNAMES,
  BOUNDARY_CONDITIONS,
} from "../../helpers/platform-test-data";
describe("YouTube Username Normalization", () => {
  describe("normalizeYouTubeUsername", () => {
    test("trims after removing exactly one handle prefix before checking sentinels", () => {
      expect(normalizeYouTubeUsername("  @  Test Viewer  ")).toBe("Test Viewer");
      expect(normalizeYouTubeUsername("@N/A")).toBeNull();
      expect(normalizeYouTubeUsername(" @ N/A ")).toBeNull();
      expect(normalizeYouTubeUsername(" @   ")).toBeNull();
      expect(normalizeYouTubeUsername("@@test-viewer")).toBe("@test-viewer");
    });
    test("should remove @ prefix from YouTube usernames", () => {
      expect(normalizeYouTubeUsername("@gordontechreviews")).toBe(
        "gordontechreviews",
      );
      expect(normalizeYouTubeUsername("@testuser123")).toBe("testuser123");
      expect(normalizeYouTubeUsername("@user_with_underscores")).toBe(
        "user_with_underscores",
      );
    });

    test("should handle usernames without @ prefix", () => {
      expect(normalizeYouTubeUsername("regularuser")).toBe("regularuser");
      expect(normalizeYouTubeUsername("NoAtSign")).toBe("NoAtSign");
      expect(normalizeYouTubeUsername("user123")).toBe("user123");
    });

    test("should handle special case N/A usernames", () => {
      expect(normalizeYouTubeUsername("N/A")).toBeNull();
    });

    test("should handle edge cases and invalid inputs", () => {
      expect(normalizeYouTubeUsername(null)).toBeNull();
      expect(normalizeYouTubeUsername(undefined)).toBeNull();
      expect(normalizeYouTubeUsername("")).toBeNull();
      expect(normalizeYouTubeUsername("   ")).toBeNull();
      expect(normalizeYouTubeUsername("@")).toBeNull();
      expect(normalizeYouTubeUsername("@   ")).toBeNull();
    });

    test("should handle non-string inputs gracefully", () => {
      expect(normalizeYouTubeUsername(123)).toBeNull();
      expect(normalizeYouTubeUsername({})).toBeNull();
      expect(normalizeYouTubeUsername([])).toBeNull();
      expect(normalizeYouTubeUsername(true)).toBeNull();
    });

    test("should trim whitespace around usernames", () => {
      expect(normalizeYouTubeUsername("  @user123  ")).toBe("user123");
      expect(normalizeYouTubeUsername("  regularuser  ")).toBe("regularuser");
      expect(normalizeYouTubeUsername("  N/A  ")).toBeNull();
    });

    test("should handle usernames with emoji and special characters", () => {
      expect(normalizeYouTubeUsername("@user_😀_test")).toBe("user_😀_test");
      expect(normalizeYouTubeUsername("@user-with-dashes")).toBe(
        "user-with-dashes",
      );
      expect(normalizeYouTubeUsername("@user.with.dots")).toBe(
        "user.with.dots",
      );
    });

    test("should handle international usernames correctly", () => {
      expect(
        normalizeYouTubeUsername(`@${INTERNATIONAL_USERNAMES.chinese}`),
      ).toBe(INTERNATIONAL_USERNAMES.chinese);
      expect(
        normalizeYouTubeUsername(`@${INTERNATIONAL_USERNAMES.japanese}`),
      ).toBe(INTERNATIONAL_USERNAMES.japanese);
      expect(
        normalizeYouTubeUsername(`@${INTERNATIONAL_USERNAMES.korean}`),
      ).toBe(INTERNATIONAL_USERNAMES.korean);
      expect(
        normalizeYouTubeUsername(`@${INTERNATIONAL_USERNAMES.arabic}`),
      ).toBe(INTERNATIONAL_USERNAMES.arabic);
      expect(
        normalizeYouTubeUsername(`@${INTERNATIONAL_USERNAMES.hebrew}`),
      ).toBe(INTERNATIONAL_USERNAMES.hebrew);
      expect(
        normalizeYouTubeUsername(`@${INTERNATIONAL_USERNAMES.russian}`),
      ).toBe(INTERNATIONAL_USERNAMES.russian);
      expect(
        normalizeYouTubeUsername(`@${INTERNATIONAL_USERNAMES.german}`),
      ).toBe(INTERNATIONAL_USERNAMES.german);
      expect(
        normalizeYouTubeUsername(`@${INTERNATIONAL_USERNAMES.emoji}`),
      ).toBe(INTERNATIONAL_USERNAMES.emoji);
      expect(
        normalizeYouTubeUsername(`@${INTERNATIONAL_USERNAMES.emojiMixed}`),
      ).toBe(INTERNATIONAL_USERNAMES.emojiMixed);
    });

    test("should handle extremely long international usernames", () => {
      expect(
        normalizeYouTubeUsername(`@${INTERNATIONAL_USERNAMES.longUnicode}`),
      ).toBe(INTERNATIONAL_USERNAMES.longUnicode);
      expect(
        normalizeYouTubeUsername(`@${BOUNDARY_CONDITIONS.maxUsername}`),
      ).toBe(BOUNDARY_CONDITIONS.maxUsername);
    });

    test("should handle boundary condition usernames", () => {
      expect(normalizeYouTubeUsername("@")).toBeNull();
      expect(
        normalizeYouTubeUsername(`@${BOUNDARY_CONDITIONS.singleChar}`),
      ).toBe(BOUNDARY_CONDITIONS.singleChar);
      expect(
        normalizeYouTubeUsername(`@${BOUNDARY_CONDITIONS.singleSpace}`),
      ).toBeNull();
      expect(
        normalizeYouTubeUsername(`@${BOUNDARY_CONDITIONS.multipleSpaces}`),
      ).toBeNull();
      expect(
        normalizeYouTubeUsername(`@user${BOUNDARY_CONDITIONS.specialChars}`),
      ).toBe(`user${BOUNDARY_CONDITIONS.specialChars}`);
    });
  });

  describe("Integration scenarios", () => {
    test("should provide consistent results across multiple calls", () => {
      const testCases = [
        "@testuser123",
        "N/A",
        "RegularUser",
        null,
        "@user_with_emojis_😀",
      ];

      testCases.forEach((input) => {
        const result1 = normalizeYouTubeUsername(input);
        const result2 = normalizeYouTubeUsername(input);
        expect(result1).toBe(result2);
      });
    });
  });

  describe("International username categories", () => {
    test("should handle all international username categories", () => {
      const categories: Array<keyof typeof INTERNATIONAL_USERNAMES> = [
        "chinese",
        "chineseTraditional",
        "japanese",
        "korean",
        "arabic",
        "hebrew",
        "persian",
        "russian",
        "greek",
        "german",
        "french",
        "polish",
        "hindi",
        "bengali",
        "tamil",
        "thai",
        "amharic",
        "swahili",
        "emoji",
        "emojiMixed",
        "emojiOnly",
        "mixed",
        "mixedRtl",
        "longUnicode",
        "mathematical",
        "zalgo",
      ];

      categories.forEach((category) => {
        const username = INTERNATIONAL_USERNAMES[category];
        if (username) {
          const result = normalizeYouTubeUsername(`@${username}`);
          expect(result).toBe(username);
          expect(result).toBeTruthy();
          expect(typeof result).toBe("string");
        }
      });
    });
  });
});
