import { describe, it, expect } from "bun:test";
import { SelfMessageDetectionService } from "../../../src/services/SelfMessageDetectionService.ts";

const createPlainConfig = ({ general = {}, twitch, youtube, tiktok } = {}) => {
  return {
    general,
    twitch,
    youtube,
    tiktok,
  };
};

describe("SelfMessageDetectionService", () => {
  describe("isFilteringEnabled", () => {
    it("uses platform override when provided", () => {
      const config = createPlainConfig({
        general: { ignoreSelfMessages: false },
        twitch: { ignoreSelfMessages: true },
        youtube: { ignoreSelfMessages: false },
      });
      const service = new SelfMessageDetectionService(config);

      expect(service.isFilteringEnabled("twitch")).toBe(true);
      expect(service.isFilteringEnabled("youtube")).toBe(false);
    });

    it("returns resolved value from platform config", () => {
      const config = createPlainConfig({
        general: { ignoreSelfMessages: true },
        tiktok: { ignoreSelfMessages: true },
      });
      const service = new SelfMessageDetectionService(config);

      expect(service.isFilteringEnabled("tiktok")).toBe(true);
    });
  });

  describe("isSelfMessage", () => {
    it("detects Twitch self messages by explicit flag or username match", () => {
      const service = new SelfMessageDetectionService(createPlainConfig());
      const platformConfig = { username: "Streamer" };

      expect(
        service.isSelfMessage("twitch", { self: true }, platformConfig),
      ).toBe(true);
      expect(
        service.isSelfMessage(
          "twitch",
          { username: "streamer" },
          platformConfig,
        ),
      ).toBe(true);
      expect(
        service.isSelfMessage(
          "twitch",
          { context: { username: "Streamer" } },
          platformConfig,
        ),
      ).toBe(true);
      expect(
        service.isSelfMessage("twitch", { username: "Viewer" }, platformConfig),
      ).toBe(false);
    });

    it("detects YouTube self messages via broadcaster indicators", () => {
      const service = new SelfMessageDetectionService(createPlainConfig());
      const platformConfig = { username: "ChannelOwner" };

      expect(
        service.isSelfMessage(
          "youtube",
          { username: "channelowner" },
          platformConfig,
        ),
      ).toBe(true);
      expect(
        service.isSelfMessage(
          "youtube",
          { isBroadcaster: true },
          platformConfig,
        ),
      ).toBe(true);
      expect(
        service.isSelfMessage(
          "youtube",
          { author: { isChatOwner: true } },
          platformConfig,
        ),
      ).toBe(true);
      expect(
        service.isSelfMessage("youtube", { badges: ["Owner"] }, platformConfig),
      ).toBe(true);
      expect(
        service.isSelfMessage(
          "youtube",
          { username: "Viewer" },
          platformConfig,
        ),
      ).toBe(false);
    });

    it("detects TikTok self messages via username or userId match", () => {
      const service = new SelfMessageDetectionService(createPlainConfig());
      const platformConfig = { username: "Creator", userId: "tt-streamer-1" };

      expect(
        service.isSelfMessage(
          "tiktok",
          { username: "creator" },
          platformConfig,
        ),
      ).toBe(true);
      expect(
        service.isSelfMessage(
          "tiktok",
          { userId: "tt-streamer-1" },
          platformConfig,
        ),
      ).toBe(true);
      expect(
        service.isSelfMessage("tiktok", { username: "Viewer" }, platformConfig),
      ).toBe(false);
    });

    it("returns false for null messageData", () => {
      const service = new SelfMessageDetectionService(createPlainConfig());
      expect(
        service.isSelfMessage("twitch", null, { username: "Streamer" }),
      ).toBe(false);
    });
  });

  describe("shouldFilterMessage", () => {
    it("returns false when filtering disabled even if self message", () => {
      const config = createPlainConfig({
        general: { ignoreSelfMessages: false },
        twitch: { ignoreSelfMessages: false },
      });
      const service = new SelfMessageDetectionService(config);

      expect(
        service.shouldFilterMessage(
          "twitch",
          { self: true },
          { username: "Streamer" },
        ),
      ).toBe(false);
    });

    it("filters self messages when enabled", () => {
      const config = createPlainConfig({
        general: { ignoreSelfMessages: true },
        twitch: { ignoreSelfMessages: true },
      });
      const service = new SelfMessageDetectionService(config);

      expect(
        service.shouldFilterMessage(
          "twitch",
          { self: true },
          { username: "Streamer" },
        ),
      ).toBe(true);
    });
  });
});
