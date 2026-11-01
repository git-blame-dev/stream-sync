import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "path";
import { createLogger } from "../../../src/core/logging";
import { RawPlatformDataLoggingService } from "../../../src/services/RawPlatformDataLoggingService.ts";

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  expect(value).toBeDefined();
  if (value === null || typeof value !== "object") {
    throw new Error(`Expected ${label} to be an object`);
  }
  return Object.fromEntries(Object.entries(value));
};

describe("RawPlatformDataLoggingService behavior", () => {
  let service: RawPlatformDataLoggingService;
  let logDir: string;

  beforeEach(async () => {
    logDir = await fs.mkdtemp(path.join(os.tmpdir(), "raw-platform-data-logging-test-"));
    service = new RawPlatformDataLoggingService({ config: { dataLoggingPath: logDir } });
  });

  afterEach(async () => {
    await fs.rm(logDir, { recursive: true, force: true });
  });

  describe("User-Observable Platform Logging Behavior", () => {
    it("writes each platform payload to its configured directory", async () => {
      const chatData = { username: "TestUser", message: "Hello stream!" };

      await service.logRawPlatformData("twitch", "chat", chatData, {
        dataLoggingEnabled: true,
      });
      await service.logRawPlatformData("youtube", "chat", chatData, {
        dataLoggingEnabled: true,
      });
      await service.logRawPlatformData("tiktok", "chat", chatData, {
        dataLoggingEnabled: true,
      });

      for (const platform of ["twitch", "youtube", "tiktok"]) {
        const contents = await fs.readFile(path.join(logDir, `${platform}-data-log.ndjson`), "utf8");
        expect(JSON.parse(contents)).toMatchObject({ platform, eventType: "chat", payload: chatData });
      }
    });

    it("routes YouTube unknown renderer diagnostics to a separate log file", async () => {
      const diagnosticPayload = {
        videoId: "test-video-id",
        matchedRenderers: [{ rawKey: "giftMessageView" }],
      };

      await service.logRawPlatformData(
        "youtube",
        "unknown-renderer",
        diagnosticPayload,
        { dataLoggingEnabled: true },
      );

      expect(await fs.readdir(logDir)).toEqual(["youtube-unknown-renderer-log.ndjson"]);
      const entry = JSON.parse(await fs.readFile(path.join(logDir, "youtube-unknown-renderer-log.ndjson"), "utf8"));
      expect(entry).toMatchObject({ platform: "youtube", eventType: "unknown-renderer", payload: diagnosticPayload });
    });

    it("does not log when platform logging is disabled for user privacy", async () => {
      const sensitiveData = {
        username: "PrivateUser",
        message: "Personal info",
      };

      await service.logRawPlatformData("twitch", "chat", sensitiveData, {
        dataLoggingEnabled: false,
      });

      expect(await fs.readdir(logDir)).toEqual([]);
    });

    it("handles filesystem errors gracefully without throwing to callers", async () => {
      const blockedRoot = path.join(logDir, "synthetic-blocked-root");
      await fs.writeFile(blockedRoot, "synthetic file blocking directory creation");
      service = new RawPlatformDataLoggingService({ config: { dataLoggingPath: blockedRoot } });

      await expect(
        service.logRawPlatformData(
          "twitch",
          "chat",
          { msg: "test" },
          { dataLoggingEnabled: true },
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("Raw Payload Logging Contract", () => {
    it("uses strict writer validation for statistics and never writes disabled unknown renderer capture", async () => {
      const realService = new RawPlatformDataLoggingService({ config: { dataLoggingPath: logDir } });
      for (const platform of ["../outside", "foo/bar", "foo\\bar", "youtube\0", "YouTube"]) {
        expect(await realService.getLogStatistics(platform)).toEqual({ error: "Raw platform log statistics unavailable", exists: false });
      }
      await realService.logRawPlatformData("youtube", "unknown-renderer", { message: "test raw" });
      await realService.logRawPlatformData("youtube", "unknown-renderer", { message: "test raw" }, { dataLoggingEnabled: false });
      expect(await fs.readdir(logDir)).toEqual([]);
    });
    it("maintains NDJSON wrapper for raw payloads", async () => {
      const giftData = {
        giftType: "Rose",
        giftCount: 1,
        amount: 5,
        currency: "coins",
        username: "Supporter123",
      };

      const defaultWriterService = new RawPlatformDataLoggingService({
        config: { dataLoggingPath: logDir },
      });

      await defaultWriterService.logRawPlatformData("tiktok", "gift", giftData, {
        dataLoggingEnabled: true,
      });

      const logFilePath = path.join(logDir, "tiktok-data-log.ndjson");
      const logContents = await fs.readFile(logFilePath, "utf8");
      const parsedEntry = requireRecord(JSON.parse(logContents.trim()), "NDJSON log entry");

      expect(parsedEntry).toMatchObject({
        platform: "tiktok",
        eventType: "gift",
        payload: giftData,
      });
      expect(typeof parsedEntry.ingestTimestamp).toBe("string");
    });

    it("preserves the StreamElements raw event log filename and wrapper", async () => {
      const followPayload = {
        type: "event",
        data: {
          platform: "youtube",
          displayName: "test-follower",
        },
      };

      const defaultWriterService = new RawPlatformDataLoggingService({
        config: { dataLoggingPath: logDir },
      });

      await defaultWriterService.logRawPlatformData("streamelements", "follow", followPayload, {
        dataLoggingEnabled: true,
      });

      const logFilePath = path.join(logDir, "streamelements-data-log.ndjson");
      const logContents = await fs.readFile(logFilePath, "utf8");
      const parsedEntry = requireRecord(JSON.parse(logContents.trim()), "StreamElements log entry");

      expect(parsedEntry).toMatchObject({
        platform: "streamelements",
        eventType: "follow",
        payload: followPayload,
      });
      expect(typeof parsedEntry.ingestTimestamp).toBe("string");
    });

    it("provides statistics for monitoring system health", async () => {
      const expectedLogPath = path.join(logDir, "youtube-data-log.ndjson");
      await fs.writeFile(expectedLogPath, "x".repeat(123));

      const stats = await service.getLogStatistics("youtube", {
        dataLoggingEnabled: true,
      });

      expect(stats).toMatchObject({
        size: 123,
        path: expectedLogPath,
      });
    });
  });

  it("attributes capture failures without exposing filesystem paths or event payloads", async () => {
    const logger = createLogger({}, { operatorCaptureEnabled: true });
    const blocked = path.join(logDir, 'synthetic-private-path');
    await fs.writeFile(blocked, 'synthetic obstruction');
    const captureService = new RawPlatformDataLoggingService({ logger, config: { dataLoggingPath: blocked } });
    for (const [platform, eventType] of [['twitch', 'chat'], ['youtube', 'gift']] as const) {
      await captureService.logRawPlatformData(platform, eventType, { message: 'synthetic-private-message' }, { dataLoggingEnabled: true });
    }
    const entries = logger.getOperatorLogSource()!.history().entries;
    expect(entries.map(entry => entry.data)).toEqual([
      { platform: 'twitch', eventType: 'chat' }, { platform: 'youtube', eventType: 'gift' },
    ]);
    const output = JSON.stringify(entries);
    expect(output).not.toContain('synthetic-private');
    expect(entries.every(entry => entry.message === 'Raw platform data capture failed')).toBe(true);
  });

  describe("Error recovery", () => {
    it("writes a later valid event after the configured filesystem root becomes available", async () => {
      const root = path.join(logDir, "synthetic-recovery");
      await fs.writeFile(root, "synthetic obstruction");
      const recovering = new RawPlatformDataLoggingService({ config: { dataLoggingPath: root } });
      await recovering.logRawPlatformData("twitch", "chat", { message: "synthetic rejected event" }, { dataLoggingEnabled: true });
      expect(await fs.readFile(root, "utf8")).toBe("synthetic obstruction");
      await fs.unlink(root);
      await recovering.logRawPlatformData("twitch", "chat", { message: "synthetic healthy event" }, { dataLoggingEnabled: true });
      const entries = (await fs.readFile(path.join(root, "twitch-data-log.ndjson"), "utf8")).trim().split("\n");
      expect(entries).toHaveLength(1);
      expect(JSON.parse(entries[0]!)).toMatchObject({ payload: { message: "synthetic healthy event" } });
    });
  });
});
