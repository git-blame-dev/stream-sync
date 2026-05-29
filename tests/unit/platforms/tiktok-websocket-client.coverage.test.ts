import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { EventEmitter } from "events";
import {
  useFakeTimers,
  useRealTimers,
  advanceTimersByTime,
} from "../../helpers/bun-timers";
import { safeSetInterval } from "../../../src/utils/timeout-validator.ts";
import type { TikTokWebSocketClient as TikTokWebSocketClientInstance } from "../../../src/platforms/tiktok-websocket-client.ts";

type TikTokWebSocketClientConstructor = typeof import("../../../src/platforms/tiktok-websocket-client.ts").TikTokWebSocketClient;

type MockWebSocketConstructor = {
  new (url: string, options?: unknown): MockWebSocket;
};

type WebSocketClientOptions = {
  apiKey?: string;
  WebSocketCtor?: MockWebSocketConstructor;
};

type ConnectedEvent = { roomId?: string; isLive?: boolean };
type ReconnectingEvent = { attempt: number };
type RawEvent = { type: string; data?: unknown };

class MockWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState: number;
  pingCalled: boolean;

  constructor() {
    super();
    this.readyState = MockWebSocket.OPEN;
    this.pingCalled = false;
  }

  ping() {
    this.pingCalled = true;
  }

  close(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", code, reason);
  }
}

describe("TikTokWebSocketClient coverage", () => {
  let TikTokWebSocketClient: TikTokWebSocketClientConstructor;
  let mockWs: MockWebSocket | null;
  let client: TikTokWebSocketClientInstance;

  beforeEach(() => {
    useFakeTimers();
    ({
      TikTokWebSocketClient,
    } = require("../../../src/platforms/tiktok-websocket-client.ts"));
    mockWs = null;
  });

  afterEach(() => {
    useRealTimers();
    if (client) {
      client.autoReconnect = false;
      if (client.ws) {
        const activeSocket = client.ws;
        if (
          "removeAllListeners" in activeSocket &&
          typeof activeSocket.removeAllListeners === "function"
        ) {
          activeSocket.removeAllListeners();
        }
        client.ws = null;
      }
      client.stopPingInterval();
      client.isConnected = false;
      client.isConnecting = false;
    }
  });

  const requireMockWebSocket = (): MockWebSocket => {
    if (!mockWs) {
      throw new Error("Expected test WebSocket to be created");
    }
    return mockWs;
  };

  const requireClient = (): TikTokWebSocketClientInstance => {
    if (!client) {
      throw new Error("Expected TikTokWebSocketClient test instance");
    }
    return client;
  };

  const createClient = (username = "testuser", options: WebSocketClientOptions = {}) => {
    const CapturingWebSocket = class extends MockWebSocket {
      constructor(url: string, websocketOptions?: unknown) {
        super();
        void url;
        void websocketOptions;
        mockWs = this;
      }
    };
    client = new TikTokWebSocketClient(username, {
      WebSocketCtor: CapturingWebSocket,
      ...options,
    });
    return requireClient();
  };

  describe("connect state guards", () => {
    it("throws when connection already in progress", async () => {
      createClient();
      client.isConnecting = true;

      await expect(client.connect()).rejects.toThrow(
        "Connection already in progress",
      );
    });

    it("returns existing roomId when already connected", async () => {
      createClient();
      client.isConnected = true;
      client.roomId = "existing-room";

      const result = await client.connect();

      expect(result).toEqual({ roomId: "existing-room" });
    });
  });

  describe("API key handling", () => {
    it("includes apiKey in URL when provided", async () => {
      let capturedUrl: string | null = null;
      const TrackingWebSocket = class extends MockWebSocket {
        constructor(url: string) {
          super();
          capturedUrl = url;
          mockWs = this;
        }
      };
      client = new TikTokWebSocketClient("testuser", {
        WebSocketCtor: TrackingWebSocket,
        apiKey: "test-api-key",
      });

      const connectPromise = client.connect();
      requireMockWebSocket().emit("open");
      requireMockWebSocket().emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "roomInfo",
            data: { roomInfo: { id: "room1" } },
          }),
        ),
      );
      await connectPromise;

      if (capturedUrl === null) {
        throw new Error("Expected WebSocket URL to be captured");
      }
      const capturedWebSocketUrl = String(capturedUrl);
      expect(capturedWebSocketUrl).toContain("apiKey=test-api-key");
    });
  });

  describe("non-array message handling", () => {
    it("handles single message payload without messages array", async () => {
      createClient();
      const connectedEvents: ConnectedEvent[] = [];
      client.on("connected", (data) => connectedEvents.push(data));

      const connectPromise = client.connect();
      requireMockWebSocket().emit("open");
      requireMockWebSocket().emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "roomInfo",
            data: { roomInfo: { id: "single-room", isLive: true } },
          }),
        ),
      );

      const result = await connectPromise;
      expect(result.roomId).toBe("single-room");
      expect(connectedEvents).toHaveLength(1);
    });
  });

  describe("close code handling", () => {
    it("emits error and disables reconnect for code 4429", async () => {
      createClient();
      const errors: Error[] = [];
      client.on("error", (err) => errors.push(err));

      const connectPromise = client.connect();
      requireMockWebSocket().emit("open");
      requireMockWebSocket().emit("close", 4429, "Rate limited");

      await expect(connectPromise).rejects.toThrow();
      expect(
        errors.some((e) => e.message.includes("10 concurrent connections")),
      ).toBe(true);
      expect(client.autoReconnect).toBe(false);
    });

    it("emits error and disables reconnect for code 4401", async () => {
      createClient();
      const errors: Error[] = [];
      client.on("error", (err) => errors.push(err));

      const connectPromise = client.connect();
      requireMockWebSocket().emit("open");
      requireMockWebSocket().emit("close", 4401, "Invalid config");

      await expect(connectPromise).rejects.toThrow();
      expect(
        errors.some((e) => e.message.includes("Invalid configuration")),
      ).toBe(true);
      expect(client.autoReconnect).toBe(false);
    });

    it("schedules reconnect for recoverable close codes", async () => {
      createClient();
      const reconnectingEvents: ReconnectingEvent[] = [];
      client.on("reconnecting", (data) => reconnectingEvents.push(data));

      const connectPromise = client.connect();
      requireMockWebSocket().emit("open");
      client.autoReconnect = true;
      requireMockWebSocket().emit("close", 1006, "Abnormal closure");

      await expect(connectPromise).rejects.toThrow();
      expect(reconnectingEvents).toHaveLength(1);
      const reconnectingEvent = reconnectingEvents[0];
      if (!reconnectingEvent) {
        throw new Error("Expected reconnecting event");
      }
      expect(reconnectingEvent.attempt).toBe(1);
    });
  });

  describe("WebSocket error handling", () => {
    it("emits error and rejects connect on ws error", async () => {
      createClient();
      const errors: Error[] = [];
      client.on("error", (err) => errors.push(err));

      const connectPromise = client.connect();
      requireMockWebSocket().emit("error", new Error("WebSocket error"));

      await expect(connectPromise).rejects.toThrow("WebSocket error");
      expect(errors).toHaveLength(1);
    });
  });

  describe("message parse error", () => {
    it("emits error when message cannot be parsed", async () => {
      createClient();
      const errors: Error[] = [];
      client.on("error", (err) => errors.push(err));

      const connectPromise = client.connect();
      requireMockWebSocket().emit("open");
      requireMockWebSocket().emit("message", Buffer.from("not valid json"));

      advanceTimersByTime(16000);
      await expect(connectPromise).rejects.toThrow();
      expect(errors.some((e) => e.message.includes("Failed to parse"))).toBe(
        true,
      );
    });
  });

  describe("event type handling", () => {
    it("ignores workerInfo events", () => {
      createClient();
      const events: unknown[] = [];
      client.on("workerInfo", (data) => events.push(data));

      client.handleEvent({ type: "workerInfo", data: {} });

      expect(events).toHaveLength(0);
    });

    it("emits member events for member/join types", () => {
      createClient();
      const events: unknown[] = [];
      client.on("member", (data) => events.push(data));

      client.handleEvent({ type: "member", data: { user: "test" } });
      client.handleEvent({ type: "join", data: { user: "test2" } });
      client.handleEvent({
        type: "WebcastMemberMessage",
        data: { user: "test3" },
      });

      expect(events).toHaveLength(3);
    });

    it("emits like events", () => {
      createClient();
      const events: unknown[] = [];
      client.on("like", (data) => events.push(data));

      client.handleEvent({ type: "like", data: { count: 5 } });
      client.handleEvent({ type: "WebcastLikeMessage", data: { count: 10 } });

      expect(events).toHaveLength(2);
    });

    it("emits follow/share events directly", () => {
      createClient();
      const followEvents: unknown[] = [];
      const shareEvents: unknown[] = [];
      client.on("follow", (data) => followEvents.push(data));
      client.on("share", (data) => shareEvents.push(data));

      client.handleEvent({ type: "follow", data: { user: "follower" } });
      client.handleEvent({ type: "share", data: { user: "sharer" } });

      expect(followEvents).toHaveLength(1);
      expect(shareEvents).toHaveLength(1);
    });

    it("emits roomUser events for viewer count types", () => {
      createClient();
      const events: unknown[] = [];
      client.on("roomUser", (data) => events.push(data));

      client.handleEvent({ type: "roomUser", data: { count: 100 } });
      client.handleEvent({ type: "viewerCount", data: { count: 150 } });
      client.handleEvent({ type: "viewer_count", data: { count: 200 } });
      client.handleEvent({
        type: "WebcastRoomUserSeqMessage",
        data: { count: 250 },
      });

      expect(events).toHaveLength(4);
    });

    it("emits subscribe events", () => {
      createClient();
      const events: unknown[] = [];
      client.on("subscribe", (data) => events.push(data));

      client.handleEvent({ type: "subscribe", data: { months: 3 } });

      expect(events).toHaveLength(1);
    });

    it("emits emote events", () => {
      createClient();
      const events: unknown[] = [];
      client.on("emote", (data) => events.push(data));

      client.handleEvent({ type: "emote", data: { emoteId: "emote1" } });

      expect(events).toHaveLength(1);
    });

    it("emits envelope events", () => {
      createClient();
      const events: unknown[] = [];
      client.on("envelope", (data) => events.push(data));

      client.handleEvent({ type: "envelope", data: { amount: 100 } });

      expect(events).toHaveLength(1);
    });

    it("emits questionNew events", () => {
      createClient();
      const events: unknown[] = [];
      client.on("questionNew", (data) => events.push(data));

      client.handleEvent({ type: "questionNew", data: { question: "test?" } });

      expect(events).toHaveLength(1);
    });

    it("emits linkMicBattle and linkMicArmies events", () => {
      createClient();
      const battleEvents: unknown[] = [];
      const armiesEvents: unknown[] = [];
      client.on("linkMicBattle", (data) => battleEvents.push(data));
      client.on("linkMicArmies", (data) => armiesEvents.push(data));

      client.handleEvent({ type: "linkMicBattle", data: { battle: true } });
      client.handleEvent({ type: "linkMicArmies", data: { armies: [] } });

      expect(battleEvents).toHaveLength(1);
      expect(armiesEvents).toHaveLength(1);
    });

    it("emits liveIntro events", () => {
      createClient();
      const events: unknown[] = [];
      client.on("liveIntro", (data) => events.push(data));

      client.handleEvent({ type: "liveIntro", data: { intro: "test" } });
      client.handleEvent({
        type: "WebcastLiveIntroMessage",
        data: { intro: "test2" },
      });

      expect(events).toHaveLength(2);
    });

    it("emits error for error type events", () => {
      createClient();
      const errors: Error[] = [];
      client.on("error", (err) => errors.push(err));

      client.handleEvent({ type: "error", data: { message: "Test error" } });
      client.handleEvent({ type: "error", data: {} });

      expect(errors).toHaveLength(2);
      const firstError = errors[0];
      const secondError = errors[1];
      if (!firstError || !secondError) {
        throw new Error("Expected error events");
      }
      expect(firstError.message).toBe("Test error");
      expect(secondError.message).toBe("Unknown error");
    });

    it("emits unknown types as-is and also as rawData", () => {
      createClient();
      const unknownEvents: unknown[] = [];
      const rawEvents: RawEvent[] = [];
      client.on("customEvent", (data) => unknownEvents.push(data));
      client.on("rawData", (data) => rawEvents.push(data));

      client.handleEvent({ type: "customEvent", data: { custom: true } });

      expect(unknownEvents).toHaveLength(1);
      expect(rawEvents).toHaveLength(1);
      const rawEvent = rawEvents[0];
      if (!rawEvent) {
        throw new Error("Expected raw custom event");
      }
      expect(rawEvent.type).toBe("customEvent");
    });
  });

  describe("getState", () => {
    it("returns current connection state", () => {
      createClient();
      client.isConnected = true;
      client.isConnecting = false;
      client.roomId = "test-room";
      client.reconnectAttempts = 2;
      client.stats.messageCount = 10;

      const state = client.getState();

      expect(state.isConnected).toBe(true);
      expect(state.isConnecting).toBe(false);
      expect(state.roomId).toBe("test-room");
      expect(state.reconnectAttempts).toBe(2);
      expect(state.stats.messageCount).toBe(10);
    });
  });

  describe("getRoomInfo", () => {
    it("returns roomId when connected", async () => {
      createClient();
      client.roomId = "connected-room";

      const result = await client.getRoomInfo();

      expect(result).toEqual({ roomId: "connected-room" });
    });

    it("throws when not connected", async () => {
      createClient();
      client.roomId = null;

      await expect(client.getRoomInfo()).rejects.toThrow("Not connected");
    });
  });

  describe("fetchIsLive", () => {
    it("returns isConnected state", async () => {
      createClient();
      client.isConnected = true;

      const result = await client.fetchIsLive();

      expect(result).toBe(true);
    });

    it("returns false when not connected", async () => {
      createClient();
      client.isConnected = false;

      const result = await client.fetchIsLive();

      expect(result).toBe(false);
    });
  });

  describe("ping interval", () => {
    it("clears existing interval before starting new one", async () => {
      createClient();

      client.connect();
      requireMockWebSocket().emit("open");

      const previousPingInterval = safeSetInterval(() => undefined, 999);
      client.pingInterval = previousPingInterval;
      client.startPingInterval();

      expect(client.pingInterval).not.toBe(previousPingInterval);
    });

    it("sends ping when ws is open", async () => {
      createClient();

      const connectPromise = client.connect();
      requireMockWebSocket().emit("open");
      requireMockWebSocket().emit(
        "message",
        Buffer.from(
          JSON.stringify({
            type: "roomInfo",
            data: { roomInfo: { id: "room1" } },
          }),
        ),
      );
      await connectPromise;

      advanceTimersByTime(31000);

      expect(requireMockWebSocket().pingCalled).toBe(true);
    });
  });

  describe("getCloseReason", () => {
    it("returns known close reasons", () => {
      createClient();

      expect(client.getCloseReason(1000)).toBe("Normal closure");
      expect(client.getCloseReason(4005)).toBe("TikTok stream ended");
      expect(client.getCloseReason(4006)).toBe(
        "No messages timeout (inactivity)",
      );
      expect(client.getCloseReason(4500)).toBe(
        "TikTok closed connection unexpectedly",
      );
    });

    it("returns unknown for unmapped codes", () => {
      createClient();

      expect(client.getCloseReason(9999)).toBe("Unknown close code: 9999");
    });
  });

  describe("constructor error handling", () => {
    it("handles error during WebSocket creation", async () => {
      const FailingWebSocket = class extends MockWebSocket {
        constructor() {
          super();
          throw new Error("WebSocket creation failed");
        }
      };
      client = new TikTokWebSocketClient("testuser", {
        WebSocketCtor: FailingWebSocket,
      });

      await expect(client.connect()).rejects.toThrow(
        "WebSocket creation failed",
      );
      expect(client.isConnecting).toBe(false);
    });
  });
});
