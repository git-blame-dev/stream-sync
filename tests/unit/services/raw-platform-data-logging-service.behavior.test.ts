import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import { clearAllMocks, restoreAllMocks, createMockFn } from "../../helpers/bun-mock-utils";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "path";
import { RawPlatformDataLoggingService } from "../../../src/services/RawPlatformDataLoggingService.ts";

type ServiceDependencies = ConstructorParameters<typeof RawPlatformDataLoggingService>[0];
type RawEventLogWriterLike = NonNullable<NonNullable<ServiceDependencies>["rawEventLogWriter"]>;
type WriteRawEvent = RawEventLogWriterLike["writeRawEvent"];
type ResolveLogFileName = RawEventLogWriterLike["resolveLogFileName"];

const resolveLogFileName: ResolveLogFileName = (platform: string, eventType: string) =>
  platform === "youtube" && eventType === "unknown-renderer"
    ? "youtube-unknown-renderer-log.ndjson"
    : `${platform}-data-log.ndjson`;

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  expect(value).toBeDefined();
  if (value === null || typeof value !== "object") {
    throw new Error(`Expected ${label} to be an object`);
  }
  return Object.fromEntries(Object.entries(value));
};

describe("RawPlatformDataLoggingService behavior", () => {
  let service: RawPlatformDataLoggingService;
  let writeRawEventSpy: ReturnType<typeof createMockFn<Parameters<WriteRawEvent>, ReturnType<WriteRawEvent>>>;
  let logDir: string;

  beforeEach(async () => {
    logDir = await fs.mkdtemp(path.join(os.tmpdir(), "raw-platform-data-logging-test-"));
    writeRawEventSpy = createMockFn<Parameters<WriteRawEvent>, ReturnType<WriteRawEvent>>(
      async ({ platform, eventType }) => ({
        fileName: resolveLogFileName(platform, eventType),
        filePath: path.join(logDir, resolveLogFileName(platform, eventType)),
      }),
    );

    service = new RawPlatformDataLoggingService({
      config: { dataLoggingPath: logDir },
      rawEventLogWriter: {
        writeRawEvent: writeRawEventSpy,
        resolveLogFileName,
      },
    });
  });

  afterEach(async () => {
    await fs.rm(logDir, { recursive: true, force: true });
    restoreAllMocks();
    clearAllMocks();
  });

  describe("User-Observable Platform Logging Behavior", () => {
    it("writes platform data to the default logs directory", async () => {
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

      expect(writeRawEventSpy.mock.calls).toHaveLength(3);

      const [twitchCall, youtubeCall, tiktokCall] = writeRawEventSpy.mock.calls;
      if (!twitchCall || !youtubeCall || !tiktokCall) throw new Error("Expected three raw event writes");
      expect(twitchCall[0].dataLoggingPath).toBe(logDir);
      expect(youtubeCall[0].dataLoggingPath).toBe(logDir);
      expect(tiktokCall[0].dataLoggingPath).toBe(logDir);

      expect(twitchCall[0]).toMatchObject({
        platform: "twitch",
        eventType: "chat",
        payload: chatData,
      });
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

      expect(writeRawEventSpy.mock.calls).toHaveLength(1);
      const [writeCall] = writeRawEventSpy.mock.calls;
      if (!writeCall) throw new Error("Expected unknown renderer write");
      expect(writeCall[0]).toMatchObject({
        platform: "youtube",
        eventType: "unknown-renderer",
        payload: diagnosticPayload,
      });
    });

    it("does not log when platform logging is disabled for user privacy", async () => {
      const sensitiveData = {
        username: "PrivateUser",
        message: "Personal info",
      };

      await service.logRawPlatformData("twitch", "chat", sensitiveData, {
        dataLoggingEnabled: false,
      });

      expect(writeRawEventSpy.mock.calls).toHaveLength(0);
    });

    it("handles filesystem errors gracefully without throwing to callers", async () => {
      writeRawEventSpy.mockRejectedValueOnce(new Error("Disk full"));

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

  describe("Error Recovery User Experience", () => {
    it("passes the configured log directory to the raw event writer", async () => {
      await service.logRawPlatformData("twitch", "chat", { msg: "test" }, { dataLoggingEnabled: true });

      const [writeCall] = writeRawEventSpy.mock.calls;
      if (!writeCall) throw new Error("Expected raw event write");
      expect(writeCall[0].dataLoggingPath).toBe(logDir);
    });
  });
});
