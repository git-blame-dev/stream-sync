import { describe, it, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "node:events";

import { createGuiTransportService } from "../../src/services/gui/gui-transport-service";
import { DEFAULT_AVATAR_URL } from "../../src/constants/avatar";
import { safeSetTimeout } from "../../src/utils/timeout-validator";
import { EventBus } from "../../src/core/EventBus";
import { createConfigFixture } from "../helpers/config-fixture";
import { createOperatorAppearanceService } from "../../src/services/operator/operator-appearance-service";
import { createFundingGoalService } from "../../src/services/funding-goal-service";
import { createOperatorControlService, OPERATOR_CONTROL_KEYS } from "../../src/services/operator/operator-control-service";
import { createOperatorLogSource } from "../../src/services/operator/operator-log-source";
import { DISPLAY_EVENT_TYPES } from "../../src/interfaces/DisplayEvents";

function buildConfig(guiOverrides = {}) {
  return createConfigFixture({
    gui: {
      enableDock: false,
      enableOverlay: false,
      host: "127.0.0.1",
      port: 3399,
      messageCharacterLimit: 0,
      ...guiOverrides,
    },
  });
}

function createSseReader(response: any) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const readWithTimeout = async (timeoutMs = 2000) => {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeoutHandle = safeSetTimeout(
          () => reject(new Error("Timed out waiting for SSE event")),
          timeoutMs,
        );
      }),
    ]).finally(() => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    });
  };

  const readPayload = async (timeoutMs = 2000) => {
      while (true) {
        const separatorIndex = buffer.indexOf("\n\n");
        if (separatorIndex === -1) {
          const { value, done } = await readWithTimeout(timeoutMs);
          if (done) {
            throw new Error("SSE stream ended before receiving an event");
          }

          buffer += decoder.decode(value, { stream: true });
          continue;
        }

        const chunk = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const dataLine = chunk
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.startsWith("data:"));

        if (!dataLine) {
          continue;
        }

        const dataText = dataLine.slice("data:".length).trim();
        return JSON.parse(dataText);
      }
  };

  return {
    cancel() {
      return reader.cancel();
    },
    async readEvent(timeoutMs = 2000) {
      while (true) {
        const payload = await readPayload(timeoutMs);
        if (payload.__guiEvent !== "appearance") return payload;
      }
    },
    async readAppearance(timeoutMs = 2000) {
      while (true) {
        const payload = await readPayload(timeoutMs);
        if (payload.__guiEvent === "appearance") return payload;
      }
    },
  };
}

function getBaseUrl(service: any) {
  const address = service.getAddress();
  if (
    !address ||
    typeof address !== "object" ||
    typeof address.port !== "number"
  ) {
    throw new Error("Expected GUI transport service to expose a bound address");
  }
  return `http://127.0.0.1:${address.port}`;
}

function requireRuntimeErrorListener(
  listener: ((error: Error) => void) | null,
) {
  if (!listener) {
    throw new Error("Expected runtime server error listener to be registered");
  }

  return listener;
}

describe("GUI transport routes and SSE integration", () => {
  it("retires every display listener even when unsubscribe and diagnostics throw", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-retirement-test-"));
    const appearance = await createOperatorAppearanceService({
      defaults: { compactRows: true, rowBackgroundsEnabled: false, maxDisplayableBadges: 3 },
      filePath: path.join(root, "appearance.json"),
    });
    const controls = await createOperatorControlService({
      defaults: Object.fromEntries(OPERATOR_CONTROL_KEYS.map((key) => [key, true])) as Parameters<typeof createOperatorControlService>[0]["defaults"],
      filePath: path.join(root, "controls.json"),
    });
    const funding = await createFundingGoalService({
      config: { enabled: true, id: "test-goal", label: "Synthetic goal", targetUsd: 100 },
      monetizationValuesConfig: { tiktokGiftUnitUsd: 0.005, twitchBitUsd: 0.01, youtubeJewelUsd: 0.005,
        tiktokMembershipUsd: 2, twitchMembershipUsd: 3, youtubeMembershipUsd: 4 },
      filePath: path.join(root, "funding.json"),
    });
    const retired: string[] = [];
    for (const [name, owner] of [["appearance", appearance], ["controls", controls], ["funding", funding]] as const) {
      const original = owner.subscribe.bind(owner);
      // Wrap real listener removal, not the service under test.
      owner.subscribe = ((callback: never) => {
        const detach = original(callback);
        return () => { detach(); retired.push(name); throw new Error("synthetic owner retirement failure"); };
      }) as typeof owner.subscribe;
    }
    const bus = new EventBus();
    const subscribe = bus.subscribe.bind(bus);
    bus.subscribe = (event, callback) => {
      const detach = subscribe(event, callback);
      return () => {
        detach();
        retired.push(String(event));
        throw new Error("synthetic retirement failure");
      };
    };
    let closed = 0;
    let listener: ((req: any, res: any) => void) | undefined;
    const logs = createOperatorLogSource();
    const connect = logs.connect.bind(logs);
    let logDetached = 0;
    logs.connect = (...args) => {
      const connection = connect(...args);
      return { ...connection, unsubscribe: () => {
        connection.unsubscribe(); logDetached += 1; throw new Error("synthetic log unsubscribe failure");
      } };
    };
    const service = createGuiTransportService({
      config: buildConfig({ enableOverlay: true, enableChatFeed: true, enableOperator: true, port: 0 }),
      eventBus: bus,
      operatorAppearance: appearance, operatorControls: controls, fundingGoal: funding,
      operatorLogs: logs,
      logger: { warn: () => { throw new Error("diagnostic failure"); }, error: () => { throw new Error("diagnostic failure"); } },
      createServer: (handler) => { listener = handler; return ({
        once: () => undefined, on: () => undefined, removeListener: () => undefined,
        listen: (_port, _host, callback) => callback?.(),
        address: () => ({ address: "127.0.0.1", family: "IPv4", port: 45682 }),
        close: (callback) => { closed += 1; callback?.(); },
      }); },
    });
    await service.start();
    const responses = ["/gui/events", "/api/v1/chat/events", "/api/v1/operator/events", "/api/v1/logs/events"].map((url) => {
      let ends = 0;
      const response = Object.assign(new EventEmitter(), {
        destroyed: false, writableEnded: false, writableLength: 0,
        writeHead: () => undefined, write: () => true,
        end: () => { ends += 1; throw new Error("synthetic end failure"); },
      });
      listener!(Object.assign(new EventEmitter(), { method: "GET", url, headers: {} }), response);
      return () => ends;
    });
    await service.stop();
    await service.stop();
    expect(retired).toHaveLength(8);
    expect(bus.eventNames()).toEqual([]);
    expect(closed).toBe(1);
    expect(service.isActive()).toBe(false);
    expect(responses.map((ends) => ends())).toEqual([1, 1, 1, 1]);
    expect(logDetached).toBe(1);
    funding.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("preserves startup failure through throwing rollback and diagnostics", async () => {
    const original = new Error("synthetic listen failure");
    const bus = new EventBus();
    const subscribe = bus.subscribe.bind(bus);
    let retired = 0;
    bus.subscribe = (event, callback) => {
      const detach = subscribe(event, callback);
      return () => { detach(); retired += 1; throw new Error("synthetic detach failure"); };
    };
    let closes = 0;
    const service = createGuiTransportService({
      config: buildConfig({ enableOverlay: true, port: 0 }), eventBus: bus,
      logger: { warn: () => { throw new Error("diagnostic failure"); }, error: () => { throw new Error("diagnostic failure"); } },
      createServer: () => ({
        once: () => undefined, on: () => undefined, removeListener: () => { throw new Error("synthetic remove failure"); },
        listen: () => { throw original; }, address: () => null,
        close: () => { closes += 1; throw new Error("synthetic close failure"); },
      }),
    });
    expect(await service.start().catch((error: unknown) => error)).toBe(original);
    await service.stop();
    expect(retired).toBe(3);
    expect(closes).toBe(1);
    expect(bus.eventNames()).toEqual([]);
    expect(service.isActive()).toBe(false);
  });

  it("coalesces reentrant stop and waits for a pending server listen before completing", async () => {
    let finishListen: (() => void) | undefined;
    let closes = 0;
    let reentrantStop: Promise<void> | undefined;
    const bus = new EventBus();
    const subscribe = bus.subscribe.bind(bus);
    bus.subscribe = (event, callback) => {
      const detach = subscribe(event, callback);
      return () => { const result = detach(); reentrantStop = service.stop(); return result; };
    };
    const service = createGuiTransportService({
      config: buildConfig({ enableOverlay: true, port: 0 }), eventBus: bus, logger: null,
      createServer: () => ({
        once: () => undefined, on: () => undefined, removeListener: () => undefined,
        listen: (_port, _host, callback) => { finishListen = callback; }, address: () => null,
        close: (callback) => { closes += 1; callback?.(); },
      }),
    });
    const starting = service.start();
    let stopped = false;
    const stopping = service.stop();
    expect(service.stop()).toBe(stopping);
    void stopping.then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(closes).toBe(0);
    finishListen!();
    await starting;
    await stopping;
    expect(reentrantStop).toBe(stopping);
    expect(closes).toBe(1);
    expect(service.isActive()).toBe(false);
    expect(bus.eventNames()).toEqual([]);
  });

  it("rejects a retained lifecycle callback after restart while delivering the current generation", async () => {
    const bus = new EventBus();
    const callbacks: Array<(...args: unknown[]) => void> = [];
    const subscribe = bus.subscribe.bind(bus);
    bus.subscribe = (event, callback) => {
      if (event === DISPLAY_EVENT_TYPES.NOTIFICATION_LIFECYCLE) callbacks.push(callback);
      return subscribe(event, callback);
    };
    let listener: ((req: any, res: any) => void) | undefined;
    const service = createGuiTransportService({
      config: buildConfig({ enableOverlay: true, port: 0 }), eventBus: bus, logger: null,
      createServer: (handler) => { listener = handler; return {
        once: () => undefined, on: () => undefined, removeListener: () => undefined,
        listen: (_port, _host, callback) => callback?.(), address: () => null,
        close: (callback) => callback?.(),
      }; },
    });
    await service.start();
    await service.stop();
    await service.start();
    const packets: string[] = [];
    let delivered: (() => void) | undefined;
    const currentDelivered = new Promise<void>((resolve) => { delivered = resolve; });
    const response = Object.assign(new EventEmitter(), {
      destroyed: false, writableEnded: false, writableLength: 0,
      writeHead: () => undefined, end: () => undefined,
      write: (packet: string) => {
        packets.push(packet);
        if (packet.includes("test-current-event")) delivered!();
        return true;
      },
    });
    listener!(Object.assign(new EventEmitter(), { method: "GET", url: "/gui/events", headers: {} }), response);
    callbacks[0]!({ eventId: "test-retired-event", phase: "started", timestamp: 1 });
    callbacks[1]!({ eventId: "test-current-event", phase: "started", timestamp: 2 });
    await currentDelivered;
    expect(packets.some((packet) => packet.includes("test-retired-event"))).toBe(false);
    expect(packets.some((packet) => packet.includes("test-current-event"))).toBe(true);
    await service.stop();
  });

  it("sends the current funding goal on connect and broadcasts later revisions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-funding-goal-"));
    const fundingGoal = await createFundingGoalService({
      config: {
        enabled: true,
        id: "controller",
        label: "🎮 New Controller",
        targetUsd: 100,
      },
      monetizationValuesConfig: {
        tiktokGiftUnitUsd: 0.005,
        twitchBitUsd: 0.01,
        youtubeJewelUsd: 0.005,
        tiktokMembershipUsd: 2.10,
        twitchMembershipUsd: 3.50,
        youtubeMembershipUsd: 3.89,
      },
      filePath: path.join(root, "funding-goal.json"),
    });
    await fundingGoal.setTotal(25);
    const service = createGuiTransportService({
      config: buildConfig({ enableOverlay: true, port: 0 }),
      eventBus: new EventBus(),
      fundingGoal,
      logger: null,
    });
    await service.start();
    const controller = new AbortController();

    try {
      const response = await fetch(`${getBaseUrl(service)}/gui/events`, { signal: controller.signal });
      const reader = createSseReader(response);
      expect(await reader.readEvent()).toMatchObject({
        __guiEvent: "funding-goal",
        currentUsd: 25,
        targetUsd: 100,
        revision: 1,
      });

      await fundingGoal.adjust(5);
      expect(await reader.readEvent()).toMatchObject({
        __guiEvent: "funding-goal",
        currentUsd: 30,
        revision: 2,
      });
    } finally {
      controller.abort();
      await service.stop();
      fundingGoal.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips an oversized direct-owner funding snapshot while retaining a healthy ordered SSE client", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "synthetic-oversized-funding-"));
    const eventBus = new EventBus();
    const controller = new AbortController();
    let fundingGoal: Awaited<ReturnType<typeof createFundingGoalService>> | undefined;
    let service: ReturnType<typeof createGuiTransportService> | undefined;
    try {
      // The direct service constructor accepts this configuration. This does not
      // claim that the operator label editor accepts an oversized label.
      fundingGoal = await createFundingGoalService({
        config: { enabled: true, id: "synthetic-oversized", label: "x".repeat(300_000), targetUsd: 100 },
        monetizationValuesConfig: { tiktokGiftUnitUsd: 0.005, twitchBitUsd: 0.01, youtubeJewelUsd: 0.005,
          tiktokMembershipUsd: 2, twitchMembershipUsd: 3, youtubeMembershipUsd: 4 },
        filePath: path.join(root, "funding.json"),
      });
      await fundingGoal.setTotal(25);
      expect(fundingGoal.snapshot.label.length).toBe(300_000);
      service = createGuiTransportService({ config: buildConfig({ enableOverlay: true, port: 0 }), eventBus, fundingGoal, logger: null });
      await service.start();
      const response = await fetch(`${getBaseUrl(service)}/gui/events`, { signal: controller.signal });
      expect(response.status).toBe(200);
      const reader = createSseReader(response);
      await reader.readAppearance();
      eventBus.emit("display:row", { type: "chat", platform: "twitch", data: {
        username: "Synthetic Sentinel", userId: "synthetic-sentinel", message: "synthetic funding sentinel",
        timestamp: "2026-01-01T00:00:00.000Z",
      } });
      expect(await reader.readEvent()).toMatchObject({ type: "chat", text: "synthetic funding sentinel" });
    } finally {
      controller.abort();
      try { await service?.stop(); }
      finally {
        try { await fundingGoal?.dispose(); }
        finally { fs.rmSync(root, { recursive: true, force: true }); }
      }
    }
  });

  it("sends the current minimal appearance snapshot when a GUI client connects", async () => {
    const service = createGuiTransportService({
      config: buildConfig({ enableOverlay: true, port: 0 }),
      eventBus: new EventBus(),
      logger: null,
    });
    await service.start();

    const controller = new AbortController();
    try {
      const response = await fetch(`${getBaseUrl(service)}/gui/events`, { signal: controller.signal });
      const appearance = await createSseReader(response).readAppearance();

      expect(appearance).toMatchObject({
        __guiEvent: "appearance",
        profile: "minimal",
        revision: 0,
        settings: {
          compactRows: true,
          rowBackgroundsEnabled: false,
          maxDisplayableBadges: 3,
          memberRowTheme: "green",
          memberRowEffects: ["sheen"],
        },
      });
    } finally {
      controller.abort();
      await service.stop();
    }
  });

  it("broadcasts persisted appearance revisions to connected GUI clients", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-appearance-"));
    const appearance = await createOperatorAppearanceService({
      defaults: {
        compactRows: true,
        rowBackgroundsEnabled: false,
        maxDisplayableBadges: 1,
        memberRowTheme: "green",
        memberRowEffects: ["sheen"],
      },
      filePath: path.join(root, "appearance.json"),
    });
    const service = createGuiTransportService({
      config: buildConfig({ enableOverlay: true, port: 0 }),
      eventBus: new EventBus(),
      logger: null,
      operatorAppearance: appearance,
    });
    await service.start();
    const controller = new AbortController();

    try {
      const response = await fetch(`${getBaseUrl(service)}/gui/events`, { signal: controller.signal });
      const reader = createSseReader(response);
      expect(await reader.readAppearance()).toMatchObject({ sessionId: appearance.sessionId, revision: 0 });

      await appearance.set("memberRowTheme", "red");
      expect(await reader.readAppearance()).toMatchObject({
        sessionId: appearance.sessionId,
        revision: 1,
        settings: { memberRowTheme: "red", memberRowEffects: ["sheen"] },
      });

      await appearance.set("memberRowEffects", ["particles", "sheen"]);
      expect(await reader.readAppearance()).toMatchObject({
        sessionId: appearance.sessionId,
        revision: 2,
        settings: { memberRowTheme: "red", memberRowEffects: ["particles", "sheen"] },
      });
    } finally {
      controller.abort();
      await service.stop();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails to start when host is missing", async () => {
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      host: "   ",
      port: 0,
    });
    const service = createGuiTransportService({
      config,
      eventBus: new EventBus(),
      logger: null,
    });

    await expect(service.start()).rejects.toThrow(
      "GUI transport requires non-empty host",
    );
  });

  it("remains restartable after stop sees server close errors", async () => {
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      port: 0,
    });

    let createServerCalls = 0;
    const fakeCreateServer = () => {
      createServerCalls += 1;
      return {
        once: () => undefined,
        listen: (_port: number, _host: string, callback?: () => void) =>
          callback?.(),
        address: () => ({ address: "127.0.0.1", family: "IPv4", port: 45678 }),
        close: (callback?: (error?: Error) => void) =>
          callback?.(new Error("forced-close-failure")),
      };
    };

    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
      createServer: fakeCreateServer,
    });

    await service.start();
    await expect(service.stop()).resolves.toBeUndefined();
    await service.start();
    await expect(service.stop()).resolves.toBeUndefined();
    expect(createServerCalls).toBe(2);
    expect(service.isActive()).toBe(false);
  });

  it("shares one in-flight startup across concurrent start calls", async () => {
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      port: 0,
    });

    let subscribeCalls = 0;
    let unsubscribeCalls = 0;
    const eventBus = {
      subscribe: () => {
        subscribeCalls += 1;
        return () => {
          unsubscribeCalls += 1;
        };
      },
    };

    let createServerCalls = 0;
    const fakeCreateServer = () => {
      createServerCalls += 1;
      return {
        once: () => undefined,
        on: () => undefined,
        removeListener: () => undefined,
        listen: (_port: number, _host: string, callback?: () => void) => {
          if (callback) {
            safeSetTimeout(callback, 15);
          }
        },
        address: () => ({ address: "127.0.0.1", family: "IPv4", port: 45679 }),
        close: (callback?: (error?: Error) => void) => callback?.(),
      };
    };

    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
      createServer: fakeCreateServer,
    });

    await Promise.all([service.start(), service.start()]);
    expect(createServerCalls).toBe(1);
    expect(subscribeCalls).toBe(3);
    expect(service.isActive()).toBe(true);

    await service.stop();
    expect(unsubscribeCalls).toBe(3);
  });

  it("releases GUI SSE capacity when only the response closes", async () => {
    let requestListener: ((req: any, res: any) => void) | null = null;
    const fakeCreateServer = (listener: (req: any, res: any) => void) => {
      requestListener = listener;
      return {
        once: () => undefined,
        on: () => undefined,
        removeListener: () => undefined,
        listen: (_port: number, _host: string, callback?: () => void) => callback?.(),
        address: () => ({ address: "127.0.0.1", family: "IPv4", port: 45681 }),
        close: (callback?: (error?: Error) => void) => callback?.(),
      };
    };
    const service = createGuiTransportService({
      config: buildConfig({ enableOverlay: true, port: 0 }),
      eventBus: new EventBus(),
      logger: null,
      createServer: fakeCreateServer,
    });
    await service.start();

    const createRequest = () => Object.assign(new EventEmitter(), {
      destroyed: false,
      headers: {},
      method: "GET",
      url: "/gui/events",
    });
    const createResponse = () => Object.assign(new EventEmitter(), {
      destroyed: false,
      statusCode: 0,
      writableEnded: false,
      writableLength: 0,
      destroy() {
        this.destroyed = true;
      },
      end() {
        this.writableEnded = true;
      },
      write() {
        return true;
      },
      writeHead(statusCode: number) {
        this.statusCode = statusCode;
      },
    });
    const responses = Array.from({ length: 48 }, () => createResponse());
    for (const response of responses) {
      requestListener!(createRequest(), response);
      expect(response.statusCode).toBe(200);
    }

    const rejected = createResponse();
    requestListener!(createRequest(), rejected);
    expect(rejected.statusCode).toBe(503);

    responses[0]!.emit("close");
    const replacement = createResponse();
    requestListener!(createRequest(), replacement);
    expect(replacement.statusCode).toBe(200);

    await service.stop();
  });

  it("does not resurrect runtime-error recovery after an explicit stop", async () => {
    const bus = new EventBus();
    const servers: EventEmitter[] = [];
    let releaseClose: (() => void) | undefined;
    let closeStarted: (() => void) | undefined;
    const closing = new Promise<void>((resolve) => { closeStarted = resolve; });
    let requestListener: ((req: any, res: any) => void) | undefined;
    const service = createGuiTransportService({
      config: buildConfig({ enableOverlay: true, port: 0 }), eventBus: bus, logger: null,
      createServer: (handler) => {
        requestListener = handler;
        const index = servers.length;
        const server = Object.assign(new EventEmitter(), {
          listen: (_port: number, _host: string, callback?: () => void) => callback?.(),
          address: () => ({ address: "127.0.0.1", family: "IPv4", port: 45683 }),
          close: (callback?: (error?: Error) => void) => {
            if (index === 0) {
              releaseClose = () => callback?.();
              closeStarted!();
            } else callback?.();
          },
        });
        servers.push(server);
        return server;
      },
    });
    await service.start();
    servers[0]!.emit("error", new Error("synthetic runtime failure"));
    const recovering = service.start();
    await closing;
    const stopping = service.stop();
    releaseClose!();
    await Promise.all([recovering, stopping]);
    expect(servers).toHaveLength(1);
    expect(bus.eventNames()).toEqual([]);
    expect(service.isActive()).toBe(false);
    expect(service.getAddress()).toBeNull();
    let status = 0;
    requestListener!({ method: "GET", url: "/gui/events", headers: {} }, {
      writeHead: (code: number) => { status = code; }, end: () => undefined,
    });
    expect(status).toBe(503);

    await Promise.all([service.start(), service.start()]);
    expect(servers).toHaveLength(2);
    expect(service.isActive()).toBe(true);
    expect(bus.eventNames()).toHaveLength(3);
    await service.stop();
    expect(bus.eventNames()).toEqual([]);
  });

  it("marks transport inactive when server emits runtime error after start", async () => {
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      port: 0,
    });

    const eventBus = new EventBus();
    let runtimeErrorListener: ((error: Error) => void) | null = null;
    const fakeCreateServer = () => {
      return {
        once: () => undefined,
        on: (eventName: string, listener: (error: Error) => void) => {
          if (eventName === "error") {
            runtimeErrorListener = listener;
          }
        },
        removeListener: (
          eventName: string,
          listener: (error: Error) => void,
        ) => {
          if (eventName === "error" && runtimeErrorListener === listener) {
            runtimeErrorListener = null;
          }
        },
        listen: (_port: number, _host: string, callback?: () => void) =>
          callback?.(),
        address: () => ({ address: "127.0.0.1", family: "IPv4", port: 45680 }),
        close: (callback?: (error?: Error) => void) => callback?.(),
      };
    };

    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
      createServer: fakeCreateServer,
    });

    await service.start();
    expect(service.isActive()).toBe(true);
    requireRuntimeErrorListener(runtimeErrorListener)(
      new Error("runtime transport error"),
    );
    expect(service.isActive()).toBe(false);
    expect(service.getAddress()).toBe(null);

    await service.start();
    expect(service.isActive()).toBe(true);
    await service.stop();
  });

  it("delivers mapped rows over SSE and supports reconnect delivery", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      port,
      messageCharacterLimit: 5,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    const firstAbort = new AbortController();

    try {
      const firstResponse = await fetch(`${baseUrl}/gui/events`, {
        signal: firstAbort.signal,
      });
      expect(firstResponse.status).toBe(200);
      expect(firstResponse.headers.get("content-type")).toContain(
        "text/event-stream",
      );

      const firstReader = createSseReader(firstResponse);

      eventBus.emit("display:row", {
        type: "chat",
        platform: "twitch",
        data: {
          username: "test-user",
          userId: "test-user-id",
          message: "hello world",
          avatarUrl: "https://example.invalid/test-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });

      const firstEvent = await firstReader.readEvent();
      expect(firstEvent.type).toBe("chat");
      expect(firstEvent.text).toBe("hello");
      expect(firstEvent).not.toHaveProperty("toggleKey");
      expect(firstEvent).not.toHaveProperty("userId");

      firstAbort.abort();

      const secondAbort = new AbortController();
      try {
        const secondResponse = await fetch(`${baseUrl}/gui/events`, {
          signal: secondAbort.signal,
        });
        expect(secondResponse.status).toBe(200);
        const secondReader = createSseReader(secondResponse);

        eventBus.emit("display:row", {
          type: "platform:follow",
          platform: "twitch",
          data: {
            username: "test-follower",
            userId: "test-follower-id",
            displayMessage: "test-follower followed",
            avatarUrl: "https://example.invalid/test-follow-avatar.png",
            timestamp: "2024-01-01T00:00:01.000Z",
          },
        });

        const secondEvent = await secondReader.readEvent();
        expect(secondEvent.type).toBe("platform:follow");
        expect(secondEvent.kind).toBe("notification");
        expect(secondEvent.username).toBe("test-follower");
        expect(secondEvent).not.toHaveProperty("toggleKey");
        expect(secondEvent).not.toHaveProperty("userId");
      } finally {
        secondAbort.abort();
      }
    } finally {
      await service.stop();
    }
  });

  it("keeps real avatar resolution when notification rows arrive before chat rows", async () => {
    const eventBus = new EventBus();
    const service = createGuiTransportService({
      config: buildConfig({
        enableDock: true,
        enableOverlay: false,
        port: 0,
        messageCharacterLimit: 0,
      }),
      eventBus,
      logger: null,
    });

    await service.start();
    const baseUrl = getBaseUrl(service);
    const abort = new AbortController();

    try {
      const response = await fetch(`${baseUrl}/gui/events`, {
        signal: abort.signal,
      });
      expect(response.status).toBe(200);
      const reader = createSseReader(response);

      eventBus.emit("display:row", {
        type: "platform:follow",
        platform: "twitch",
        data: {
          username: "avatar-seed-user",
          userId: "avatar-seed-user-id",
          displayMessage: "avatar-seed-user followed",
          avatarUrl: "https://example.invalid/notification-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });

      const notificationRow = await reader.readEvent();
      expect(notificationRow.type).toBe("platform:follow");
      expect(notificationRow.avatarUrl).toBe(
        "https://example.invalid/notification-avatar.png",
      );

      eventBus.emit("display:row", {
        type: "chat",
        platform: "twitch",
        data: {
          username: "avatar-seed-user",
          userId: "avatar-seed-user-id",
          message: "hello from cache",
          timestamp: "2024-01-01T00:00:01.000Z",
        },
      });

      const chatRow = await reader.readEvent();
      expect(chatRow.type).toBe("chat");
      expect(chatRow.avatarUrl).toBe(
        "https://example.invalid/notification-avatar.png",
      );
    } finally {
      abort.abort();
      await service.stop();
    }
  });

  it("always includes avatarUrl and preserves real avatar over fallback payload rows", async () => {
    const eventBus = new EventBus();
    const service = createGuiTransportService({
      config: buildConfig({
        enableDock: true,
        enableOverlay: false,
        port: 0,
        messageCharacterLimit: 0,
      }),
      eventBus,
      logger: null,
    });

    await service.start();
    const baseUrl = getBaseUrl(service);
    const abort = new AbortController();

    try {
      const response = await fetch(`${baseUrl}/gui/events`, {
        signal: abort.signal,
      });
      expect(response.status).toBe(200);
      const reader = createSseReader(response);

      eventBus.emit("display:row", {
        type: "platform:follow",
        platform: "twitch",
        data: {
          username: "test-user",
          userId: "test-user-id",
          displayMessage: "followed",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });

      const fallbackRow = await reader.readEvent();
      expect(typeof fallbackRow.avatarUrl).toBe("string");
      expect(fallbackRow.avatarUrl).toBe(DEFAULT_AVATAR_URL);

      eventBus.emit("display:row", {
        type: "platform:share",
        platform: "twitch",
        data: {
          username: "test-user",
          userId: "test-user-id",
          avatarUrl: "https://example.invalid/real-avatar.png",
          displayMessage: "shared",
          timestamp: "2024-01-01T00:00:01.000Z",
        },
      });

      const realAvatarRow = await reader.readEvent();
      expect(realAvatarRow.avatarUrl).toBe(
        "https://example.invalid/real-avatar.png",
      );

      eventBus.emit("display:row", {
        type: "platform:follow",
        platform: "twitch",
        data: {
          username: "test-user",
          userId: "test-user-id",
          avatarUrl: DEFAULT_AVATAR_URL,
          displayMessage: "followed again",
          timestamp: "2024-01-01T00:00:02.000Z",
        },
      });

      const fallbackPayloadRow = await reader.readEvent();
      expect(fallbackPayloadRow.avatarUrl).toBe(
        "https://example.invalid/real-avatar.png",
      );

      eventBus.emit("display:row", {
        type: "chat",
        platform: "twitch",
        data: {
          username: "test-user",
          userId: "test-user-id",
          message: "hello",
          timestamp: "2024-01-01T00:00:03.000Z",
        },
      });

      const cachedChatRow = await reader.readEvent();
      expect(typeof cachedChatRow.avatarUrl).toBe("string");
      expect(cachedChatRow.avatarUrl).toBe(
        "https://example.invalid/real-avatar.png",
      );
    } finally {
      abort.abort();
      await service.stop();
    }
  });

  it("delivers gift animation effect envelopes after display rows and serves runtime media", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      showGifts: true,
      port,
      messageCharacterLimit: 0,
    });
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "gui-transport-gift-animation-"),
    );
    const mediaPath = path.join(tempDirectory, "gift.mp4");
    fs.writeFileSync(mediaPath, Buffer.from("test-mp4-content"));
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
      runtimeAssetRoots: [tempDirectory],
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    const abort = new AbortController();

    try {
      const response = await fetch(`${baseUrl}/gui/events`, {
        signal: abort.signal,
      });
      expect(response.status).toBe(200);
      const reader = createSseReader(response);

      eventBus.emit("display:row", {
        type: "platform:gift",
        platform: "tiktok",
        data: {
          username: "test-user",
          userId: "test-user-id",
          displayMessage: "test-user sent Corgi",
          avatarUrl: "https://example.invalid/test-avatar.png",
          giftType: "Corgi",
          giftCount: 1,
          amount: 299,
          currency: "coins",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });

      eventBus.emit("display:gift-animation", {
        playbackId: "test-playback-id",
        durationMs: 4000,
        mediaFilePath: mediaPath,
        mediaContentType: "video/mp4",
        animationConfig: {
          profileName: "portrait",
          sourceWidth: 960,
          sourceHeight: 864,
          renderWidth: 480,
          renderHeight: 854,
          rgbFrame: [0, 0, 480, 854],
          aFrame: [480, 0, 480, 854],
        },
      });

      const rowEvent = await reader.readEvent();
      const effectEvent = await reader.readEvent();

      expect(rowEvent.type).toBe("platform:gift");
      expect(effectEvent.__guiEvent).toBe("effect");
      expect(effectEvent.effectType).toBe("tiktok-gift-animation");
      expect(effectEvent.playbackId).toBe("test-playback-id");
      expect(effectEvent.assetUrl).toMatch(/^\/gui\/runtime\/[a-f0-9]+\.mp4$/);
      expect(effectEvent.config).toBeDefined();

      const mediaResponse = await fetch(`${baseUrl}${effectEvent.assetUrl}`);
      expect(mediaResponse.status).toBe(200);
      expect(mediaResponse.headers.get("x-content-type-options")).toBe(
        "nosniff",
      );
      expect(mediaResponse.headers.get("content-type")).toContain("video/mp4");
      expect(mediaResponse.headers.get("accept-ranges")).toBe("bytes");

      const rangeResponse = await fetch(`${baseUrl}${effectEvent.assetUrl}`, {
        headers: {
          Range: "bytes=0-3",
        },
      });
      expect(rangeResponse.status).toBe(206);
      expect(rangeResponse.headers.get("content-range")).toMatch(
        /^bytes 0-3\//,
      );
      const chunk = Buffer.from(await rangeResponse.arrayBuffer()).toString(
        "utf8",
      );
      expect(chunk).toBe("test");
    } finally {
      abort.abort();
      await service.stop();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("returns 416 for malformed or unsatisfiable runtime asset ranges", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      showGifts: true,
      port,
      messageCharacterLimit: 0,
    });
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "gui-transport-gift-animation-range-"),
    );
    const mediaPath = path.join(tempDirectory, "gift.mp4");
    fs.writeFileSync(mediaPath, Buffer.from("test-mp4-content"));
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
      runtimeAssetRoots: [tempDirectory],
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    const abort = new AbortController();
    try {
      const response = await fetch(`${baseUrl}/gui/events`, {
        signal: abort.signal,
      });
      expect(response.status).toBe(200);
      const reader = createSseReader(response);

      eventBus.emit("display:gift-animation", {
        playbackId: "test-range-playback-id",
        durationMs: 4000,
        mediaFilePath: mediaPath,
        mediaContentType: "video/mp4",
        animationConfig: {
          profileName: "portrait",
          sourceWidth: 960,
          sourceHeight: 864,
          renderWidth: 480,
          renderHeight: 854,
          rgbFrame: [0, 0, 480, 854],
          aFrame: [480, 0, 480, 854],
        },
      });

      const effectEvent = await reader.readEvent();

      const malformedRangeResponse = await fetch(
        `${baseUrl}${effectEvent.assetUrl}`,
        {
          headers: { Range: "bytes=abc-def" },
        },
      );
      expect(malformedRangeResponse.status).toBe(416);
      expect(malformedRangeResponse.headers.get("content-range")).toMatch(
        /^bytes \*\/\d+$/,
      );

      const emptyRangeResponse = await fetch(
        `${baseUrl}${effectEvent.assetUrl}`,
        {
          headers: { Range: "bytes=-" },
        },
      );
      expect(emptyRangeResponse.status).toBe(416);
      expect(emptyRangeResponse.headers.get("content-range")).toMatch(
        /^bytes \*\/\d+$/,
      );

      const unsatisfiableRangeResponse = await fetch(
        `${baseUrl}${effectEvent.assetUrl}`,
        {
          headers: { Range: "bytes=999999-" },
        },
      );
      expect(unsatisfiableRangeResponse.status).toBe(416);
      expect(unsatisfiableRangeResponse.headers.get("content-range")).toMatch(
        /^bytes \*\/\d+$/,
      );
    } finally {
      abort.abort();
      await service.stop();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("serves zero-byte runtime assets with correct headers and rejects ranged reads", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      showGifts: true,
      port,
      messageCharacterLimit: 0,
    });
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "gui-transport-gift-animation-empty-"),
    );
    const mediaPath = path.join(tempDirectory, "gift-empty.mp4");
    fs.writeFileSync(mediaPath, Buffer.alloc(0));
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
      runtimeAssetRoots: [tempDirectory],
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    const abort = new AbortController();
    try {
      const response = await fetch(`${baseUrl}/gui/events`, {
        signal: abort.signal,
      });
      expect(response.status).toBe(200);
      const reader = createSseReader(response);

      eventBus.emit("display:gift-animation", {
        playbackId: "test-empty-playback-id",
        durationMs: 4000,
        mediaFilePath: mediaPath,
        mediaContentType: "video/mp4",
        animationConfig: {
          profileName: "portrait",
          sourceWidth: 960,
          sourceHeight: 864,
          renderWidth: 480,
          renderHeight: 854,
          rgbFrame: [0, 0, 480, 854],
          aFrame: [480, 0, 480, 854],
        },
      });

      const effectEvent = await reader.readEvent();

      const mediaResponse = await fetch(`${baseUrl}${effectEvent.assetUrl}`);
      expect(mediaResponse.status).toBe(200);
      expect(mediaResponse.headers.get("content-length")).toBe("0");
      const mediaBody = await mediaResponse.arrayBuffer();
      expect(mediaBody.byteLength).toBe(0);

      const rangedResponse = await fetch(`${baseUrl}${effectEvent.assetUrl}`, {
        headers: { Range: "bytes=0-0" },
      });
      expect(rangedResponse.status).toBe(416);
      expect(rangedResponse.headers.get("content-range")).toBe("bytes */0");
    } finally {
      abort.abort();
      await service.stop();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("rejects runtime assets that resolve outside allowed roots", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const allowedRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "gui-transport-allowed-"),
    );
    let blockedRoot: string | undefined;
    let service: ReturnType<typeof createGuiTransportService> | undefined;
    let reader: ReturnType<typeof createSseReader> | undefined;
    let response: Response | undefined;
    const abort = new AbortController();

    try {
      blockedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gui-transport-blocked-"));
      const blockedMediaPath = path.join(blockedRoot, "gift.mp4");
      fs.writeFileSync(blockedMediaPath, Buffer.from("synthetic-blocked-media"));
      const config = buildConfig({
        enableDock: true,
        enableOverlay: false,
        showGifts: true,
        port,
        messageCharacterLimit: 0,
      });
      service = createGuiTransportService({ config, eventBus, logger: null, runtimeAssetRoots: [allowedRoot] });
      await service.start();
      const baseUrl = getBaseUrl(service);
      response = await fetch(`${baseUrl}/gui/events`, {
        signal: abort.signal,
      });
      expect(response.status).toBe(200);
      reader = createSseReader(response);

      eventBus.emit("display:gift-animation", {
        playbackId: "blocked-playback-id",
        durationMs: 4000,
        mediaFilePath: blockedMediaPath,
        mediaContentType: "video/mp4",
        animationConfig: {
          profileName: "portrait",
          sourceWidth: 960,
          sourceHeight: 864,
          renderWidth: 480,
          renderHeight: 854,
          rgbFrame: [0, 0, 480, 854],
          aFrame: [480, 0, 480, 854],
        },
      });

      eventBus.emit("display:row", {
        type: "chat",
        platform: "twitch",
        data: {
          username: "synthetic-sentinel-user",
          userId: "synthetic-sentinel-id",
          message: "synthetic-allowed-sentinel",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });
      const nextEvent = await reader.readEvent();
      expect(nextEvent.type).toBe("chat");
      expect(nextEvent.text).toBe("synthetic-allowed-sentinel");
    } finally {
      try {
        if (reader) await reader.cancel();
        else await response?.body?.cancel();
      } finally {
        abort.abort();
        try {
          await service?.stop();
        } finally {
          try {
            if (blockedRoot) fs.rmSync(blockedRoot, { recursive: true, force: true });
          } finally {
            fs.rmSync(allowedRoot, { recursive: true, force: true });
          }
        }
      }
    }
  });

  it("enforces runtime asset max entries without exceeding cap", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      showGifts: true,
      port,
      messageCharacterLimit: 0,
    });
    const tempDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "gui-transport-runtime-cap-"),
    );
    const mediaPath = path.join(tempDirectory, "gift.mp4");
    fs.writeFileSync(mediaPath, Buffer.from("test-mp4-content"));
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
      runtimeAssetRoots: [tempDirectory],
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    const abort = new AbortController();

    try {
      const response = await fetch(`${baseUrl}/gui/events`, {
        signal: abort.signal,
      });
      expect(response.status).toBe(200);
      const reader = createSseReader(response);

      const assetUrls = [];
      for (let index = 0; index < 65; index += 1) {
        eventBus.emit("display:gift-animation", {
          playbackId: `cap-playback-${index}`,
          durationMs: 4000,
          mediaFilePath: mediaPath,
          mediaContentType: "video/mp4",
          animationConfig: {
            profileName: "portrait",
            sourceWidth: 960,
            sourceHeight: 864,
            renderWidth: 480,
            renderHeight: 854,
            rgbFrame: [0, 0, 480, 854],
            aFrame: [480, 0, 480, 854],
          },
        });

        const effectEvent = await reader.readEvent();
        expect(effectEvent.__guiEvent).toBe("effect");
        assetUrls.push(effectEvent.assetUrl);
      }

      const oldestAssetResponse = await fetch(`${baseUrl}${assetUrls[0]}`);
      expect(oldestAssetResponse.status).toBe(404);

      const newestAssetResponse = await fetch(`${baseUrl}${assetUrls[64]}`);
      expect(newestAssetResponse.status).toBe(200);
    } finally {
      abort.abort();
      await service.stop();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("delivers chat parts over SSE when canonical message.parts is provided", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      port,
      messageCharacterLimit: 0,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    const abort = new AbortController();
    try {
      const response = await fetch(`${baseUrl}/gui/events`, {
        signal: abort.signal,
      });
      expect(response.status).toBe(200);

      const reader = createSseReader(response);
      eventBus.emit("display:row", {
        type: "platform:chat-message",
        platform: "tiktok",
        data: {
          username: "test-user",
          userId: "test-user-id",
          avatarUrl: "https://example.invalid/test-avatar.png",
          message: {
            text: "",
            parts: [
              {
                type: "emote",
                platform: "tiktok",
                emoteId: "1234512345",
                imageUrl: "https://example.invalid/tiktok-emote.webp",
              },
            ],
          },
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });

      const event = await reader.readEvent();
      expect(event.type).toBe("platform:chat-message");
      expect(event.parts).toEqual([
        {
          type: "emote",
          platform: "tiktok",
          emoteId: "1234512345",
          imageUrl: "https://example.invalid/tiktok-emote.webp",
        },
      ]);
    } finally {
      abort.abort();
      await service.stop();
    }
  });

  it("delivers notification parts over SSE for Twitch gift rows", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      port,
      messageCharacterLimit: 0,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    const abort = new AbortController();
    try {
      const response = await fetch(`${baseUrl}/gui/events`, {
        signal: abort.signal,
      });
      expect(response.status).toBe(200);

      const reader = createSseReader(response);
      eventBus.emit("display:row", {
        type: "platform:gift",
        platform: "twitch",
        data: {
          username: "test-twitch-user",
          userId: "test-twitch-user-id",
          avatarUrl: "https://example.invalid/twitch-avatar.png",
          displayMessage: "test-twitch-user sent 100 bits",
          parts: [
            { type: "text", text: "sent 100 " },
            {
              type: "emote",
              platform: "twitch",
              emoteId: "Cheer-100",
              imageUrl:
                "https://example.invalid/twitch/cheer-100-dark-animated-3.gif",
            },
          ],
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });

      const event = await reader.readEvent();
      expect(event.type).toBe("platform:gift");
      expect(event.parts).toEqual([
        { type: "text", text: "sent 100 " },
        {
          type: "emote",
          platform: "twitch",
          emoteId: "Cheer-100",
          imageUrl:
            "https://example.invalid/twitch/cheer-100-dark-animated-3.gif",
        },
      ]);
    } finally {
      abort.abort();
      await service.stop();
    }
  });

  it("delivers notification parts over SSE for YouTube Super Sticker rows", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      port,
      messageCharacterLimit: 0,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    const abort = new AbortController();
    try {
      const response = await fetch(`${baseUrl}/gui/events`, {
        signal: abort.signal,
      });
      expect(response.status).toBe(200);

      const reader = createSseReader(response);
      eventBus.emit("display:row", {
        type: "platform:gift",
        platform: "youtube",
        data: {
          username: "test-youtube-user",
          userId: "test-youtube-user-id",
          avatarUrl: "https://example.invalid/youtube-avatar.png",
          displayMessage: "test-youtube-user sent a A$7.99 Super Sticker",
          parts: [
            {
              type: "emote",
              platform: "youtube",
              emoteId: "supersticker",
              imageUrl:
                "https://lh3.googleusercontent.com/test-supersticker=s176-rwa",
            },
            { type: "text", text: " Test sticker description" },
          ],
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });

      const event = await reader.readEvent();
      expect(event.type).toBe("platform:gift");
      expect(event.parts).toEqual([
        {
          type: "emote",
          platform: "youtube",
          emoteId: "supersticker",
          imageUrl:
            "https://lh3.googleusercontent.com/test-supersticker=s176-rwa",
        },
        { type: "text", text: " Test sticker description" },
      ]);
    } finally {
      abort.abort();
      await service.stop();
    }
  });

  it("delivers canonical badgeImages over SSE for chat rows", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      port,
      messageCharacterLimit: 0,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    const abort = new AbortController();
    try {
      const response = await fetch(`${baseUrl}/gui/events`, {
        signal: abort.signal,
      });
      expect(response.status).toBe(200);

      const reader = createSseReader(response);
      eventBus.emit("display:row", {
        type: "platform:chat-message",
        platform: "youtube",
        data: {
          username: "test-user",
          userId: "test-user-id",
          avatarUrl: "https://example.invalid/test-avatar.png",
          message: { text: "hello" },
          badgeImages: [
            {
              imageUrl: "https://example.invalid/badge-1.png",
              source: "youtube",
              label: "member",
            },
            {
              imageUrl: "https://example.invalid/badge-1.png",
              source: "youtube",
              label: "dupe",
            },
          ],
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });

      const event = await reader.readEvent();
      expect(event.badgeImages).toEqual([
        {
          imageUrl: "https://example.invalid/badge-1.png",
          source: "youtube",
          label: "member",
        },
      ]);
    } finally {
      abort.abort();
      await service.stop();
    }
  });

  it("returns disabled dock shell and enabled overlay shell", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: false,
      enableOverlay: true,
      port,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    try {
      const dockResponse = await fetch(`${baseUrl}/dock`);
      const dockHtml = await dockResponse.text();
      expect(dockResponse.status).toBe(200);
      expect(dockResponse.headers.get("cache-control")).toContain("no-cache");
      expect(dockHtml).toContain("Dock disabled");
      expect(dockHtml).toContain('data-gui-disabled="true"');
      expect(dockHtml).not.toContain("/gui/events");

      const overlayResponse = await fetch(`${baseUrl}/overlay`);
      const overlayHtml = await overlayResponse.text();
      expect(overlayResponse.status).toBe(200);
      expect(overlayResponse.headers.get("cache-control")).toContain(
        "no-cache",
      );
      expect(overlayHtml).toContain("/gui/events");

      const tiktokAnimationsResponse = await fetch(
        `${baseUrl}/tiktok-animations`,
      );
      const tiktokAnimationsHtml = await tiktokAnimationsResponse.text();
      expect(tiktokAnimationsResponse.status).toBe(200);
      expect(tiktokAnimationsResponse.headers.get("cache-control")).toContain(
        "no-cache",
      );
      expect(tiktokAnimationsHtml).toContain("/gui/events");
      expect(tiktokAnimationsHtml).toContain("/gui/assets/dock.js");
      expect(tiktokAnimationsHtml).toContain('data-kind="tiktok-animations"');
      expect(tiktokAnimationsHtml).toContain("background:transparent");
    } finally {
      await service.stop();
    }
  });

  it("serves the active goal page for GET and HEAD with standard and minimal variants", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gui-goal-route-"));
    const fundingGoal = await createFundingGoalService({
      config: { enabled: true, id: "controller", label: "Goal", targetUsd: 100 },
      monetizationValuesConfig: { tiktokGiftUnitUsd: 0.005, twitchBitUsd: 0.01, youtubeJewelUsd: 0.005, tiktokMembershipUsd: 2.10, twitchMembershipUsd: 3.50, youtubeMembershipUsd: 3.89 }, filePath: path.join(root, "funding-goal.json")
    });
    const service = createGuiTransportService({ config: buildConfig({ enableOverlay: true, port: 0 }), eventBus: new EventBus(), fundingGoal, logger: null });
    await service.start();
    try {
      const baseUrl = getBaseUrl(service);
      for (const query of ["", "?appearance=minimal", "?appearance=invalid", "?appearance=minimal&appearance=minimal"]) {
        const response = await fetch(`${baseUrl}/goal${query}`);
        const html = await response.text();
        expect(response.status).toBe(200);
        expect(html).toContain('/gui/assets/goal.js');
        expect(html).toContain(`"profile":"${query === "?appearance=minimal" ? "minimal" : "standard"}`);
      }
      const head = await fetch(`${baseUrl}/goal`, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe('');
      const overlay = await (await fetch(`${baseUrl}/overlay`)).text();
      expect(overlay).not.toContain('/gui/assets/goal.js');
    } finally {
      await service.stop();
      fundingGoal.dispose();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports goal readiness only for an enabled funding snapshot and keeps disabled route conventions", async () => {
    const fundingGoal = { snapshot: { enabled: false }, subscribe: () => () => {}, adjust: async () => {}, setTotal: async () => {} } as any;
    const service = createGuiTransportService({ config: buildConfig({ enableDock: true, port: 0 }), eventBus: new EventBus(), fundingGoal, logger: null });
    await service.start();
    try {
      const baseUrl = getBaseUrl(service);
      expect((await (await fetch(`${baseUrl}/health?route=/goal`)).json()).ok).toBe(false);
      const response = await fetch(`${baseUrl}/goal`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Funding goal disabled');
    } finally {
      await service.stop();
    }
  });

  it("serves a CORS-enabled GUI health check for OBS wrapper readiness", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: false,
      enableOverlay: true,
      port,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    try {
      const response = await fetch(`${baseUrl}/health`);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(response.headers.get("cache-control")).toContain("no-cache");
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(body).toEqual({
        ok: true,
        service: "stream-sync-gui",
        route: null,
      });
    } finally {
      await service.stop();
    }
  });

  it("returns 405 with Allow header for non-GET GUI routes", async () => {
    const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gui-method-assets-"));
    const assetsDir = path.join(assetsRoot, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "dock.js"), 'console.log("dock");');

    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: true,
      port,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
      assetsRoot,
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    try {
      for (const route of [
        "/health",
        "/dock",
        "/overlay",
        "/notifications",
        "/tiktok-animations",
        "/gui/assets/dock.js",
        "/gui/events",
      ]) {
        const response = await fetch(`${baseUrl}${route}`, { method: "POST" });
        const body = await response.text();

        expect(response.status).toBe(405);
        expect(response.headers.get("allow")).toBe("GET, HEAD");
        expect(body).toContain("Method Not Allowed");
      }
    } finally {
      await service.stop();
      fs.rmSync(assetsRoot, { recursive: true, force: true });
    }
  });

  it("allows HEAD for readable GUI routes without opening SSE clients", async () => {
    const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gui-head-assets-"));
    const assetsDir = path.join(assetsRoot, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "dock.js"), 'console.log("dock");');

    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: true,
      port,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
      assetsRoot,
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    try {
      for (const route of [
        "/health",
        "/dock",
        "/overlay",
        "/notifications",
        "/tiktok-animations",
        "/gui/assets/dock.js",
        "/gui/events",
      ]) {
        const response = await fetch(`${baseUrl}${route}`, { method: "HEAD" });
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(body).toBe("");
      }
    } finally {
      await service.stop();
      fs.rmSync(assetsRoot, { recursive: true, force: true });
    }
  });

  it("reports route-specific GUI readiness for OBS wrappers", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const normalConfig = buildConfig({
      enableDock: true,
      enableOverlay: true,
      port,
    });
    const normalService = createGuiTransportService({
      config: normalConfig,
      eventBus,
      logger: null,
    });
    await normalService.start();

    try {
      const baseUrl = getBaseUrl(normalService);
      const overlay = await fetch(`${baseUrl}/health?route=/overlay`);
      const dock = await fetch(`${baseUrl}/health?route=/dock`);
      const tiktokAnimations = await fetch(
        `${baseUrl}/health?route=/tiktok-animations`,
      );
      const notifications = await fetch(`${baseUrl}/health?route=/notifications`);
      const demo = await fetch(`${baseUrl}/health?route=/demo`);

      expect(await overlay.json()).toEqual({
        ok: true,
        service: "stream-sync-gui",
        route: "/overlay",
      });
      expect(await dock.json()).toEqual({
        ok: true,
        service: "stream-sync-gui",
        route: "/dock",
      });
      expect(await tiktokAnimations.json()).toEqual({
        ok: true,
        service: "stream-sync-gui",
        route: "/tiktok-animations",
      });
      expect(await notifications.json()).toEqual({
        ok: false,
        service: "stream-sync-gui",
        route: "/notifications",
      });
      expect(await demo.json()).toEqual({
        ok: false,
        service: "stream-sync-gui",
        route: "/demo",
      });
    } finally {
      await normalService.stop();
    }
  });

  it("reports demo-only route readiness for OBS wrappers", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const demoConfig = buildConfig({
      enableDock: false,
      enableOverlay: false,
      port,
    });
    const demoService = createGuiTransportService({
      config: demoConfig,
      eventBus,
      logger: null,
      demoOnly: true,
    });
    await demoService.start();

    try {
      const baseUrl = getBaseUrl(demoService);
      const demo = await fetch(`${baseUrl}/health?route=/demo`);
      const overlay = await fetch(`${baseUrl}/health?route=/overlay`);

      expect(await demo.json()).toEqual({
        ok: true,
        service: "stream-sync-gui",
        route: "/demo",
      });
      expect(await overlay.json()).toEqual({
        ok: false,
        service: "stream-sync-gui",
        route: "/overlay",
      });
    } finally {
      await demoService.stop();
    }
  });

  it("reports disabled GUI routes as unavailable to OBS wrappers", async () => {
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      enableNotifications: false,
      enableOperator: false,
      port: 0,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
    });
    await service.start();

    try {
      const baseUrl = getBaseUrl(service);
      const readiness = async (route: string) => {
        return (await (await fetch(`${baseUrl}/health?route=${route}`)).json()).ok;
      };

      expect(await readiness("/dock")).toBe(true);
      expect(await readiness("/overlay")).toBe(false);
      expect(await readiness("/notifications")).toBe(false);
      expect(await readiness("/operator")).toBe(false);
      expect(await readiness("/tiktok-animations")).toBe(true);
    } finally {
      await service.stop();
    }
  });

  it("returns enabled dock shell and disabled overlay shell", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      port,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    try {
      const dockResponse = await fetch(`${baseUrl}/dock`);
      const dockHtml = await dockResponse.text();
      expect(dockResponse.status).toBe(200);
      expect(dockResponse.headers.get("cache-control")).toContain("no-cache");
      expect(dockHtml).toContain("/gui/events");

      const overlayResponse = await fetch(`${baseUrl}/overlay`);
      const overlayHtml = await overlayResponse.text();
      expect(overlayResponse.status).toBe(200);
      expect(overlayResponse.headers.get("cache-control")).toContain(
        "no-cache",
      );
      expect(overlayHtml).toContain("Overlay disabled");
      expect(overlayHtml).toContain('data-gui-disabled="true"');
      expect(overlayHtml).not.toContain("/gui/events");

      const tiktokAnimationsResponse = await fetch(
        `${baseUrl}/tiktok-animations`,
      );
      const tiktokAnimationsHtml = await tiktokAnimationsResponse.text();
      expect(tiktokAnimationsResponse.status).toBe(200);
      expect(tiktokAnimationsResponse.headers.get("cache-control")).toContain(
        "no-cache",
      );
      expect(tiktokAnimationsHtml).toContain("/gui/events");
      expect(tiktokAnimationsHtml).toContain("/gui/assets/dock.js");
      expect(tiktokAnimationsHtml).toContain('data-kind="tiktok-animations"');
      expect(tiktokAnimationsHtml).toContain("background:transparent");
    } finally {
      await service.stop();
    }
  });

  it("embeds overlay queue and line-clamp config into enabled overlay page", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: false,
      enableOverlay: true,
      overlayMaxMessages: 7,
      overlayMaxLinesPerMessage: 4,
      port,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    try {
      const response = await fetch(`${baseUrl}/overlay`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('"overlayMaxMessages":7');
      expect(html).toContain('"overlayMaxLinesPerMessage":4');
    } finally {
      await service.stop();
    }
  });

  it("resolves minimal appearance and maxMessages independently for each overlay URL", async () => {
    const service = createGuiTransportService({
      config: buildConfig({
        enableOverlay: true,
        overlayMaxMessages: 3,
        minimalOverlayMaxMessages: 6,
        port: 0,
      }),
      eventBus: new EventBus(),
      logger: null,
    });
    await service.start();

    try {
      const baseUrl = getBaseUrl(service);
      const standardHtml = await (await fetch(`${baseUrl}/overlay`)).text();
      const minimalHtml = await (await fetch(`${baseUrl}/overlay?appearance=minimal`)).text();
      const overriddenHtml = await (await fetch(`${baseUrl}/overlay?appearance=minimal&maxMessages=12`)).text();

      expect(standardHtml).toContain('"profile":"standard"');
      expect(standardHtml).toContain('"overlayMaxMessages":3');
      expect(minimalHtml).toContain('"profile":"minimal"');
      expect(minimalHtml).toContain('"overlayMaxMessages":6');
      expect(overriddenHtml).toContain('"overlayMaxMessages":12');
    } finally {
      await service.stop();
    }
  });

  it("serves the independently enabled notifications route through the dock bundle", async () => {
    const service = createGuiTransportService({
      config: buildConfig({
        enableNotifications: true,
        port: 0,
      }),
      eventBus: new EventBus(),
      logger: null,
    });
    await service.start();

    try {
      const baseUrl = getBaseUrl(service);
      const response = await fetch(`${baseUrl}/notifications?appearance=minimal`);
      const html = await response.text();
      const health = await (await fetch(`${baseUrl}/health?route=/notifications`)).json() as { ok: boolean };

      expect(response.status).toBe(200);
      expect(html).toContain('data-kind="notifications"');
      expect(html).toContain('/gui/assets/dock.js');
      expect(html).toContain('"profile":"minimal"');
      expect(health.ok).toBe(true);
    } finally {
      await service.stop();
    }
  });

  it("emits numeric overlay runtime config defaults instead of numeric strings", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: false,
      enableOverlay: true,
      overlayMaxMessages: "7",
      overlayMaxLinesPerMessage: "4",
      port,
    } as any);
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    try {
      const response = await fetch(`${baseUrl}/overlay`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('"overlayMaxMessages":6');
      expect(html).toContain('"overlayMaxLinesPerMessage":3');
      expect(html).not.toContain('"overlayMaxMessages":"7"');
      expect(html).not.toContain('"overlayMaxLinesPerMessage":"4"');
    } finally {
      await service.stop();
    }
  });

  it("serves isolated demo shell only when demo mode is enabled", async () => {
    const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gui-demo-assets-"));
    const assetsDir = path.join(assetsRoot, "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "demo.js"), 'console.log("demo");');
    fs.writeFileSync(path.join(assetsDir, "styles.css"), ".demo{display:block}");

    const port = 0;
    const eventBus = new EventBus();
    const normalConfig = buildConfig({
      enableDock: true,
      enableOverlay: false,
      port,
    });
    const normalService = createGuiTransportService({
      config: normalConfig,
      eventBus,
      logger: null,
      assetsRoot,
    });
    await normalService.start();

    try {
      const baseUrl = getBaseUrl(normalService);
      const demoResponse = await fetch(`${baseUrl}/demo`);
      const demoHtml = await demoResponse.text();
      expect(demoResponse.status).toBe(404);
      expect(demoHtml).toContain("Not Found");
    } finally {
      await normalService.stop();
    }

    const demoConfig = buildConfig({
      enableDock: false,
      enableOverlay: false,
      port,
    });
    const demoService = createGuiTransportService({
      config: demoConfig,
      eventBus,
      logger: null,
      assetsRoot,
      demoOnly: true,
    });
    await demoService.start();

    const baseUrl = getBaseUrl(demoService);
    try {
      const demoResponse = await fetch(`${baseUrl}/demo`);
      const demoHtml = await demoResponse.text();
      expect(demoResponse.status).toBe(200);
      expect(demoResponse.headers.get("cache-control")).toContain("no-cache");
      expect(demoHtml).toContain("Stream Sync Demo");
      expect(demoHtml).toContain('data-kind="demo"');
      expect(demoHtml).not.toContain("/gui/events");
      expect(demoHtml).toContain("/gui/assets/demo.js");
      expect(demoHtml).toContain("/gui/assets/styles.css");

      const demoScriptResponse = await fetch(`${baseUrl}/gui/assets/demo.js`);
      const demoScriptBody = await demoScriptResponse.text();
      expect(demoScriptResponse.status).toBe(200);
      expect(demoScriptResponse.headers.get("content-type")).toContain(
        "application/javascript",
      );
      expect(demoScriptBody).toContain('console.log("demo")');

      const dockResponse = await fetch(`${baseUrl}/dock`);
      expect(dockResponse.status).toBe(404);

      const eventsResponse = await fetch(`${baseUrl}/gui/events`);
      expect(eventsResponse.status).toBe(404);
    } finally {
      await demoService.stop();
      fs.rmSync(assetsRoot, { recursive: true, force: true });
    }
  });

  it("serves enabled dock, overlay, and tiktok animations pages with built GUI asset entry paths", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: true,
      overlayMaxMessages: 7,
      overlayMaxLinesPerMessage: 4,
      port,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
    });
    await service.start();

    const baseUrl = getBaseUrl(service);
    try {
      const dockResponse = await fetch(`${baseUrl}/dock`);
      const dockHtml = await dockResponse.text();
      expect(dockResponse.status).toBe(200);
      expect(dockResponse.headers.get("cache-control")).toContain("no-cache");
      expect(dockHtml).toContain("/gui/assets/dock.js");
      expect(dockHtml).toContain("/gui/assets/styles.css");

      const overlayResponse = await fetch(`${baseUrl}/overlay`);
      const overlayHtml = await overlayResponse.text();
      expect(overlayResponse.status).toBe(200);
      expect(overlayResponse.headers.get("cache-control")).toContain(
        "no-cache",
      );
      expect(overlayHtml).toContain("/gui/assets/overlay.js");
      expect(overlayHtml).toContain("/gui/assets/styles.css");

      const tiktokAnimationsResponse = await fetch(
        `${baseUrl}/tiktok-animations`,
      );
      const tiktokAnimationsHtml = await tiktokAnimationsResponse.text();
      expect(tiktokAnimationsResponse.status).toBe(200);
      expect(tiktokAnimationsResponse.headers.get("cache-control")).toContain(
        "no-cache",
      );
      expect(tiktokAnimationsHtml).toContain("/gui/assets/dock.js");
      expect(tiktokAnimationsHtml).toContain("/gui/assets/styles.css");
      expect(tiktokAnimationsHtml).toContain('data-kind="tiktok-animations"');
      expect(tiktokAnimationsHtml).toContain("background:transparent");
    } finally {
      await service.stop();
    }
  });

  it("serves built GUI assets and returns 404 for missing assets", async () => {
    const assetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gui-assets-"));
    const assetsDir = path.join(assetsRoot, "assets");
    const imagesDir = path.join(assetsDir, "images");
    const siblingDir = path.join(assetsRoot, "assets2");
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.mkdirSync(siblingDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "dock.js"), 'console.log("dock");');
    fs.writeFileSync(
      path.join(assetsDir, "styles.css"),
      ".gui-row__avatar{width:24px;height:24px}",
    );
    fs.writeFileSync(
      path.join(imagesDir, "test-image.png"),
      "test-image",
    );
    fs.writeFileSync(
      path.join(siblingDir, "secret.js"),
      'console.log("secret");',
    );

    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      port,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
      assetsRoot,
    });

    await service.start();

    const baseUrl = getBaseUrl(service);
    try {
      const presentResponse = await fetch(`${baseUrl}/gui/assets/dock.js`);
      const presentBody = await presentResponse.text();
      expect(presentResponse.status).toBe(200);
      expect(presentBody).toContain('console.log("dock")');

      const queryResponse = await fetch(`${baseUrl}/gui/assets/dock.js?v=1`);
      const queryBody = await queryResponse.text();
      expect(queryResponse.status).toBe(200);
      expect(queryBody).toContain('console.log("dock")');

      const stylesResponse = await fetch(`${baseUrl}/gui/assets/styles.css`);
      const stylesBody = await stylesResponse.text();
      expect(stylesResponse.status).toBe(200);
      expect(stylesResponse.headers.get("content-type")).toContain("text/css");
      expect(stylesResponse.headers.get("cache-control")).toContain("no-cache");
      expect(stylesBody).toContain(".gui-row__avatar");

      const imageResponse = await fetch(
        `${baseUrl}/gui/assets/images/test-image.png`,
      );
      const imageBody = await imageResponse.text();
      expect(imageResponse.status).toBe(200);
      expect(imageResponse.headers.get("content-type")).toContain(
        "image/png",
      );
      expect(imageBody).toContain("test-image");

      const missingResponse = await fetch(`${baseUrl}/gui/assets/missing.js`);
      const missingBody = await missingResponse.text();
      expect(missingResponse.status).toBe(404);
      expect(missingBody).toContain("Not Found");

      const encodedTraversalResponse = await fetch(
        `${baseUrl}/gui/assets/%2e%2e/assets2/secret.js`,
      );
      const encodedTraversalBody = await encodedTraversalResponse.text();
      expect(encodedTraversalResponse.status).toBe(404);
      expect(encodedTraversalBody).toContain("Not Found");

      const malformedResponse = await fetch(
        `${baseUrl}/gui/assets/%E0%A4%A.js`,
      );
      const malformedBody = await malformedResponse.text();
      expect(malformedResponse.status).toBe(404);
      expect(malformedBody).toContain("Not Found");
    } finally {
      await service.stop();
      fs.rmSync(assetsRoot, { recursive: true, force: true });
    }
  });

  it("rejects a row queued before stop and delivers a fresh row after restart", async () => {
    const port = 0;
    const eventBus = new EventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      port,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
    });

    try {
      await service.start();
      eventBus.emit("display:row", {
        type: "chat",
        platform: "twitch",
        data: {
          username: "test-user-stale",
          userId: "test-user-stale-id",
          message: "stale-message",
          avatarUrl: "https://example.invalid/stale-avatar.png",
          timestamp: "2024-01-01T00:00:00.000Z",
        },
      });

      await service.stop();
      await service.start();

      const baseUrl = getBaseUrl(service);
      const abortController = new AbortController();
      try {
        const response = await fetch(`${baseUrl}/gui/events`, {
          signal: abortController.signal,
        });
        expect(response.status).toBe(200);
        const reader = createSseReader(response);

        eventBus.emit("display:row", {
          type: "chat",
          platform: "twitch",
          data: {
            username: "test-user-fresh",
            userId: "test-user-fresh-id",
            message: "fresh-message",
            avatarUrl: "https://example.invalid/fresh-avatar.png",
            timestamp: "2024-01-01T00:00:01.000Z",
          },
        });

        const freshEvent = await reader.readEvent();
        expect(freshEvent.username).toBe("test-user-fresh");
        expect(freshEvent.text).toBe("fresh-message");
      } finally {
        abortController.abort();
      }
    } finally {
      await service.stop();
    }
  });

  it("activates only when dock or overlay is enabled", async () => {
    const inactiveConfig = buildConfig({
      enableDock: false,
      enableOverlay: false,
      port: 0,
    });
    const inactiveService = createGuiTransportService({
      config: inactiveConfig,
      eventBus: new EventBus(),
      logger: null,
    });
    await inactiveService.start();
    try {
      expect(inactiveService.isActive()).toBe(false);
      expect(inactiveService.getAddress()).toBe(null);
    } finally {
      await inactiveService.stop();
    }

    const dockConfig = buildConfig({
      enableDock: true,
      enableOverlay: false,
      port: 0,
    });
    const dockService = createGuiTransportService({
      config: dockConfig,
      eventBus: new EventBus(),
      logger: null,
    });
    await dockService.start();
    try {
      expect(dockService.isActive()).toBe(true);
      expect(dockService.getAddress()).not.toBe(null);
    } finally {
      await dockService.stop();
    }

    const overlayConfig = buildConfig({
      enableDock: false,
      enableOverlay: true,
      port: 0,
    });
    const overlayService = createGuiTransportService({
      config: overlayConfig,
      eventBus: new EventBus(),
      logger: null,
    });
    await overlayService.start();
    try {
      expect(overlayService.isActive()).toBe(true);
      expect(overlayService.getAddress()).not.toBe(null);
    } finally {
      await overlayService.stop();
    }
  });

  it("applies each show* toggle independently without suppressing other event types", async () => {
    const toggleCases = [
      { toggleKey: "showMessages", blockedType: "chat" },
      { toggleKey: "showCommands", blockedType: "command" },
      { toggleKey: "showGreetings", blockedType: "greeting" },
      { toggleKey: "showFarewells", blockedType: "farewell" },
      { toggleKey: "showFollows", blockedType: "platform:follow" },
      { toggleKey: "showShares", blockedType: "platform:share" },
      { toggleKey: "showRaids", blockedType: "platform:raid" },
      { toggleKey: "showGifts", blockedType: "platform:gift" },
      { toggleKey: "showPaypiggies", blockedType: "platform:paypiggy" },
      { toggleKey: "showGiftPaypiggies", blockedType: "platform:giftpaypiggy" },
      { toggleKey: "showEnvelopes", blockedType: "platform:envelope" },
    ];

    const createRow = (type: string, suffix: number) => {
      const base: any = {
        type,
        platform: "twitch",
        data: {
          username: `test-user-${suffix}`,
          userId: `test-user-id-${suffix}`,
          avatarUrl: `https://example.invalid/avatar-${suffix}.png`,
          timestamp: `2024-01-01T00:00:${String(suffix).padStart(2, "0")}.000Z`,
        },
      };

      if (type === "chat" || type === "platform:chat-message") {
        base.data.message = `message-${suffix}`;
        return base;
      }

      base.data.displayMessage = `display-${suffix}`;
      return base;
    };

    for (let index = 0; index < toggleCases.length; index += 1) {
      const toggleCase = toggleCases[index]!;
      const controlType =
        toggleCase.blockedType === "platform:follow"
          ? "platform:share"
          : "platform:follow";
      const port = 0;
      const eventBus = new EventBus();
      const config = buildConfig({
        enableDock: true,
        enableOverlay: false,
        port,
        [toggleCase.toggleKey]: false,
      });
      const service = createGuiTransportService({
        config,
        eventBus,
        logger: null,
      });
      await service.start();

      const baseUrl = getBaseUrl(service);
      const abortController = new AbortController();
      try {
        const response = await fetch(`${baseUrl}/gui/events`, {
          signal: abortController.signal,
        });
        expect(response.status).toBe(200);
        const reader = createSseReader(response);

        eventBus.emit("display:row", createRow(toggleCase.blockedType, index));
        eventBus.emit("display:row", createRow(controlType, index + 100));

        const event = await reader.readEvent();
        expect(event.type).toBe(controlType);
        expect(event.text).toContain(`display-${index + 100}`);
      } finally {
        abortController.abort();
        await service.stop();
      }
    }
  });
  it("serves the opt-in normalized chat feed independently", async () => {
    const service = createGuiTransportService({
      config: buildConfig({ enableChatFeed: true, port: 0 }),
      eventBus: new EventBus(),
      logger: null,
    });
    await service.start();
    const abortController = new AbortController();
    try {
      const baseUrl = getBaseUrl(service);
      const response = await fetch(`${baseUrl}/api/v1/chat/events`, {
        signal: abortController.signal,
      });
      expect(response.status).toBe(200);
      const reader = createSseReader(response);
      service.publishChatMessage("twitch", {
        username: "viewer",
        userId: "user-1",
        isMod: false,
        isBroadcaster: false,
        timestamp: "2026-08-09T16:30:00.000Z",
        message: { text: "<b>a</b>\u200b" },
      });
      const event = await reader.readEvent();
      expect(event.type).toBe("chat.message");
      expect(event.schemaVersion).toBe(1);
      expect(Object.keys(event).sort()).toEqual([
        "eventId",
        "message",
        "occurredAt",
        "platform",
        "receivedAt",
        "schemaVersion",
        "type",
        "user",
      ]);
      expect(event.platform).toBe("twitch");
      expect(event.user).toEqual({ displayName: "viewer", isModerator: false, isBroadcaster: false, id: "user-1" });
      expect(event.message).toEqual({ text: "<b>a</b>\u200b" });
      expect(response.url).toContain("/api/v1/chat/events");

      service.publishChatMessage("twitch", {
        username: "viewer",
        timestamp: "not-a-timestamp",
        message: { text: "a" },
      });
      const fallbackTimestampEvent = await reader.readEvent();
      expect(fallbackTimestampEvent.occurredAt).toBe(
        fallbackTimestampEvent.receivedAt,
      );
    } finally {
      abortController.abort();
      await service.stop();
    }
  });

  it("does not expose the chat feed when it is disabled", async () => {
    const service = createGuiTransportService({
      config: buildConfig({ enableDock: true, port: 0 }),
      eventBus: new EventBus(),
      logger: null,
    });
    await service.start();

    try {
      const response = await fetch(`${getBaseUrl(service)}/api/v1/chat/events`);
      expect(response.status).toBe(404);
    } finally {
      await service.stop();
    }
  });

  it("rejects chat feed requests with an Origin header", async () => {
    const service = createGuiTransportService({
      config: buildConfig({ enableChatFeed: true, port: 0 }),
      eventBus: new EventBus(),
      logger: null,
    });
    await service.start();

    try {
      const response = await fetch(`${getBaseUrl(service)}/api/v1/chat/events`, {
        headers: { Origin: "https://example.invalid" },
      });
      expect(response.status).toBe(403);
    } finally {
      await service.stop();
    }
  });

  it("rejects enabled chat feed on non-loopback hosts", async () => {
    const service = createGuiTransportService({
      config: buildConfig({ enableChatFeed: true, host: "0.0.0.0", port: 0 }),
      eventBus: new EventBus(),
      logger: null,
    });

    await expect(service.start()).rejects.toThrow(
      "Chat feed requires loopback host",
    );
    expect(service.isActive()).toBe(false);
    await service.stop();
  });

  it("keeps GUI events separate from raw chat feed events", async () => {
    const eventBus = new EventBus();
    const service = createGuiTransportService({
      config: buildConfig({ enableChatFeed: true, port: 0 }),
      eventBus,
      logger: null,
    });
    await service.start();
    const guiAbort = new AbortController();
    const chatAbort = new AbortController();

    try {
      const baseUrl = getBaseUrl(service);
      const guiResponse = await fetch(`${baseUrl}/gui/events`, {
        signal: guiAbort.signal,
      });
      const chatResponse = await fetch(`${baseUrl}/api/v1/chat/events`, {
        signal: chatAbort.signal,
      });
      expect(guiResponse.status).toBe(200);
      expect(chatResponse.status).toBe(200);
      const chatReader = createSseReader(chatResponse);
      const guiReader = createSseReader(guiResponse);

      service.publishChatMessage("twitch", {
        username: "viewer",
        userId: "user-1",
        timestamp: "2026-08-09T16:30:00.000Z",
        message: { text: "raw chat" },
      });

      const chatEvent = await chatReader.readEvent();
      expect(chatEvent.type).toBe("chat.message");
      eventBus.emit("display:row", { type: "chat", platform: "twitch", data: {
        username: "Synthetic GUI Sentinel", userId: "synthetic-gui-sentinel", message: "synthetic GUI-only sentinel",
        timestamp: "2026-01-01T00:00:00.000Z",
      } });
      expect(await guiReader.readEvent()).toMatchObject({ type: "chat", text: "synthetic GUI-only sentinel" });
    } finally {
      guiAbort.abort();
      chatAbort.abort();
      await service.stop();
    }
  });
  it("serves independently gated notification runtime and health route", async () => {
    const service = createGuiTransportService({
      config: buildConfig({ enableNotifications: true, port: 0 }),
      eventBus: new EventBus(),
      logger: null,
    });
    await service.start();
    try {
      const baseUrl = getBaseUrl(service);
      const response = await fetch(`${baseUrl}/notifications`);
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain('data-kind="notifications"');
      expect(html).toContain('/gui/assets/dock.js');
      expect(html).toContain('/gui/events');
      expect(html).toContain('dockFeedMode');
      expect(html).toContain('background:transparent');
      expect((await (await fetch(`${baseUrl}/health?route=/notifications`)).json()).ok).toBe(true);
    } finally {
      await service.stop();
    }
  });


  it("returns a disabled notification shell when notifications are off", async () => {
    const service = createGuiTransportService({
      config: buildConfig({ enableNotifications: false, enableDock: true, port: 0 }),
      eventBus: new EventBus(),
      logger: null,
    });
    await service.start();
    try {
      const baseUrl = getBaseUrl(service);
      const response = await fetch(`${baseUrl}/notifications`);
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain('data-gui-disabled="true"');
      expect(html).not.toContain('/gui/events');
      expect((await (await fetch(`${baseUrl}/health?route=/notifications`)).json()).ok).toBe(false);
    } finally {
      await service.stop();
    }
  });

  it("delivers validated notification lifecycle envelopes in SSE order", async () => {
    const eventBus = new EventBus();
    const service = createGuiTransportService({
      config: buildConfig({ enableNotifications: true, port: 0 }),
      eventBus,
      logger: null,
    });
    await service.start();
    const abort = new AbortController();
    try {
      const response = await fetch(`${getBaseUrl(service)}/gui/events`, { signal: abort.signal });
      const reader = createSseReader(response);
      eventBus.emit("display:notification-lifecycle", {
        eventId: "notification-event-1",
        phase: "exit-started",
        type: "platform:follow",
        platform: "twitch",
        timestamp: 1_723_650_000_000,
      });

      await expect(reader.readEvent()).resolves.toEqual({
        __guiEvent: "notification-lifecycle",
        eventId: "notification-event-1",
        phase: "exit-started",
      });
    } finally {
      abort.abort();
      await service.stop();
    }
  });

  it("accepts the first valid gift animation acknowledgement and rejects invalid requests", async () => {
    const eventBus = new EventBus();
    const playbackId = "550e8400-e29b-41d4-a716-446655440000";
    const settled: unknown[] = [];
    eventBus.on("display:gift-animation-settled", (payload) => settled.push(payload));
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "gui-gift-ack-"));
    const mediaPath = path.join(tempDirectory, "gift.mp4");
    fs.writeFileSync(mediaPath, Buffer.from("test-mp4-content"));
    const service = createGuiTransportService({
      config: buildConfig({ enableDock: true, showGifts: true, port: 0 }),
      eventBus,
      logger: null,
      runtimeAssetRoots: [tempDirectory],
    });
    await service.start();
    const abort = new AbortController();
    try {
      const baseUrl = getBaseUrl(service);
      const response = await fetch(`${baseUrl}/gui/events`, { signal: abort.signal });
      const reader = createSseReader(response);
      eventBus.emit("display:gift-animation", {
        playbackId,
        durationMs: 1000,
        mediaFilePath: mediaPath,
        mediaContentType: "video/mp4",
        animationConfig: {
          profileName: "portrait",
          sourceWidth: 960,
          sourceHeight: 864,
          renderWidth: 480,
          renderHeight: 854,
          rgbFrame: [0, 0, 480, 854],
          aFrame: [480, 0, 480, 854],
        },
      });
      expect((await reader.readEvent()).playbackId).toBe(playbackId);

      const headers = {
        Origin: baseUrl,
        "Content-Type": "application/json",
        "X-Stream-Sync-Request": "1",
      };
      const first = await fetch(`${baseUrl}/api/v1/gui/gift-animations/ack`, {
        method: "POST",
        headers,
        body: JSON.stringify({ playbackId, reason: "ended" }),
      });
      expect(first.status).toBe(200);
      expect(first.headers.get("access-control-allow-origin")).toBeNull();
      expect(await first.json()).toEqual({ first: true });
      expect(settled).toEqual([{ playbackId, reason: "ended" }]);

      const duplicate = await fetch(`${baseUrl}/api/v1/gui/gift-animations/ack`, {
        method: "POST",
        headers,
        body: JSON.stringify({ playbackId, reason: "timeout" }),
      });
      expect(await duplicate.json()).toEqual({ first: false });
      expect(settled).toHaveLength(1);

      const unknown = await fetch(`${baseUrl}/api/v1/gui/gift-animations/ack`, {
        method: "POST",
        headers,
        body: JSON.stringify({ playbackId: "a8098c1a-f86e-11da-bd1a-00112444be1e", reason: "ended" }),
      });
      expect(unknown.status).toBe(404);

      const wrongMethod = await fetch(`${baseUrl}/api/v1/gui/gift-animations/ack`, { method: "GET" });
      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.get("allow")).toBe("POST");

      const malformed = await fetch(`${baseUrl}/api/v1/gui/gift-animations/ack`, {
        method: "POST",
        headers,
        body: JSON.stringify({ playbackId, reason: "invalid" }),
      });
      expect(malformed.status).toBe(400);

      const oversized = await fetch(`${baseUrl}/api/v1/gui/gift-animations/ack`, {
        method: "POST",
        headers,
        body: "x".repeat(2049),
      });
      expect(oversized.status).toBe(413);
    } finally {
      abort.abort();
      await service.stop();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
