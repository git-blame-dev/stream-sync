import { describe, expect, it } from "bun:test";
import { promises as fs } from "fs";
import os from "os";
import * as path from "path";

import { RawEventLogWriter } from "../../../src/services/RawEventLogWriter";

describe("RawEventLogWriter behavior", () => {
  it("redacts adjacent URL and quoted assignments without destroying diagnostic boundaries", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-raw-safe-"));
    try {
      const messages = [
        '{"url":"https://example.invalid/?token=synthetic-url","password":"synthetic secret with spaces","diagnostic":"test ordinary details"}',
        'before password="synthetic first second" after',
        "before client_secret='synthetic,remaining;tail' after",
        'before password="synthetic escaped \\"quote\\" and tail" after',
        "before note='password=\"synthetic first second\"' after",
        'before note="client_secret=\'synthetic,remaining;tail\'" after',
        'before token=synthetic-token after ordinary=test',
        'before session_token=synthetic-session after ordinary=test',
        'before "password":synthetic-password after ordinary=test',
        'before {"count":1,"password":"synthetic first second","diagnostic":"test ordinary details"} after',
        'before {"active":true,"cookie":"synthetic cookie with spaces"} after',
        'before note=password="synthetic first second" after',
        'before token=synthetic-token,"password":"synthetic first second" after',
        'before session_token=synthetic-token,"cookie":"synthetic cookie with spaces" after',
      ];
      const result = await new RawEventLogWriter().writeRawEvent({ dataLoggingPath: tempDir, platform: "twitch", eventType: "chat", payload: { messages } });
      const text = await fs.readFile(result.filePath, "utf8");
      const captured: string[] = JSON.parse(text).payload.messages;
      expect(text).not.toMatch(/synthetic|secret with spaces|first second|remaining|and tail/);
      expect(captured[0]).toContain('"diagnostic":"test ordinary details"');
      expect(captured[0]).toContain('"password":"[REDACTED]"');
      for (const message of captured.slice(1)) {
        expect(message.startsWith("before ")).toBe(true);
        expect(message).toMatch(/ after(?: ordinary=test)?$/);
        expect(message).toContain("[REDACTED]");
      }
    } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
  });

  it("redacts OAuth fragment credentials while preserving ordinary fragments", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-raw-safe-"));
    try {
      const ordinary = "https://example.invalid/watch#section=details";
      const result = await new RawEventLogWriter().writeRawEvent({ dataLoggingPath: tempDir, platform: "twitch", eventType: "chat", payload: {
        standalone: "https://example.invalid/callback#access_token=synthetic-access-secret&token_type=Bearer",
        embedded: 'before "https://example.invalid/callback#id_token=synthetic-id-secret&state=test" after',
        ordinary,
      } });
      const text = await fs.readFile(result.filePath, "utf8");
      expect(text).not.toContain("synthetic");
      expect(JSON.parse(text).payload.ordinary).toBe(ordinary);
    } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
  });

  it("omits complete credential URL candidates including punctuation-bearing secret suffixes", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-raw-safe-"));
    try {
      const urls = [
        "https://example.invalid/watch?access_token=synthetic-first,synthetic-rest",
        "https://example.invalid/watch?access_token=,synthetic-leading",
        "https://example.invalid/watch?X-Amz-Signature=synthetic-first(synthetic-rest)",
        "https://synthetic-user,synthetic-tail:synthetic-password(synthetic-rest)@example.invalid/watch",
        "https://example.invalid/watch?access_token=synthetic-first%2Csynthetic-rest%29",
        "(https://example.invalid/watch?client_secret=synthetic-first);synthetic-ambiguous]"
      ];
      const ordinary = "https://example.invalid/watch?v=test,part(two)&other=three%2Cfour";
      const result = await new RawEventLogWriter().writeRawEvent({ dataLoggingPath: tempDir, platform: "youtube", eventType: "chat", payload: { urls, ordinary } });
      const text = await fs.readFile(result.filePath, "utf8");
      expect(text).not.toContain("synthetic-");
      expect(JSON.parse(text).payload.ordinary).toBe(ordinary);
    } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
  });

  it("redacts complete quoted credential values while retaining surrounding diagnostic text", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-raw-safe-"));
    try {
      const messages = [
        'before {"access_token":"synthetic-access-secret","message":"test chat"} after',
        'before {"client_secret":"synthetic client secret with spaces,;()"} after',
        'before {"password":"synthetic escaped \\"quote\\" and tail"} after',
        'before {"cookie":"synthetic-cookie=part; synthetic-other=tail"} after',
        'before {"Refresh-Token":"synthetic-refresh-secret"} after',
        'before {"client\\u005fsecret":"synthetic-encoded-label-secret"} after',
        "before {'client_secret':'synthetic single quoted secret'} after"
      ];
      const result = await new RawEventLogWriter().writeRawEvent({ dataLoggingPath: tempDir, platform: "twitch", eventType: "chat", payload: { messages } });
      const text = await fs.readFile(result.filePath, "utf8");
      expect(text).not.toContain("synthetic");
      const captured: string[] = JSON.parse(text).payload.messages;
      expect(captured).toHaveLength(messages.length);
      for (const message of captured) {
        expect(message.startsWith("before ")).toBe(true);
        expect(message.endsWith(" after")).toBe(true);
        expect(message).toContain("[REDACTED]");
      }
      expect(captured[0]).toContain('"message":"test chat"');
      expect(captured[1]).toBe('before {"client_secret":"[REDACTED]"} after');
      expect(captured[2]).toBe('before {"password":"[REDACTED]"} after');
      expect(captured[3]).toBe('before {"cookie":"[REDACTED]"} after');
      expect(captured[5]).toBe('before {"client\\u005fsecret":"[REDACTED]"} after');
    } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
  });
  it("redacts credentials without losing raw chat and ordinary URLs", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-raw-safe-"));
    try {
      const writer = new RawEventLogWriter();
      const result = await writer.writeRawEvent({ dataLoggingPath: tempDir, platform: "youtube", eventType: "chat", payload: {
        message: "test chat Bearer synthetic-bearer-secret",
        nested: { access_token: "synthetic-access-secret", "Client-Secret": "synthetic-client-secret", cookie: "synthetic-cookie-secret" },
        url: "https://example.invalid/watch?v=test&X-Amz-Signature=synthetic-signature-secret",
        ordinary: "https://example.invalid/watch?v=test"
      } });
      const text = await fs.readFile(result.filePath, "utf8");
      expect(text).not.toContain("synthetic-");
      const entry = JSON.parse(text);
      expect(entry.payload.message).toContain("test chat");
      expect(entry.payload.ordinary).toBe("https://example.invalid/watch?v=test");
      expect(entry.payload.url).toContain("v=test");
    } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
  });

  it("bounds hostile payloads while preserving repeated references and avoiding getters/toJSON", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-raw-safe-"));
    try {
      const shared = { message: "test shared" };
      const payload: Record<string, unknown> = { first: shared, second: shared, huge: "🦄".repeat(100_000), bigint: 42n };
      payload.self = payload;
      Object.defineProperty(payload, "getter", { enumerable: true, get() { throw new Error("synthetic-getter-secret"); } });
      payload.toJSON = () => { throw new Error("synthetic-tojson-secret"); };
      const writer = new RawEventLogWriter();
      const result = await writer.writeRawEvent({ dataLoggingPath: tempDir, platform: "twitch", eventType: "chat", payload });
      const text = await fs.readFile(result.filePath, "utf8");
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65_536);
      const entry = JSON.parse(text);
      expect(entry.payload.first).toEqual(shared);
      expect(entry.payload.second).toEqual(shared);
      expect(entry.payload.self).toBe("[Circular]");
      expect(entry.payload.getter).toBe("[Accessor omitted]");
      expect(text).not.toContain("synthetic-");
    } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
  });

  it("rejects every platform outside the exact production filename contract before creating directories", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-raw-safe-"));
    try {
      const writer = new RawEventLogWriter();
      for (const platform of ["../escape", "foo/bar", "foo\\bar", "youtube\0", "YouTube", "unknown"]) {
        await expect(writer.writeRawEvent({ dataLoggingPath: path.join(tempDir, "absent"), platform, eventType: "chat", payload: {} })).rejects.toThrow("Unsupported raw logging platform");
      }
      expect(await fs.readdir(tempDir)).toEqual([]);
    } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
  });

  it("caps depth, width, total nodes and multibyte output without invoking proxy traps", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-raw-safe-"));
    try {
      let deep: unknown = { message: "test unreachable leaf" };
      for (let index = 0; index < 30; index++) deep = { next: deep };
      const proxy = new Proxy({}, { ownKeys() { throw new Error("synthetic-proxy-secret"); } });
      const wide = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`test${index}`, "test value"]));
      const many = Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => "🦄".repeat(1000)));
      const polluted = Object.create({ toJSON() { throw new Error("synthetic-prototype-secret"); } });
      Object.defineProperty(polluted, "__proto__", { enumerable: true, value: { message: "test own proto" } });
      const writer = new RawEventLogWriter();
      for (const payload of [{ deep, proxy, wide, polluted }, many, 2n ** 1000n, undefined]) {
        const result = await writer.writeRawEvent({ dataLoggingPath: tempDir, platform: "youtube", eventType: "test", payload });
        const lines = (await fs.readFile(result.filePath, "utf8")).trim().split("\n");
        for (const line of lines) {
          expect(Buffer.byteLength(`${line}\n`)).toBeLessThanOrEqual(65_536);
          expect(() => JSON.parse(line)).not.toThrow();
          expect(line).not.toContain("synthetic-");
          expect(line).not.toContain("test unreachable leaf");
        }
      }
    } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
  });

  it("keeps filesystem failure diagnostics generic and supports relative configured roots", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-raw-safe-"));
    try {
      const writer = new RawEventLogWriter();
      const fileRoot = path.join(tempDir, "synthetic-private-path");
      await fs.writeFile(fileRoot, "test fixture");
      await expect(writer.writeRawEvent({ dataLoggingPath: fileRoot, platform: "twitch", eventType: "chat", payload: {} })).rejects.toThrow("Raw event capture write failed");
      const relativeRoot = path.relative(process.cwd(), tempDir);
      const result = await writer.writeRawEvent({ dataLoggingPath: relativeRoot, platform: "youtube", eventType: "../event-is-content", payload: {
        list: Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => null))
      } });
      expect(result.filePath).toBe(path.join(relativeRoot, "youtube-data-log.ndjson"));
      const text = await fs.readFile(result.filePath, "utf8");
      expect(JSON.parse(text).eventType).toBe("../event-is-content");
      expect(text).toContain("[Capture limit]");
    } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
  });
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

  it("creates nested raw event log directories before writing", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-raw-events-"));
    const nestedLogDir = path.join(tempDir, "nested", "raw-events");
    const writer = new RawEventLogWriter();

    try {
      await writer.writeRawEvent({
        dataLoggingPath: nestedLogDir,
        platform: "tiktok",
        eventType: "gift",
        payload: { giftType: "Rose" },
      });

      const logContent = await fs.readFile(path.join(nestedLogDir, "tiktok-data-log.ndjson"), "utf8");
      expect(logContent).toContain("Rose");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
