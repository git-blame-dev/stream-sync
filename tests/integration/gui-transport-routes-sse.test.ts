import { describe, it, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "node:events";

import { createGuiTransportService } from "../../src/services/gui/gui-transport-service";
import { DEFAULT_AVATAR_URL } from "../../src/constants/avatar";
import { safeSetTimeout } from "../../src/utils/timeout-validator";
import { TestEventBus } from "../helpers/gui-transport-test-utils";
import { createConfigFixture } from "../helpers/config-fixture";
import { createOperatorAppearanceService } from "../../src/services/operator/operator-appearance-service";
import { createFundingGoalService } from "../../src/services/funding-goal-service";

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
      eventBus: new TestEventBus(),
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

  it("skips an oversized initial funding packet without bypassing client safeguards", async () => {
    const fundingGoal = {
      snapshot: {
        currentUsd: 25,
        targetUsd: 100,
        revision: 1,
        enabled: true,
        id: "controller",
        completed: false,
        sessionId: "test-session",
        label: "x".repeat(300_000),
        labelOverridden: false,
      },
      subscribe: (listener: (snapshot: any) => void) => {
        return () => undefined;
      },
      adjust: async () => undefined,
      setTotal: async () => undefined,
    };
    const service = createGuiTransportService({
      config: buildConfig({ enableOverlay: true, port: 0 }),
      eventBus: new TestEventBus(),
      fundingGoal,
      logger: null,
    });
    await service.start();
    const controller = new AbortController();

    try {
      const response = await fetch(`${getBaseUrl(service)}/gui/events`, { signal: controller.signal });
      const reader = createSseReader(response);
      await reader.readAppearance();
      const noInitialFunding = reader.readEvent().then(() => false).catch(() => true);
      await new Promise((resolve) => safeSetTimeout(resolve, 100));
      controller.abort();
      expect(await noInitialFunding).toBe(true);
    } finally {
      controller.abort();
      await service.stop();
    }
  });

  it("sends the current minimal appearance snapshot when a GUI client connects", async () => {
    const service = createGuiTransportService({
      config: buildConfig({ enableOverlay: true, port: 0 }),
      eventBus: new TestEventBus(),
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
      eventBus: new TestEventBus(),
      logger: null,
      operatorAppearance: appearance,
    });
    await service.start();
    const controller = new AbortController();

    try {
      const response = await fetch(`${getBaseUrl(service)}/gui/events`, { signal: controller.signal });
      const reader = createSseReader(response);
      expect((await reader.readAppearance()).revision).toBe(0);

      await appearance.set("memberRowTheme", "red");
      expect(await reader.readAppearance()).toMatchObject({
        revision: 1,
        settings: { memberRowTheme: "red", memberRowEffects: ["sheen"] },
      });

      await appearance.set("memberRowEffects", ["particles", "sheen"]);
      expect(await reader.readAppearance()).toMatchObject({
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
      eventBus: new TestEventBus(),
      logger: null,
    });

    await expect(service.start()).rejects.toThrow(
      "GUI transport requires non-empty host",
    );
  });

  it("remains restartable after stop sees server close errors", async () => {
    const eventBus = new TestEventBus();
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
      eventBus: new TestEventBus(),
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

  it("marks transport inactive when server emits runtime error after start", async () => {
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      port: 0,
    });

    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
    const allowedRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "gui-transport-allowed-"),
    );
    const blockedRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "gui-transport-blocked-"),
    );
    const blockedMediaPath = path.join(blockedRoot, "gift.mp4");
    fs.writeFileSync(blockedMediaPath, Buffer.from("blocked-mp4-content"));

    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      showGifts: true,
      port,
      messageCharacterLimit: 0,
    });
    const service = createGuiTransportService({
      config,
      eventBus,
      logger: null,
      runtimeAssetRoots: [allowedRoot],
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

      let receivedEvent = false;
      reader
        .readEvent()
        .then(() => {
          receivedEvent = true;
        })
        .catch(() => {});

      await new Promise((resolve) => {
        safeSetTimeout(resolve, 300);
      });

      expect(receivedEvent).toBe(false);
    } finally {
      abort.abort();
      await service.stop();
      fs.rmSync(allowedRoot, { recursive: true, force: true });
      fs.rmSync(blockedRoot, { recursive: true, force: true });
    }
  });

  it("enforces runtime asset max entries without exceeding cap", async () => {
    const port = 0;
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const service = createGuiTransportService({ config: buildConfig({ enableOverlay: true, port: 0 }), eventBus: new TestEventBus(), fundingGoal, logger: null });
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
    const service = createGuiTransportService({ config: buildConfig({ enableDock: true, port: 0 }), eventBus: new TestEventBus(), fundingGoal, logger: null });
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
      eventBus: new TestEventBus(),
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
      eventBus: new TestEventBus(),
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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

  it("does not deliver stale queued row dispatches after stop/start", async () => {
    const port = 0;
    const eventBus = new TestEventBus();
    const config = buildConfig({
      enableDock: true,
      enableOverlay: false,
      port,
    });
    const mapper = {
      async mapDisplayRow(row: any) {
        await new Promise((resolve) => {
          safeSetTimeout(resolve, 30);
        });
        return {
          type: row.type,
          text: row.data.message,
          username: row.data.username,
          avatarUrl: row.data.avatarUrl,
          timestamp: row.data.timestamp,
        };
      },
    };

    const service = createGuiTransportService({
      config,
      eventBus,
      mapper,
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
      eventBus: new TestEventBus(),
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
      eventBus: new TestEventBus(),
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
      eventBus: new TestEventBus(),
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
      const eventBus = new TestEventBus();
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
      eventBus: new TestEventBus(),
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
      eventBus: new TestEventBus(),
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
      eventBus: new TestEventBus(),
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
      eventBus: new TestEventBus(),
      logger: null,
    });

    await expect(service.start()).rejects.toThrow(
      "Chat feed requires loopback host",
    );
    expect(service.isActive()).toBe(false);
    await service.stop();
  });

  it("keeps GUI events separate from raw chat feed events", async () => {
    const eventBus = new TestEventBus();
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
      await expect(guiReader.readEvent(300)).rejects.toThrow();
    } finally {
      guiAbort.abort();
      chatAbort.abort();
      await service.stop();
    }
  });
  it("serves independently gated notification runtime and health route", async () => {
    const service = createGuiTransportService({
      config: buildConfig({ enableNotifications: true, port: 0 }),
      eventBus: new TestEventBus(),
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
      eventBus: new TestEventBus(),
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
    const eventBus = new TestEventBus();
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
    const eventBus = new TestEventBus();
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
