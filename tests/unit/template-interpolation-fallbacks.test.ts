import { describe, expect, it } from "bun:test";

import { setupAutomatedCleanup } from "../helpers/mock-lifecycle";
import { createNotificationData } from "../helpers/notification-test-utils";
import { initializeTestLogging } from "../helpers/test-setup";
import { interpolateTemplate } from "../../src/utils/notification-template-interpolator";

initializeTestLogging();

setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true,
});

type InterpolateTemplate = (
  template: string,
  data: Record<string, unknown>,
) => string;
type CreateNotificationData = (
  type: string,
  platform: string,
  userData: Record<string, unknown>,
  eventData: Record<string, unknown>,
  logger?: unknown,
) => unknown;

describe("Template Interpolation Fallbacks", () => {
  const interpolate = interpolateTemplate as InterpolateTemplate;
  const buildNotificationData =
    createNotificationData as CreateNotificationData;

  describe("when template data is missing required fields", () => {
    describe("and username is missing", () => {
      it("should throw when required template values are missing", () => {
        const template = "{username} sent {giftType}";
        const incompleteData = {
          giftType: "Rose",
        };

        const build = () => interpolate(template, incompleteData);

        expect(build).toThrow("Missing template value");
      });
    });

    describe("and gift type is missing", () => {
      it("should throw when required template values are missing", () => {
        const template = "{username} sent {giftType}";
        const incompleteData = {
          username: "TestUser",
        };

        const build = () => interpolate(template, incompleteData);

        expect(build).toThrow("Missing template value");
      });
    });

    describe("and amount/currency fields are missing", () => {
      it("should throw when required template values are missing", () => {
        const template = "{username} sent {formattedAmount}: {message}";
        const incompleteData = {
          username: "SuperChatUser",
          message: "Great stream!",
        };

        const build = () => interpolate(template, incompleteData);

        expect(build).toThrow("Missing template value");
      });
    });

    describe("and all fields are missing", () => {
      it("should throw when required template values are missing", () => {
        const template = "{username} sent {giftType} x {giftCount}";
        const emptyData = {};

        const build = () => interpolate(template, emptyData);

        expect(build).toThrow("Missing template value");
      });
    });
  });

  describe("when createNotificationData has missing fields", () => {
    describe("and YouTube SuperChat data is incomplete", () => {
      it("should throw when required gift fields are missing", () => {
        const incompleteUserData = {
          username: "FallbackUser",
          userId: "UC123456789",
        };
        const incompleteEventData = {
          type: "platform:gift",
          giftType: "Super Chat",
          giftCount: 1,
          message: "Love your content!",
        };

        const build = () =>
          buildNotificationData(
            "platform:gift",
            "youtube",
            incompleteUserData,
            incompleteEventData,
            null,
          );

        expect(build).toThrow();
      });
    });

    describe("and Twitch gift subscription data is incomplete", () => {
      it("should throw when required giftpaypiggy fields are missing", () => {
        const incompleteUserData = {
          username: "TestGifter",
        };
        const incompleteEventData = {
          type: "platform:giftpaypiggy",
        };

        const build = () =>
          buildNotificationData(
            "platform:giftpaypiggy",
            "twitch",
            incompleteUserData,
            incompleteEventData,
            null,
          );

        expect(build).toThrow();
      });
    });

    describe("and TikTok gift data is incomplete", () => {
      it("should throw when required gift fields are missing", () => {
        const incompleteUserData = {
          username: "TikTokUser",
        };
        const incompleteEventData = {
          type: "platform:gift",
        };

        const build = () =>
          buildNotificationData(
            "platform:gift",
            "tiktok",
            incompleteUserData,
            incompleteEventData,
            null,
          );

        expect(build).toThrow();
      });
    });
  });
});
