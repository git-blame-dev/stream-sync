import { describe, expect, it } from "bun:test";
import { promises as fs } from "fs";
import os from "os";
import * as path from "path";

import { RawEventLogWriter } from "../../../src/services/RawEventLogWriter";

describe("RawEventLogWriter behavior", () => {
  it("writes standard platform payloads as newline-delimited raw event entries", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-raw-events-"));
    const writer = new RawEventLogWriter();
    const payload = { type: "follow", data: { displayName: "test-follower" } };

    try {
      const result = await writer.writeRawEvent({
        dataLoggingPath: tempDir,
        platform: "streamelements",
        eventType: "follow",
        payload,
      });

      expect(result).toEqual({
        filePath: path.join(tempDir, "streamelements-data-log.ndjson"),
        fileName: "streamelements-data-log.ndjson",
      });
      const logContent = await fs.readFile(path.join(tempDir, "streamelements-data-log.ndjson"), "utf8");
      expect(logContent.endsWith("\n")).toBe(true);

      const logEntry = JSON.parse(logContent.trim());
      expect(logEntry).toMatchObject({
        platform: "streamelements",
        eventType: "follow",
        payload,
      });
      expect(typeof logEntry.ingestTimestamp).toBe("string");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("preserves the YouTube unknown renderer filename", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-raw-events-"));
    const writer = new RawEventLogWriter();

    try {
      await writer.writeRawEvent({
        dataLoggingPath: tempDir,
        platform: "youtube",
        eventType: "unknown-renderer",
        payload: { renderer: "test-renderer" },
      });

      const logContent = await fs.readFile(path.join(tempDir, "youtube-unknown-renderer-log.ndjson"), "utf8");
      expect(logContent).toContain("test-renderer");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
