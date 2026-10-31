import { describe, expect, afterEach, it } from "bun:test";
import { restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import {
  useFakeTimers,
  useRealTimers,
  advanceTimersByTime,
} from "../../helpers/bun-timers";
import {
  createSpamDetectionConfig,
  createDonationSpamDetection,
} from "../../../src/utils/spam-detection";
import { createRecordingLogger } from "../../helpers/recording-logger";
type DonationSpamDetection = ReturnType<typeof createDonationSpamDetection>;

describe("SpamDetection behavior", () => {
  let detection: DonationSpamDetection | null = null;

  it("keeps empty cleanup quiet while preserving subsequent admissions", () => {
    const logger = createRecordingLogger();
    detection = createDonationSpamDetection(createSpamDetectionConfig({
      enabled: true, lowValueThreshold: 5, detectionWindow: 1, maxIndividualNotifications: 1
    }, { logger }), { logger, autoCleanup: false });
    logger.entries.length = 0;
    detection.cleanupSpamDetection();
    detection.cleanupSpamDetection();
    expect(logger.entries).toEqual([]);
    expect(detection.handleDonationSpam("test-donor", "Test Donor", 3, "Test Gift", 1, "tiktok").shouldShow).toBe(true);
  });

  it("does not include a fail-open admission in residuals and can schedule after an empty flush", () => {
    useFakeTimers();
    let failSuppression = true;
    const summaries: number[] = [];
    detection = createDonationSpamDetection(createSpamDetectionConfig({
      enabled: true, lowValueThreshold: 5, detectionWindow: 1, maxIndividualNotifications: 0
    }, { logger: noOpLogger }), {
      logger: { ...noOpLogger, info: message => {
        if (failSuppression && message.includes("Suppressing individual")) throw new Error("test diagnostic failure");
      } },
      autoCleanup: false,
      onAggregatedDonation: summary => { summaries.push(summary.totalCoins); }
    });
    expect(detection.handleDonationSpam("test-donor", "Test Donor", 5, "Rose", 1, "tiktok").shouldShow).toBe(true);
    advanceTimersByTime(1000);
    expect(summaries).toEqual([]);
    failSuppression = false;
    expect(detection.handleDonationSpam("test-donor", "Test Donor", 3, "Rose", 1, "tiktok").shouldShow).toBe(false);
    advanceTimersByTime(1000);
    expect(summaries).toEqual([3]);
  });

  it("retains a failed currency group without replaying an already emitted group", () => {
    useFakeTimers();
    let failSecond = true;
    const summaries: number[] = [];
    detection = createDonationSpamDetection(createSpamDetectionConfig({
      enabled: true, lowValueThreshold: 5, detectionWindow: 1, maxIndividualNotifications: 0
    }, { logger: noOpLogger }), {
      logger: noOpLogger, autoCleanup: false,
      onAggregatedDonation: summary => {
        if (summary.currency === "EUR" && failSecond) throw new Error("test callback failure");
        summaries.push(summary.totalCoins);
      }
    });
    const send = (amount: number, currency: string) => detection!.handleDonationSpam(
      "test-donor", "Test Donor", amount, "Test Gift", 1, "youtube", {
        amount, currency, contribution: { platform: "youtube", type: "platform:gift", data: { amount, currency } }
      }
    );
    send(2, "USD");
    send(3, "EUR");
    advanceTimersByTime(1000);
    expect(summaries).toEqual([2]);
    detection.cleanupSpamDetection(true);
    failSecond = false;
    send(1, "EUR");
    advanceTimersByTime(1000);
    expect(summaries).toEqual([2, 4]);
  });

  it("retires admission and timers idempotently despite failed cleanup diagnostics", () => {
    useFakeTimers();
    let retired = false;
    let publications = 0;
    const config = createSpamDetectionConfig({
      enabled: true,
      lowValueThreshold: 10,
      detectionWindow: 1,
      maxIndividualNotifications: 0,
    }, { logger: noOpLogger });
    detection = createDonationSpamDetection(config, {
      logger: { ...noOpLogger, debug: () => {
        if (retired) throw new Error("test cleanup diagnostic failure");
      } },
      onAggregatedDonation: () => { publications++; },
    });
    detection.handleDonationSpam("test-donor", "Test Donor", 1, "test-gift", 1, "tiktok");
    retired = true;
    expect(() => detection?.destroy()).not.toThrow();
    expect(() => detection?.destroy()).not.toThrow();
    expect(detection.handleDonationSpam("test-late-donor", "Test Late Donor", 1, "test-gift", 1, "tiktok").shouldShow).toBe(false);
    detection.setupPeriodicCleanup();
    advanceTimersByTime(60_000);
    expect(publications).toBe(0);
    expect(detection.cleanupInterval).toBeNull();
    expect(detection.getStatistics().trackedUsers).toBe(0);
  });

  afterEach(() => {
    restoreAllMocks();
    if (detection) {
      detection.destroy();
      detection = null;
    }
    useRealTimers();
  });

  it("gracefully allows when spam detection disabled", () => {
    const config = createSpamDetectionConfig(
      {
        enabled: false,
        lowValueThreshold: 10,
        detectionWindow: 5,
        maxIndividualNotifications: 2,
      },
      { logger: noOpLogger },
    );
    detection = createDonationSpamDetection(config, {
      logger: noOpLogger,
      autoCleanup: false,
    });

    const result = detection.handleDonationSpam(
      "u",
      "User",
      1,
      "Rose",
      1,
      "tiktok",
    );
    expect(result.shouldShow).toBe(true);
  });

  it("suppresses notifications after threshold and resets after window", () => {
    useFakeTimers();
    const config = createSpamDetectionConfig(
      {
        enabled: true,
        detectionWindow: 0.2,
        maxIndividualNotifications: 1,
        lowValueThreshold: 10,
      },
      { logger: noOpLogger },
    );
    detection = createDonationSpamDetection(config, {
      logger: noOpLogger,
      autoCleanup: false,
    });

    expect(
      detection.handleDonationSpam("u", "User", 1, "Rose", 1, "tiktok")
        .shouldShow,
    ).toBe(true);
    expect(
      detection.handleDonationSpam("u", "User", 1, "Rose", 1, "tiktok")
        .shouldShow,
    ).toBe(false);

    advanceTimersByTime(250);
    expect(
      detection.handleDonationSpam("u", "User", 1, "Rose", 1, "tiktok")
        .shouldShow,
    ).toBe(true);
  });

  it("treats high-value donations as non-spam", () => {
    const config = createSpamDetectionConfig(
      {
        enabled: true,
        lowValueThreshold: 5,
        detectionWindow: 5,
        maxIndividualNotifications: 1,
      },
      { logger: noOpLogger },
    );
    detection = createDonationSpamDetection(config, {
      logger: noOpLogger,
      autoCleanup: false,
    });

    const result = detection.handleDonationSpam(
      "u",
      "User",
      20,
      "Lion",
      1,
      "tiktok",
    );
    expect(result.shouldShow).toBe(true);
  });

  it("applies same threshold across all platforms", () => {
    const config = createSpamDetectionConfig(
      {
        enabled: true,
        lowValueThreshold: 10,
        detectionWindow: 5,
        maxIndividualNotifications: 1,
      },
      { logger: noOpLogger },
    );
    detection = createDonationSpamDetection(config, {
      logger: noOpLogger,
      autoCleanup: false,
    });

    const ytFirst = detection.handleDonationSpam(
      "yt",
      "YTUser",
      5,
      "Super Chat",
      1,
      "youtube",
    );
    const ytSecond = detection.handleDonationSpam(
      "yt",
      "YTUser",
      5,
      "Super Chat",
      1,
      "youtube",
    );
    const tkFirst = detection.handleDonationSpam(
      "tk",
      "TKUser",
      5,
      "Rose",
      1,
      "tiktok",
    );
    const tkSecond = detection.handleDonationSpam(
      "tk",
      "TKUser",
      5,
      "Rose",
      1,
      "tiktok",
    );

    expect(ytFirst.shouldShow).toBe(true);
    expect(ytSecond.shouldShow).toBe(false);
    expect(tkFirst.shouldShow).toBe(true);
    expect(tkSecond.shouldShow).toBe(false);
  });

  it("falls back to global config for unknown platform lookups", () => {
    const config = createSpamDetectionConfig(
      {
        enabled: true,
        lowValueThreshold: 5,
        detectionWindow: 2,
        maxIndividualNotifications: 1,
      },
      { logger: noOpLogger },
    );

    const fallback = config.getPlatformConfig("unknown");

    expect(fallback.enabled).toBe(true);
    expect(fallback.lowValueThreshold).toBe(5);
    expect(fallback.detectionWindow).toBe(2);
    expect(fallback.maxIndividualNotifications).toBe(1);
  });
});
