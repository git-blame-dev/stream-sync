import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { initializeTestLogging, TEST_TIMEOUTS } from "../../helpers/test-setup";
import {
  createMockFn,
  clearAllMocks,
  restoreAllMocks,
} from "../../helpers/bun-mock-utils";
import type { TestMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { setupAutomatedCleanup } from "../../helpers/mock-lifecycle";
import { expectNoTechnicalArtifacts } from "../../helpers/assertion-helpers";
import { extractTikTokUserData } from "../../../src/utils/tiktok-data-extraction";
import * as testClock from "../../helpers/test-clock";

initializeTestLogging();

type EnvelopeData = Record<string, unknown> & {
  user?: Record<string, unknown>;
  userId?: unknown;
  username?: unknown;
  giftType?: unknown;
  giftCount?: unknown;
  amount?: unknown;
  currency?: unknown;
  repeatCount?: unknown;
  timestamp?: unknown;
  id?: unknown;
  isError?: unknown;
};
type EnvelopeGiftData = Record<string, unknown> & {
  giftType: string;
  giftCount: number;
  amount: number;
  currency: string;
  type: "platform:envelope";
  userId: string;
  timestamp: unknown;
  originalEnvelopeData: EnvelopeData;
};
type GiftHandlerResult = {
  id: string;
  type: string;
  platform: string;
  username: string;
  displayMessage: string;
  ttsMessage: string;
  logMessage: string;
  processedAt: number;
  timestamp: string;
  data: EnvelopeGiftData;
};
type GiftHandler = TestMockFn<
  [platform: string, username: string, giftData: EnvelopeGiftData],
  Promise<GiftHandlerResult>
>;
type TestLogger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};
type CanonicalIdentity = {
  userId?: string;
  username?: string;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const expectDefined = <T>(value: T | undefined): T => {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error("Expected value to be defined");
  }
  return value;
};

const readStringProperty = (
  record: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
};

const extractEnvelopeIdentity = (
  platform: string,
  envelopeData: EnvelopeData,
): CanonicalIdentity => {
  if (platform === "tiktok") {
    return extractTikTokUserData(envelopeData);
  }

  const identity: CanonicalIdentity = {};
  const userId = readStringProperty(envelopeData, "userId");
  const username = readStringProperty(envelopeData, "username");
  if (userId !== undefined) {
    identity.userId = userId;
  }
  if (username !== undefined) {
    identity.username = username;
  }
  return identity;
};

const createEnvelopeNotificationHandler = (
  mockLogger: TestLogger,
  mockGiftHandler: GiftHandler,
) => {
  return async (platform: string, data: EnvelopeData | null) => {
    try {
      mockLogger.info(
        `[Envelope] Treasure chest event on ${platform}`,
        platform,
      );

      const envelopeData = data ?? {};
      const identity = extractEnvelopeIdentity(platform, envelopeData);

      if (!identity.userId || !identity.username) {
        mockLogger.warn(
          "[Envelope] Missing canonical identity in envelope data",
          platform,
          { data: envelopeData },
        );
        return;
      }

      const isError = envelopeData.isError === true;
      const giftType =
        typeof envelopeData.giftType === "string" ? envelopeData.giftType.trim() : "";
      const giftCount = Number(envelopeData.giftCount);
      const amount = Number(envelopeData.amount);
      const currency =
        typeof envelopeData.currency === "string" ? envelopeData.currency.trim() : "";
      const repeatCount =
        envelopeData.repeatCount === undefined ? 1 : envelopeData.repeatCount;

      if (
        !giftType ||
        !Number.isFinite(giftCount) ||
        giftCount < 0 ||
        !Number.isFinite(amount) ||
        amount < 0 ||
        !currency ||
        !envelopeData.timestamp
      ) {
        throw new Error(
          "Envelope notification requires giftType, giftCount, amount, currency, timestamp, and id",
        );
      }

      if (!isError && (giftCount <= 0 || amount <= 0 || !envelopeData.id)) {
        throw new Error(
          "Envelope notification requires giftType, giftCount, amount, currency, timestamp, and id",
        );
      }

      const giftData = {
        giftType,
        giftCount,
        amount,
        currency,
        repeatCount,
        type: "platform:envelope",
        userId: identity.userId,
        timestamp: envelopeData.timestamp,
        ...(envelopeData.id ? { id: envelopeData.id } : {}),
        ...(isError ? { isError: true } : {}),
        originalEnvelopeData: envelopeData,
      } satisfies EnvelopeGiftData;

      await mockGiftHandler(platform, identity.username, giftData);
    } catch (error) {
      mockLogger.error(
        `Error handling envelope notification: ${getErrorMessage(error)}`,
        platform,
        error,
      );
    }
  };
};

describe("TikTok Envelope Notification - Behavior Testing", () => {
  let mockLogger: typeof noOpLogger;
  let handleEnvelopeNotification: (
    platform: string,
    data: EnvelopeData | null,
  ) => Promise<void>;
  let mockGiftHandler: GiftHandler;
  let capturedGiftCalls: Array<{
    platform: string;
    username: string;
    giftData: EnvelopeGiftData;
    timestamp: number;
  }>;
  let capturedGiftResults: GiftHandlerResult[];

  setupAutomatedCleanup();

  beforeEach(() => {
    mockLogger = noOpLogger;

    capturedGiftCalls = [];
    capturedGiftResults = [];

    mockGiftHandler = createMockFn(
      async (platform: string, username: string, giftData: EnvelopeGiftData) => {
        const call = {
          platform,
          username,
          giftData,
          timestamp: testClock.now(),
        };
        capturedGiftCalls.push(call);

        const result = {
          id: "test-notification-id",
          type: "platform:envelope",
          platform,
          username,
          displayMessage: `${username} sent a Treasure Chest`,
          ttsMessage: `${username} sent a treasure chest`,
          logMessage: `[Gift] ${username} sent Treasure Chest`,
          processedAt: testClock.now(),
          timestamp: new Date(testClock.now()).toISOString(),
          data: giftData,
        };
        capturedGiftResults.push(result);
        return result;
      },
    );

    handleEnvelopeNotification = createEnvelopeNotificationHandler(
      mockLogger,
      mockGiftHandler,
    );
  });

  afterEach(() => {
    clearAllMocks();
    restoreAllMocks();
    capturedGiftCalls = [];
    capturedGiftResults = [];
  });

  const getLatestGiftCall = () =>
    expectDefined(capturedGiftCalls[capturedGiftCalls.length - 1]);

  const getLatestGiftResult = () =>
    expectDefined(capturedGiftResults[capturedGiftResults.length - 1]);

  const expectGiftCallBehavior = (
    expectedPlatform: string,
    expectedUsername: string,
    expectedGiftData: Partial<EnvelopeGiftData>,
  ) => {
    const latestCall = getLatestGiftCall();
    expect(latestCall.platform).toBe(expectedPlatform);
    expect(latestCall.username).toBe(expectedUsername);
    expect(latestCall.giftData).toMatchObject(expectedGiftData);
  };

  const createEnvelopeData = (overrides: Partial<EnvelopeData> = {}) => ({
    user: {
      uniqueId: "testUserEnvelope",
      nickname: "TestEnvelopeDisplay",
      userId: "test_user_id_envelope",
    },
    giftType: "Treasure Chest",
    giftCount: 1,
    amount: 500,
    currency: "coins",
    id: "envelope-test-id",
    timestamp: new Date(testClock.now()).toISOString(),
    ...overrides,
  });

  describe("Complete Data Structure Processing", () => {
    test(
      "should process envelope with complete data (identity + gift fields)",
      async () => {
        const completeEnvelopeData = createEnvelopeData({
          user: {
            uniqueId: "testUserEnvelopeComplete",
            nickname: "TestEnvelopeDisplay",
            userId: "test_user_id_envelope_complete",
          },
          amount: 500,
        });

        await handleEnvelopeNotification("tiktok", completeEnvelopeData);

        expect(capturedGiftCalls).toHaveLength(1);
        expectGiftCallBehavior("tiktok", "TestEnvelopeDisplay", {
          giftType: "Treasure Chest",
          giftCount: 1,
          amount: 500,
          currency: "coins",
          type: "platform:envelope",
          id: completeEnvelopeData.id,
          timestamp: completeEnvelopeData.timestamp,
          originalEnvelopeData: completeEnvelopeData,
        });

        const result = getLatestGiftResult();
        expectNoTechnicalArtifacts(result.displayMessage);
        expectNoTechnicalArtifacts(result.ttsMessage);
        expect(result.displayMessage).toContain("TestEnvelopeDisplay");
        expect(result.displayMessage).toContain("Treasure Chest");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should use nickname as username when available",
      async () => {
        const envelopeData = createEnvelopeData({
          user: {
            uniqueId: "testUserUnique",
            nickname: "TestDisplayName",
            userId: "test_user_id_unique",
          },
          amount: 250,
        });

        await handleEnvelopeNotification("tiktok", envelopeData);

        expectGiftCallBehavior("tiktok", "TestDisplayName", {
          giftType: "Treasure Chest",
          amount: 250,
          currency: "coins",
        });
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Partial Data Scenario Handling", () => {
    test(
      "should skip when amount is missing",
      async () => {
        const missingAmountData = createEnvelopeData({
          user: {
            uniqueId: "testUserMissingAmount",
            nickname: "TestUserNoAmount",
            userId: "test_user_id_missing_amount",
          },
          amount: undefined,
        });

        await handleEnvelopeNotification("tiktok", missingAmountData);

        expect(capturedGiftCalls).toHaveLength(0);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should skip when nickname is missing",
      async () => {
        const missingNicknameData = createEnvelopeData({
          user: {
            uniqueId: "testUserFallback",
            userId: "test_user_id_fallback",
          },
          amount: 750,
        });

        await handleEnvelopeNotification("tiktok", missingNicknameData);

        expect(capturedGiftCalls).toHaveLength(0);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should skip when uniqueId is missing",
      async () => {
        const minimalData = createEnvelopeData({
          user: {
            userId: "test_user_id_minimal",
          },
          amount: 100,
        });

        await handleEnvelopeNotification("tiktok", minimalData);

        expect(capturedGiftCalls).toHaveLength(0);
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Nested User Object Format Support", () => {
    test(
      "should process envelope notifications with nested user payloads",
      async () => {
        const nestedUserData = createEnvelopeData({
          user: {
            uniqueId: "testUserNestedEnvelope",
            nickname: "TestNestedEnvelope",
            userId: "test_user_id_envelope_nested",
          },
          amount: 300,
          timestamp: new Date(testClock.now()).toISOString(),
        });

        await handleEnvelopeNotification("tiktok", nestedUserData);

        expect(capturedGiftCalls).toHaveLength(1);
        expectGiftCallBehavior("tiktok", "TestNestedEnvelope", {
          giftType: "Treasure Chest",
          giftCount: 1,
          amount: 300,
          currency: "coins",
          type: "platform:envelope",
          id: nestedUserData.id,
          timestamp: nestedUserData.timestamp,
          originalEnvelopeData: nestedUserData,
        });
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Amount Field Support", () => {
    test(
      "should use amount and currency fields for envelope notifications",
      async () => {
        const amountFieldData = createEnvelopeData({
          user: {
            uniqueId: "testUserAmount",
            nickname: "TestUserAmount",
            userId: "test_user_id_amount",
          },
          amount: 500,
          currency: "coins",
        });

        await handleEnvelopeNotification("tiktok", amountFieldData);

        expectGiftCallBehavior("tiktok", "TestUserAmount", {
          giftType: "Treasure Chest",
          amount: 500,
          currency: "coins",
        });
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should accept numeric string amounts",
      async () => {
        const stringAmountData = createEnvelopeData({
          user: {
            uniqueId: "testUserStringAmount",
            nickname: "TestUserStringAmount",
            userId: "test_user_id_string_amount",
          },
          amount: "250",
          currency: "coins",
        });

        await handleEnvelopeNotification("tiktok", stringAmountData);

        expectGiftCallBehavior("tiktok", "TestUserStringAmount", {
          giftType: "Treasure Chest",
          amount: 250,
          currency: "coins",
        });
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should skip when currency is missing",
      async () => {
        const missingCurrencyData = createEnvelopeData({
          user: {
            uniqueId: "testUserMissingCurrency",
            nickname: "TestUserMissingCurrency",
            userId: "test_user_id_missing_currency",
          },
          currency: "",
        });

        await handleEnvelopeNotification("tiktok", missingCurrencyData);

        expect(capturedGiftCalls).toHaveLength(0);
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Missing Identity Behavior", () => {
    test(
      "should skip envelope notifications without identity fields",
      async () => {
        const emptyUserData = {
          giftType: "Treasure Chest",
          giftCount: 1,
          amount: 200,
          currency: "coins",
          id: "envelope-empty-user-id",
          timestamp: new Date(testClock.now()).toISOString(),
        };

        await handleEnvelopeNotification("tiktok", emptyUserData);

        expect(capturedGiftCalls).toHaveLength(0);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should skip when identity fields are empty strings",
      async () => {
        const emptyStringUserData = {
          user: {
            uniqueId: "",
            userId: "",
            nickname: "",
          },
          giftType: "Treasure Chest",
          giftCount: 1,
          amount: 350,
          currency: "coins",
          id: "envelope-empty-strings",
          timestamp: new Date(testClock.now()).toISOString(),
        };

        await handleEnvelopeNotification("tiktok", emptyStringUserData);

        expect(capturedGiftCalls).toHaveLength(0);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should skip when identity fields are null/undefined",
      async () => {
        const nullUserData = {
          user: {
            uniqueId: null,
            nickname: undefined,
            userId: null,
          },
          giftType: "Treasure Chest",
          giftCount: 1,
          amount: 450,
          currency: "coins",
          id: "envelope-null-user",
          timestamp: new Date(testClock.now()).toISOString(),
        };

        await handleEnvelopeNotification("tiktok", nullUserData);

        expect(capturedGiftCalls).toHaveLength(0);
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Notification String Generation for Envelope Type", () => {
    test(
      "should generate proper gift data structure for handleGiftNotification",
      async () => {
        const envelopeData = createEnvelopeData({
          user: {
            uniqueId: "testUserEnvelope",
            nickname: "TestUserEnvelope",
            userId: "test_user_id_envelope",
          },
          amount: 600,
        });

        await handleEnvelopeNotification("tiktok", envelopeData);

        const latestCall = getLatestGiftCall();
        const giftData = latestCall.giftData;

        expect(giftData.giftType).toBe("Treasure Chest");
        expect(giftData.giftCount).toBe(1);
        expect(giftData.amount).toBe(600);
        expect(giftData.currency).toBe("coins");
        expect(giftData.type).toBe("platform:envelope");

        expect(giftData.userId).toBe("testUserEnvelope");
        expect(giftData.timestamp).toBeDefined();
        expect(giftData.originalEnvelopeData).toEqual(envelopeData);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should preserve original envelope data for platform-specific processing",
      async () => {
        const complexEnvelopeData = createEnvelopeData({
          user: {
            uniqueId: "testUserComplex",
            nickname: "TestUserComplex",
            userId: "test_user_id_complex",
          },
          amount: 800,
          eventId: "test_event_456",
          platformSpecificField: "test_custom_data",
        });

        await handleEnvelopeNotification("tiktok", complexEnvelopeData);

        const latestCall = getLatestGiftCall();
        const giftData = latestCall.giftData;
        expect(giftData.originalEnvelopeData).toEqual(complexEnvelopeData);
        expect(giftData.originalEnvelopeData.platformSpecificField).toBe(
          "test_custom_data",
        );

        const result = getLatestGiftResult();
        expectNoTechnicalArtifacts(result.displayMessage);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should use provided userId when available in envelope data",
      async () => {
        const envelopeWithId = createEnvelopeData({
          user: {
            uniqueId: "testUserWithId",
            nickname: "TestUserWithId",
            userId: "test_user_id_existing",
          },
          amount: 400,
        });

        await handleEnvelopeNotification("tiktok", envelopeWithId);

        const latestCall = getLatestGiftCall();
        const giftData = latestCall.giftData;
        expect(giftData.userId).toBe("testUserWithId");
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Error Handling and Edge Cases", () => {
    test(
      "allows error envelopes without ids to reach gift handler",
      async () => {
        const errorEnvelope = createEnvelopeData({
          id: undefined,
          giftCount: 0,
          amount: 0,
          isError: true,
        });

        await handleEnvelopeNotification("tiktok", errorEnvelope);

        expect(capturedGiftCalls).toHaveLength(1);
        const latestCall = getLatestGiftCall();
        const giftData = latestCall.giftData;
        expect(giftData.isError).toBe(true);
        expect(giftData.giftCount).toBe(0);
        expect(giftData.amount).toBe(0);
        expect(giftData).not.toHaveProperty("id");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should handle null envelope data gracefully",
      async () => {
        await handleEnvelopeNotification("tiktok", null);

        expect(capturedGiftCalls).toHaveLength(0);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should handle empty envelope data object",
      async () => {
        await handleEnvelopeNotification("tiktok", {});

        expect(capturedGiftCalls).toHaveLength(0);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should reject non-numeric amounts",
      async () => {
        const invalidAmountData = createEnvelopeData({
          user: {
            uniqueId: "testUserInvalidAmount",
            nickname: "InvalidTestUserAmount",
            userId: "test_user_id_invalid_amount",
          },
          amount: "not_a_number",
        });

        await handleEnvelopeNotification("tiktok", invalidAmountData);

        expect(capturedGiftCalls).toHaveLength(0);
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Delegation to Gift Notification Handler", () => {
    test(
      "should properly delegate to handleGiftNotification with correct parameters",
      async () => {
        const envelopeData = createEnvelopeData({
          user: {
            uniqueId: "testUserDelegation",
            nickname: "TestUserDelegation",
            userId: "test_user_id_delegation",
          },
          amount: 700,
        });

        await handleEnvelopeNotification("tiktok", envelopeData);

        expect(capturedGiftCalls).toHaveLength(1);
        const giftCall = getLatestGiftCall();
        expect(giftCall.platform).toBe("tiktok");
        expect(giftCall.username).toBe("TestUserDelegation");
        expect(giftCall.giftData).toMatchObject({
          giftType: "Treasure Chest",
          giftCount: 1,
          amount: 700,
          currency: "coins",
          type: "platform:envelope",
          id: envelopeData.id,
          timestamp: envelopeData.timestamp,
          originalEnvelopeData: envelopeData,
        });
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should maintain envelope type designation through gift processing",
      async () => {
        const envelopeData = createEnvelopeData({
          user: {
            uniqueId: "testUserType",
            nickname: "TestUserType",
            userId: "test_user_id_type",
          },
          amount: 350,
        });

        await handleEnvelopeNotification("tiktok", envelopeData);

        const latestCall = getLatestGiftCall();
        const giftData = latestCall.giftData;
        expect(giftData.type).toBe("platform:envelope");

        expect(giftData.giftType).toBe("Treasure Chest");
        expect(giftData.giftCount).toBe(1);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should pass through all necessary data for comprehensive gift processing",
      async () => {
        const richEnvelopeData = createEnvelopeData({
          user: {
            uniqueId: "testUserRich",
            nickname: "TestUserRich",
            userId: "test_user_id_rich",
          },
          amount: 1000,
          additionalData: "test_extra_info",
        });

        await handleEnvelopeNotification("tiktok", richEnvelopeData);

        const latestCall = getLatestGiftCall();
        const giftData = latestCall.giftData;
        expect(giftData.userId).toBe("testUserRich");
        expect(giftData.timestamp).toBeDefined();
        expect(giftData.originalEnvelopeData).toEqual(richEnvelopeData);
        expect(giftData.originalEnvelopeData.additionalData).toBe(
          "test_extra_info",
        );

        const result = getLatestGiftResult();
        expectNoTechnicalArtifacts(result.displayMessage);
        expect(result.displayMessage).toContain("TestUserRich");
      },
      TEST_TIMEOUTS.FAST,
    );
  });
});
