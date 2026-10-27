import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TikTokPlatform } from "../../../src/platforms/tiktok";
import { RetrySystem } from "../../../src/utils/retry-system";
import { createMockTikTokPlatformDependencies, noOpLogger } from "../../helpers/mock-factories";
import { useFakeTimers, useRealTimers } from "../../helpers/bun-timers";

describe("TikTok sustained recovery backoff", () => {
  let retry: RetrySystem;
  let platform: TikTokPlatform;
  let elapsed: number;

  beforeEach(() => {
    useFakeTimers();
    elapsed = 0;
    retry = new RetrySystem({ logger: noOpLogger });
    platform = new TikTokPlatform({ enabled: true, username: "synthetic-streamer" }, {
      ...createMockTikTokPlatformDependencies(),
      logger: noOpLogger,
      WebcastEvent: { CHAT: "chat", GIFT: "gift", FOLLOW: "follow", SOCIAL: "social", ROOM_USER: "roomUser", ERROR: "error", DISCONNECT: "disconnected", STREAM_END: "streamEnd" },
      ControlEvent: { CONNECTED: "connected", DISCONNECTED: "disconnected", ERROR: "error" },
      monotonicNow: () => elapsed,
      retrySystem: {
        resetRetryCount: retry.resetRetryCount.bind(retry),
        handleConnectionError: retry.handleConnectionError.bind(retry),
        cancelConnectionRetry: retry.cancelConnectionRetry.bind(retry),
      },
    });
  });

  afterEach(async () => {
    await platform.cleanup();
    retry.dispose();
    useRealTimers();
  });

  test("retains accumulated failures across brief confirmed connections and cleanup", async () => {
    retry.incrementRetryCount("tiktok");
    await platform.handleConnectionSuccess();
    expect(retry.getRetryCount("tiktok")).toBe(1);
    elapsed += 1000;
    await platform.handleConnectionIssue({ code: 1011, reason: "Synthetic upstream failure" });
    expect(retry.getRetryCount("tiktok")).toBe(2);

  });

  test("resets backoff after a full minute of confirmed connection", async () => {
    retry.incrementRetryCount("tiktok");
    retry.incrementRetryCount("tiktok");
    await platform.handleConnectionSuccess();
    elapsed += 60000;
    await platform.handleConnectionIssue({ code: 1011, reason: "Synthetic upstream failure" });
    expect(retry.getRetryCount("tiktok")).toBe(1);
  });

  test.each([4400, 4401, 4403])("does not schedule retries for terminal provider code %i", async code => {
    const result = await platform.handleConnectionIssue({ code, reason: "Synthetic provider failure" });
    expect(result.retryResult).toMatchObject({ queued: false, reason: "terminal-error" });
    expect(retry.getRetryCount("tiktok")).toBe(0);
  });

  test.each([4400, 4401, 4403])("retains terminal code %i when supplied as an Error", code => {
    const result = platform.handleRetry(Object.assign(new Error("Synthetic provider failure"), { code }));
    expect(result).toMatchObject({ action: "skipped", reason: "non-recoverable" });
    expect(retry.getRetryCount("tiktok")).toBe(0);
  });
});
