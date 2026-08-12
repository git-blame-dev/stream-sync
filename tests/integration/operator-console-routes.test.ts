import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AppLogger } from "../../src/core/logger/types";
import { createGuiTransportService } from "../../src/services/gui/gui-transport-service";
import { createOperatorLogSource } from "../../src/services/operator/operator-log-source";
import {
  createOperatorControlService,
  OPERATOR_CONTROL_KEYS,
  type OperatorControls,
} from "../../src/services/operator/operator-control-service";
import { TestEventBus } from "../helpers/gui-transport-test-utils";

const temporaryDirectories: string[] = [];

function createDefaults(): OperatorControls {
  return Object.fromEntries(OPERATOR_CONTROL_KEYS.map((key) => [key, true])) as OperatorControls;
}

function createLogSource(options?: { maxEntries?: number }) {
  const source = createOperatorLogSource(options);
  source.append({
    timestamp: "2026-08-11 12:00:00",
    level: "info",
    message: "Older retained log",
    source: "test",
    data: null,
  });
  source.append({
    timestamp: "2026-08-11 12:00:01",
    level: "info",
    message: "Operator route ready",
    source: "test",
    data: null,
  });
  const logger: AppLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return { logger, source };
}

async function createFixture(logSourceOptions?: { maxEntries?: number }) {
  const root = await mkdtemp(join(tmpdir(), "stream-sync-operator-"));
  temporaryDirectories.push(root);
  const assetsRoot = join(root, "dist");
  await mkdir(join(assetsRoot, "assets"), { recursive: true });
  await writeFile(join(assetsRoot, "assets", "operator.js"), "export {};", "utf8");
  await writeFile(join(assetsRoot, "assets", "operator.css"), "body{}", "utf8");
  const controls = await createOperatorControlService({
    defaults: createDefaults(),
    filePath: join(root, "operator-control-overrides.json"),
  });
  const { logger, source } = createLogSource(logSourceOptions);
  const service = createGuiTransportService({
    config: {
      gui: {
        enableDock: false,
        enableOverlay: false,
        enableOperator: true,
        host: "127.0.0.1",
        port: 0,
      },
    },
    assetsRoot,
    eventBus: new TestEventBus(),
    logger,
    operatorLogs: source,
    operatorControls: controls,
  });
  await service.start();
  const address = service.getAddress();
  if (!address || typeof address === "string") {
    throw new Error("Expected operator transport address");
  }
  return { baseUrl: `http://127.0.0.1:${address.port}`, controls, root, service, source };
}

function createSseReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let carry = "";
  return {
    async next() {
      while (true) {
        while (!carry.includes("\n\n")) {
          const { value, done } = await reader.read();
          if (done) throw new Error("SSE stream ended before a complete frame");
          carry += decoder.decode(value, { stream: true });
        }
        const separator = carry.indexOf("\n\n");
        const frame = carry.slice(0, separator);
        carry = carry.slice(separator + 2);
        if (frame.includes("event:")) return frame;
      }
    },
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("operator console routes", () => {
  test("starts in operator-only mode and serves the secured operator page", async () => {
    const { baseUrl, service } = await createFixture();
    try {
      const response = await fetch(`${baseUrl}/operator`);
      const html = await response.text();
      const script = await fetch(`${baseUrl}/gui/assets/operator.js`);
      const stylesheet = await fetch(`${baseUrl}/gui/assets/operator.css`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(html).toContain('id="operator-root"');
      expect(html).toContain("/gui/assets/operator.js");
      expect(script.status).toBe(200);
      expect(script.headers.get("content-type")).toContain("application/javascript");
      expect(stylesheet.status).toBe(200);
      expect(stylesheet.headers.get("content-type")).toContain("text/css");
    } finally {
      await service.stop();
    }
  });

  test("returns authoritative state and accepts same-origin control updates", async () => {
    const { baseUrl, controls, root, service } = await createFixture();
    try {
      const initial = await fetch(`${baseUrl}/api/v1/operator/state`);
      const initialState = await initial.json() as { controls: Array<{ key: string; label: string; enabled: boolean }> };
      expect(initialState.controls.find((control) => control.key === "giftsEnabled")?.enabled).toBe(true);
      expect(initialState.controls.find((control) => control.key === "paypiggiesEnabled")?.label).toBe("Paypiggies");

      const response = await fetch(`${baseUrl}/api/v1/operator/controls`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Origin": baseUrl,
          "X-Stream-Sync-Request": "1",
        },
        body: JSON.stringify({ key: "giftsEnabled", enabled: false }),
      });
      const state = await response.json() as { controls: Array<{ key: string; enabled: boolean; overridden: boolean }> };

      expect(response.status).toBe(200);
      expect(controls.isEnabled("giftsEnabled")).toBe(false);
      expect(state.controls.find((control) => control.key === "giftsEnabled")).toMatchObject({
        enabled: false,
        overridden: true,
      });
      const overridePath = join(root, "operator-control-overrides.json");
      expect(JSON.parse(await readFile(overridePath, "utf8"))).toEqual({ giftsEnabled: false });
      if (process.platform !== "win32") {
        expect((await stat(overridePath)).mode & 0o777).toBe(0o600);
      }
    } finally {
      await service.stop();
    }
  });

  test("rejects cross-origin and malformed mutations", async () => {
    const { baseUrl, service } = await createFixture();
    try {
      const crossOrigin = await fetch(`${baseUrl}/api/v1/operator/controls`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Origin": "http://example.test",
          "X-Stream-Sync-Request": "1",
        },
        body: JSON.stringify({ key: "giftsEnabled", enabled: false }),
      });
      const malformed = await fetch(`${baseUrl}/api/v1/operator/controls`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Origin": baseUrl,
          "X-Stream-Sync-Request": "1",
        },
        body: JSON.stringify({ key: "not-a-control", enabled: false }),
      });
      const missingRequestHeader = await fetch(`${baseUrl}/api/v1/operator/controls`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Origin": baseUrl,
        },
        body: JSON.stringify({ key: "giftsEnabled", enabled: false }),
      });
      const oversized = await fetch(`${baseUrl}/api/v1/operator/controls`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Origin": baseUrl,
          "X-Stream-Sync-Request": "1",
        },
        body: JSON.stringify({ key: "giftsEnabled", enabled: false, padding: "x".repeat(3000) }),
      });

      expect(crossOrigin.status).toBe(403);
      expect(malformed.status).toBe(400);
      expect(missingRequestHeader.status).toBe(403);
      expect(oversized.status).toBe(413);
    } finally {
      await service.stop();
    }
  });

  test("enforces mutation methods and restores config defaults", async () => {
    const { baseUrl, controls, service } = await createFixture();
    try {
      const wrongMethod = await fetch(`${baseUrl}/api/v1/operator/controls`, { method: "POST" });
      const malformedJson = await fetch(`${baseUrl}/api/v1/operator/controls`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Origin": baseUrl,
          "X-Stream-Sync-Request": "1",
        },
        body: "{",
      });
      await controls.setEnabled("giftsEnabled", false);
      const reset = await fetch(`${baseUrl}/api/v1/operator/controls/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": baseUrl,
          "X-Stream-Sync-Request": "1",
        },
        body: "{}",
      });

      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.get("allow")).toBe("PATCH");
      expect(malformedJson.status).toBe(400);
      expect(reset.status).toBe(200);
      expect(controls.isEnabled("giftsEnabled")).toBe(true);
      expect(controls.overriddenKeys).toEqual([]);
    } finally {
      await service.stop();
    }
  });

  test("publishes authoritative state changes over SSE", async () => {
    const { baseUrl, controls, service } = await createFixture();
    const controller = new AbortController();
    try {
      const response = await fetch(`${baseUrl}/api/v1/operator/events`, { signal: controller.signal });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Expected state event stream");
      const sse = createSseReader(reader);
      const initial = await sse.next();
      expect(initial).toContain("event: state");
      expect(initial).toContain('"revision":0');

      await controls.setEnabled("sharesEnabled", false);
      const changed = await sse.next();
      expect(changed).toContain('"revision":1');
      expect(changed).toContain('"key":"sharesEnabled"');
      expect(changed).toContain('"enabled":false');
    } finally {
      controller.abort();
      await service.stop();
    }
  });

  test("replays retained structured logs as named SSE events", async () => {
    const { baseUrl, service } = await createFixture();
    const controller = new AbortController();
    try {
      const response = await fetch(`${baseUrl}/api/v1/logs/events`, {
        headers: { "Last-Event-ID": "1" },
        signal: controller.signal,
      });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Expected log event stream");
      const packet = await createSseReader(reader).next();

      expect(response.status).toBe(200);
      expect(packet).toContain("event: log");
      expect(packet).toContain("Operator route ready");
      expect(packet).not.toContain("Older retained log");
    } finally {
      controller.abort();
      await service.stop();
    }
  });

  test("replays logs in order before delivering a live append", async () => {
    const { baseUrl, service, source } = await createFixture();
    const controller = new AbortController();
    try {
      const response = await fetch(`${baseUrl}/api/v1/logs/events`, { signal: controller.signal });
      const reader = response.body!.getReader();
      const sse = createSseReader(reader);
      const first = await sse.next();
      const second = await sse.next();
      expect(first).toContain('"id":1');
      expect(second).toContain('"id":2');
      source.append({ timestamp: "2026-08-11 12:00:02", level: "info", message: "Live append", source: "test", data: null });
      const live = await sse.next();
      expect(live).toContain('"message":"Live append"');
    } finally {
      controller.abort();
      await service.stop();
    }
  });

  test("emits a reset event for a stale high Last-Event-ID", async () => {
    const { baseUrl, service } = await createFixture();
    const controller = new AbortController();
    try {
      const response = await fetch(`${baseUrl}/api/v1/logs/events`, {
        headers: { "Last-Event-ID": "999" }, signal: controller.signal,
      });
      const frame = await createSseReader(response.body!.getReader()).next();
      expect(frame).toContain("event: log.history");
      expect(frame).toContain('"truncated":true');
    } finally {
      controller.abort();
      await service.stop();
    }
  });

  test("emits history before replay after a low Last-Event-ID is evicted", async () => {
    const { baseUrl, service, source } = await createFixture({ maxEntries: 2 });
    const controller = new AbortController();
    try {
      source.append({ timestamp: "2026-08-11 12:00:02", level: "info", message: "Evicted middle log", source: "test", data: null });
      source.append({ timestamp: "2026-08-11 12:00:03", level: "info", message: "Newest retained log", source: "test", data: null });
      const response = await fetch(`${baseUrl}/api/v1/logs/events`, {
        headers: { "Last-Event-ID": "1" }, signal: controller.signal,
      });
      const sse = createSseReader(response.body!.getReader());
      const history = await sse.next();
      const firstReplay = await sse.next();
      const secondReplay = await sse.next();

      expect(history).toContain("event: log.history");
      expect(history).toContain('"oldestId":3');
      expect(history).toContain('"truncated":true');
      expect(firstReplay).toContain('"id":3');
      expect(secondReplay).toContain('"id":4');
    } finally {
      controller.abort();
      await service.stop();
    }
  });

  test("treats malformed and empty Last-Event-ID values as fresh replay", async () => {
    for (const lastEventId of ["", "1x"]) {
      const { baseUrl, service } = await createFixture();
      const controller = new AbortController();
      try {
        const response = await fetch(`${baseUrl}/api/v1/logs/events`, {
          headers: { "Last-Event-ID": lastEventId }, signal: controller.signal,
        });
        const frame = await createSseReader(response.body!.getReader()).next();
        expect(frame).toContain('"id":1');
      } finally {
        controller.abort();
        await service.stop();
      }
    }
  });
});
