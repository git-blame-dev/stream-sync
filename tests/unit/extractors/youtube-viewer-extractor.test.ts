import { describe, expect, test } from "bun:test";
import { YouTubeViewerExtractor } from "../../../src/extractors/youtube-viewer-extractor";

describe("YouTubeViewerExtractor", () => {
  describe("extractConcurrentViewers", () => {
    test("uses view_text by default and records attempts", () => {
      const videoInfo = {
        primary_info: {
          view_count: { view_count: { text: "1,234 watching now" } },
        },
        video_details: {
          viewer_count: "9999",
        },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

      expect(result).toMatchObject({
        success: true,
        count: 1234,
        strategy: "view_text",
        metadata: {
          strategiesAttempted: ["view_text"],
          rawData: null,
        },
      });
    });

    test("falls back to video_details when view_text is unavailable", () => {
      const videoInfo = {
        video_details: { viewer_count: "456" },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

      expect(result.success).toBe(true);
      expect(result.count).toBe(456);
      expect(result.strategy).toBe("video_details");
      expect(result.metadata.strategiesAttempted).toEqual([
        "view_text",
        "video_details",
      ]);
      expect(result.metadata.rawData).toBeNull();
    });

    test("extracts zero viewer counts from live basic_info", () => {
      const videoInfo = {
        basic_info: { is_live: true, view_count: 0 },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(
        videoInfo,
        {
          strategies: ["basic_info"],
        },
      );

      expect(result).toMatchObject({
        success: true,
        count: 0,
        strategy: "basic_info",
      });
      expect(result.metadata.strategiesAttempted).toEqual(["basic_info"]);
    });

    test("returns an explicit unsuccessful result when video info is missing", () => {
      const result = YouTubeViewerExtractor.extractConcurrentViewers(null as never);

      expect(result).toEqual({
        success: false,
        count: 0,
        strategy: null,
        metadata: {
          strategiesAttempted: [],
          rawData: null,
          error: "No video info provided",
        },
      });
    });

    test("includes raw strategy metadata in debug mode", () => {
      const videoInfo = {
        primary_info: {
          view_count: { view_count: { text: "8,765 watching now" } },
        },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo as never, {
        debug: true,
      });

      expect(result).toMatchObject({
        success: true,
        count: 8765,
        strategy: "view_text",
        metadata: {
          strategiesAttempted: ["view_text"],
          rawData: {
            view_text: {
              viewText: "8,765 watching now",
              hasViewText: true,
              viewTextType: "string",
              patternMatched: "watching_now",
              extractedText: "8,765 watching now",
            },
          },
        },
      });
    });

    test("uses caller-provided strategy order when multiple requested strategies can succeed", () => {
      const videoInfo = {
        primary_info: {
          view_count: { view_count: { text: "111 watching now" } },
        },
        video_details: { viewer_count: "222" },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo as never, {
        strategies: ["video_details", "view_text"],
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(222);
      expect(result.strategy).toBe("video_details");
      expect(result.metadata.strategiesAttempted).toEqual(["video_details"]);
    });

    test("falls back in caller-provided strategy order", () => {
      const videoInfo = {
        primary_info: {
          view_count: { view_count: { text: "333 watching now" } },
        },
        video_details: { viewer_count: "not-a-number" },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo as never, {
        strategies: ["video_details", "view_text"],
      });

      expect(result.success).toBe(true);
      expect(result.count).toBe(333);
      expect(result.strategy).toBe("view_text");
      expect(result.metadata.strategiesAttempted).toEqual([
        "video_details",
        "view_text",
      ]);
    });

    test("ignores unknown strategies and records only attempted known strategies", () => {
      const videoInfo = {
        primary_info: {
          view_count: { view_count: { text: "123 watching now" } },
        },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo as never, {
        strategies: ["unknown", "view_text"],
      });

      expect(result).toMatchObject({
        success: true,
        count: 123,
        strategy: "view_text",
      });
      expect(result.metadata.strategiesAttempted).toEqual(["view_text"]);
    });

    test("returns unsuccessful result when all requested strategies are unknown", () => {
      const result = YouTubeViewerExtractor.extractConcurrentViewers({} as never, {
        strategies: ["unknown"],
      });

      expect(result).toMatchObject({
        success: false,
        count: 0,
        strategy: null,
      });
      expect(result.metadata.strategiesAttempted).toEqual([]);
    });

    test("does not treat non-live basic_info view counts as concurrent viewers", () => {
      const videoInfo = {
        basic_info: { is_live: false, view_count: 12345 },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(
        videoInfo,
        {
          strategies: ["basic_info"],
        },
      );

      expect(result).toMatchObject({
        success: false,
        count: 0,
        strategy: null,
      });
      expect(result.metadata.strategiesAttempted).toEqual(["basic_info"]);
    });

    test("falls back from invalid viewer_count to valid concurrent_viewers", () => {
      const videoInfo = {
        video_details: {
          viewer_count: "not-a-number",
          concurrent_viewers: "444",
        },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo as never, {
        strategies: ["video_details"],
      });

      expect(result).toMatchObject({
        success: true,
        count: 444,
        strategy: "video_details",
      });
      expect(result.metadata.strategiesAttempted).toEqual(["video_details"]);
    });

    test("rejects partial numeric strings, decimals, and malformed separators in structured fields", () => {
      const invalidValues = [
        "12abc",
        "12.5",
        "1,234",
        "1 234",
        "",
        "-1",
        Number.POSITIVE_INFINITY,
        NaN,
        12.5,
      ];

      invalidValues.forEach((viewerCount) => {
        const result = YouTubeViewerExtractor.extractConcurrentViewers(
          { video_details: { viewer_count: viewerCount } } as never,
          { strategies: ["video_details"] },
        );

        expect(result.success).toBe(false);
        expect(result.count).toBe(0);
      });
    });

    test("accepts finite non-negative integer numbers and whole-string decimal integer strings", () => {
      const validValues = [0, 123, "0", "123"];

      validValues.forEach((viewerCount) => {
        const result = YouTubeViewerExtractor.extractConcurrentViewers(
          { video_details: { viewer_count: viewerCount } } as never,
          { strategies: ["video_details"] },
        );

        expect(result.success).toBe(true);
        expect(result.count).toBe(Number(viewerCount));
      });
    });

    test("includes video_details raw metadata in debug mode", () => {
      const videoInfo = {
        video_details: {
          viewer_count: undefined,
          concurrent_viewers: "555",
        },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo as never, {
        debug: true,
        strategies: ["video_details"],
      });

      expect(result).toMatchObject({
        success: true,
        count: 555,
        strategy: "video_details",
        metadata: {
          rawData: {
            video_details: {
              hasVideoDetails: true,
              viewer_count: undefined,
              concurrent_viewers: "555",
              sourceField: "concurrent_viewers",
            },
          },
        },
      });
    });

    test("includes basic_info raw metadata in debug mode", () => {
      const videoInfo = {
        basic_info: {
          is_live: true,
          view_count: "666",
        },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo as never, {
        debug: true,
        strategies: ["basic_info"],
      });

      expect(result).toMatchObject({
        success: true,
        count: 666,
        strategy: "basic_info",
        metadata: {
          rawData: {
            basic_info: {
              hasBasicInfo: true,
              is_live: true,
              view_count: "666",
              sourceField: "view_count",
            },
          },
        },
      });
    });
  });

  describe("strategy error handling", () => {
    test("records view_text extraction errors in debug metadata", () => {
      const videoInfo = {
        primary_info: {
          view_count: {
            get view_count() {
              throw new Error("view text unavailable");
            },
          },
        },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo as never, {
        debug: true,
        strategies: ["view_text"],
      });

      expect(result).toMatchObject({
        success: false,
        count: 0,
        strategy: null,
        metadata: {
          rawData: {
            view_text: {
              error: "view text unavailable",
            },
          },
        },
      });
    });

    test("records video_details extraction errors in debug metadata", () => {
      const videoInfo = {
        get video_details() {
          throw new Error("video details unavailable");
        },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo as never, {
        debug: true,
        strategies: ["video_details"],
      });

      expect(result).toMatchObject({
        success: false,
        metadata: {
          rawData: {
            video_details: {
              error: "video details unavailable",
            },
          },
        },
      });
    });

    test("records basic_info extraction errors in debug metadata", () => {
      const videoInfo = {
        get basic_info() {
          throw new Error("basic info unavailable");
        },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo as never, {
        debug: true,
        strategies: ["basic_info"],
      });

      expect(result).toMatchObject({
        success: false,
        metadata: {
          rawData: {
            basic_info: {
              error: "basic info unavailable",
            },
          },
        },
      });
    });
  });

  describe("_parseWatchingText", () => {
    test("parses supported watching text patterns", () => {
      const cases = [
        {
          text: "1,234 watching now",
          count: 1234,
          pattern: "watching_now",
        },
        { text: "55 watching", count: 55, pattern: "watching" },
        {
          text: "66 currently watching",
          count: 66,
          pattern: "currently_watching",
        },
        {
          text: "77 viewers watching",
          count: 77,
          pattern: "viewers_watching",
        },
        {
          text: "88 people watching",
          count: 88,
          pattern: "people_watching",
        },
      ];

      cases.forEach(({ text, count, pattern }) => {
        expect(YouTubeViewerExtractor._parseWatchingText(text)).toMatchObject({
          success: true,
          count,
          pattern,
          matchedText: text,
        });
      });
    });

    test("returns an unsuccessful result for unsupported watching text", () => {
      expect(YouTubeViewerExtractor._parseWatchingText("1.2K watching now")).toEqual({
        success: false,
        count: 0,
        pattern: null,
        matchedText: null,
      });
    });

    test("rejects malformed watching text and separators", () => {
      const malformedTexts = [
        "1.2 watching now",
        "1,23 watching now",
        "1,,234 watching now",
        "1 234 watching now",
        "abc 123 watching now",
        "123 watching now extra",
      ];

      malformedTexts.forEach((text) => {
        expect(YouTubeViewerExtractor._parseWatchingText(text)).toEqual({
          success: false,
          count: 0,
          pattern: null,
          matchedText: null,
        });
      });
    });
  });

  describe("isValidViewerCount", () => {
    test("validates viewer count bounds", () => {
      const cases = [
        { count: 0, expected: true },
        { count: 100, expected: true },
        { count: 10000000, expected: true },
        { count: 10000001, expected: false },
        { count: -1, expected: false },
        { count: 1.5, expected: false },
        { count: NaN, expected: false },
        { count: "1", expected: false },
      ];

      cases.forEach(({ count, expected }) => {
        expect(YouTubeViewerExtractor.isValidViewerCount(count)).toBe(expected);
      });
    });
  });

  describe("getCapabilities", () => {
    test("describes available extraction capabilities", () => {
      expect(YouTubeViewerExtractor.getCapabilities()).toEqual({
        version: "1.0.0",
        strategies: ["view_text", "video_details", "basic_info"],
        patterns: [
          "watching_now",
          "watching",
          "currently_watching",
          "viewers_watching",
          "people_watching",
        ],
        supports: {
          debug: true,
          fallback: true,
          metadata: true,
        },
      });
    });
  });
});
