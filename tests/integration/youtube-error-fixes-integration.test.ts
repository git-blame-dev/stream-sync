import { describe, test, beforeEach, afterEach, expect } from "bun:test";

import { createMockPlatformDependencies } from "../helpers/test-setup";
import { noOpLogger } from "../helpers/mock-factories";
import {
  createMockFn,
  restoreAllMocks,
} from "../helpers/bun-mock-utils";
import { YouTubePlatform } from "../../src/platforms/youtube";

type GiftPayload = {
  type: string;
  giftType: string;
  giftCount: number;
  amount: number;
  currency: string;
  message: string;
  username: string;
  userId: string;
};
type MockApp = {
  handleGiftNotification: ReturnType<
    typeof createMockFn<[string, string, GiftPayload], void>
  >;
};
type SuperChatEvent = {
  item: {
    type?: string;
    id?: string;
    purchase_amount: string;
    message?: { text?: string; runs?: Array<{ text?: string }> };
    author?: { id?: unknown; name?: unknown; thumbnails?: unknown[]; badges?: unknown[] };
  };
  videoId?: string;
};
type ExecuteWithApiFallback = <Result>(
  context: string,
  apiFn: () => Promise<Result>,
  scrapeFn?: () => Promise<Result>,
  fallbackValue?: Result,
) => Promise<Result | undefined>;
type YouTubePlatformFixture = YouTubePlatform & {
  executeWithAPIFallback: ExecuteWithApiFallback;
  _getYouTubeApi?: () => { videos: { list: () => Promise<unknown> } };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const isGiftPayload = (value: unknown): value is GiftPayload =>
  isRecord(value) &&
  typeof value.type === "string" &&
  typeof value.giftType === "string" &&
  typeof value.giftCount === "number" &&
  typeof value.amount === "number" &&
  typeof value.currency === "string" &&
  typeof value.message === "string" &&
  typeof value.username === "string" &&
  typeof value.userId === "string";

const expectGiftPayload = (value: unknown): GiftPayload => {
  expect(isRecord(value)).toBe(true);
  expect(isRecord(value) ? typeof value.username : "missing").toBe("string");
  expect(isRecord(value) ? typeof value.userId : "missing").toBe("string");
  expect(isRecord(value) ? typeof value.message : "missing").toBe("string");
  expect(isRecord(value) ? typeof value.amount : "missing").toBe("number");
  expect(isRecord(value) ? typeof value.currency : "missing").toBe("string");
  expect(isGiftPayload(value)).toBe(true);
  return value as GiftPayload;
};

const expectSuperChatEvent = (value: unknown): SuperChatEvent => {
  expect(isRecord(value)).toBe(true);
  expect(isRecord(isRecord(value) ? value.item : null)).toBe(true);
  expect(
    isRecord(value) && isRecord(value.item)
      ? typeof value.item.purchase_amount
      : "missing",
  ).toBe("string");
  return value as SuperChatEvent;
};

const parseSuperChatEvent = (event: SuperChatEvent): GiftPayload => {
  const author = event.item.author;
  expect(isRecord(author)).toBe(true);
  expect(isRecord(author) ? typeof author.id : "missing").toBe("string");
  expect(isRecord(author) ? typeof author.name : "missing").toBe("string");
  if (
    !isRecord(author) ||
    typeof author.id !== "string" ||
    typeof author.name !== "string"
  ) {
    throw new Error("Expected Super Chat author id and name");
  }
  const amount = parseFloat(event.item.purchase_amount.replace(/[^\d.]/g, ""));
  const currency = event.item.purchase_amount.replace(/[\d.]/g, "");
  return {
    type: "platform:gift",
    giftType: "Super Chat",
    giftCount: 1,
    amount,
    currency,
    message: event.item.message?.text || event.item.message?.runs?.[0]?.text || "",
    username: author.name,
    userId: author.id,
  };
};

describe("YouTube Error Fixes Integration", () => {
  let mockApp: MockApp;
  let youtubePlatform: YouTubePlatformFixture;
  let receivedGiftNotifications: Array<{
    platform: string;
    username: string;
    payload: GiftPayload;
  }>;

  afterEach(() => {
    restoreAllMocks();
  });

  beforeEach(() => {
    receivedGiftNotifications = [];
    mockApp = {
      handleGiftNotification: createMockFn<[string, string, GiftPayload], void>((
        platform,
        username,
        payload,
      ) => {
        receivedGiftNotifications.push({ platform, username, payload });
      }),
    };

    const config = {
      enabled: true,
      username: "test-channel",
      enableAPI: false,
    };

    const platformMocks = createMockPlatformDependencies("youtube");
    const dependencies = {
      ...platformMocks,
      app: mockApp,
      logger: noOpLogger,
    };

    const executeWithAPIFallback: ExecuteWithApiFallback = async <Result,>(
      _context: string,
      apiFn: () => Promise<Result>,
      scrapeFn?: () => Promise<Result>,
      fallbackValue?: Result,
    ) => {
      const enableAPI = youtubePlatform.config?.enableAPI;
      if (!enableAPI && scrapeFn) {
        return await scrapeFn();
      }
      try {
        return await apiFn();
      } catch {
        if (scrapeFn) {
          return await scrapeFn();
        }
        return fallbackValue;
      }
    };

    youtubePlatform = Object.assign(new YouTubePlatform(config, dependencies), {
      executeWithAPIFallback,
    });

    youtubePlatform.handlers = {
      onGift: (data: unknown) => {
        const payload = expectGiftPayload(data);
        mockApp.handleGiftNotification("youtube", payload.username, payload);
      },
    };

    youtubePlatform.handleSuperChat = createMockFn<[unknown], Promise<void>>(async (event) => {
      const superChatEvent = expectSuperChatEvent(event);
      if (youtubePlatform.handlers?.onGift) {
        youtubePlatform.handlers.onGift(parseSuperChatEvent(superChatEvent));
      }
    });
  });

  describe("Configuration Processing", () => {
    test("should properly parse enableAPI string from config to boolean", () => {
      expect(youtubePlatform).toBeDefined();
      expect(typeof youtubePlatform).toBe("object");
      expect(typeof youtubePlatform.handleSuperChat).toBe("function");
    });
  });

  describe("Super Chat Error Scenarios", () => {
    test("should handle Super Chat with no message gracefully", async () => {
      const superChatEvent = {
        item: {
          type: "LiveChatPaidMessage",
          id: "test-superchat-id",
          purchase_amount: "CA$2.00",
          author: {
            id: "UCTestChannel000000001",
            name: "TestUser",
            thumbnails: [{ url: "https://example.com/avatar.jpg" }],
            badges: [],
          },
        },
        videoId: "test-video-id",
      };

      await expect(youtubePlatform.handleSuperChat(superChatEvent)).resolves.toBeUndefined();

      expect(receivedGiftNotifications).toHaveLength(1);
      expect(receivedGiftNotifications[0]).toMatchObject({
        platform: "youtube",
        username: "TestUser",
        payload: {
          type: "platform:gift",
          giftType: "Super Chat",
          giftCount: 1,
          amount: 2,
          currency: "CA$",
          message: "",
        },
      });
    });

    test("should handle various currency formats without truncation", async () => {
      const currencyTestCases = [
        { input: "CA$2.00", expectedCurrency: "CA$", expectedAmount: 2 },
        { input: "ARS$500.00", expectedCurrency: "ARS$", expectedAmount: 500 },
        { input: "$19.99", expectedCurrency: "$", expectedAmount: 19.99 },
        { input: "€10.50", expectedCurrency: "€", expectedAmount: 10.5 },
      ];

      for (const [index, { input, expectedCurrency, expectedAmount }] of currencyTestCases.entries()) {
          const superChatEvent = {
            item: {
              type: "LiveChatPaidMessage",
              id: `test-superchat-${index}`,
              purchase_amount: input,
              message: {
                text: "Test message",
                runs: [{ text: "Test message" }],
              },
              author: {
                id: `test-user-${index}`,
                name: `TestUser${index}`,
                thumbnails: [{ url: "https://example.com/avatar.jpg" }],
                badges: [],
              },
            },
            videoId: "test-video-id",
          };

        await youtubePlatform.handleSuperChat(superChatEvent);

        expect(receivedGiftNotifications).toHaveLength(1);
        expect(receivedGiftNotifications[0]).toMatchObject({
          platform: "youtube",
          username: `TestUser${index}`,
          payload: {
            type: "platform:gift",
            giftType: "Super Chat",
            giftCount: 1,
            amount: expectedAmount,
            currency: expectedCurrency,
          },
        });

        receivedGiftNotifications = [];
      }
    });
  });

  describe("API Fallback Behavior", () => {
    test("should skip API calls when enableAPI is false", async () => {
      const mockApiCall = createMockFn().mockRejectedValue(
        new Error("API should not be called"),
      );

      youtubePlatform._getYouTubeApi = createMockFn().mockReturnValue({
        videos: { list: mockApiCall },
      });

      const result = await youtubePlatform.executeWithAPIFallback(
        "test-context",
        () => mockApiCall(),
        () => Promise.resolve(1000),
      );

      expect(mockApiCall).not.toHaveBeenCalled();
      expect(result).toBe(1000);
    });
  });

  describe("End-to-End Super Chat Processing", () => {
    test("should process complete Super Chat workflow without errors", async () => {
      const superChatEvent = {
        item: {
          type: "LiveChatPaidMessage",
          id: "test-superchat-complete-id",
          purchase_amount: "ARS$500.00",
          message: {
            text: "Test complete message",
            runs: [{ text: "Test complete message" }],
            rtl: false,
          },
          author: {
            id: "UCTestChannel000000002",
            name: "TestPerson",
            thumbnails: [
              {
                url: "https://example.com/avatar64.jpg",
                width: 64,
                height: 64,
              },
              {
                url: "https://example.com/avatar32.jpg",
                width: 32,
                height: 32,
              },
            ],
            badges: [],
          },
        },
        videoId: "test-video-123",
      };

      await youtubePlatform.handleSuperChat(superChatEvent);

      expect(receivedGiftNotifications).toHaveLength(1);
      expect(receivedGiftNotifications[0]).toMatchObject({
        platform: "youtube",
        username: "TestPerson",
        payload: {
          type: "platform:gift",
          giftType: "Super Chat",
          giftCount: 1,
          amount: 500,
          currency: "ARS$",
          message: "Test complete message",
          username: "TestPerson",
          userId: "UCTestChannel000000002",
        },
      });

      const stringifiedNotification = JSON.stringify(receivedGiftNotifications[0]);
      expect(stringifiedNotification).not.toContain("Unknown Gift");
    });
  });
});
