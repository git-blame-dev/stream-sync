import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import { EventEmitter } from "events";
import { createMockFn } from "../../helpers/bun-mock-utils";
import {
  useFakeTimers,
  useRealTimers,
  advanceTimersByTime,
} from "../../helpers/bun-timers";

class MockWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor() {
    super();
    this.readyState = MockWebSocket.OPEN;
  }

  ping() {}

  close(code = 1000, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close", code, reason);
  }
}

describe("TikTokWebSocketClient error handler integration", () => {
  let TikTokWebSocketClient: any;
  let mockWs: any;
  let client: any;
  let mockLogger: {
    debug: ReturnType<typeof createMockFn>;
    info: ReturnType<typeof createMockFn>;
    warn: ReturnType<typeof createMockFn>;
    error: ReturnType<typeof createMockFn>;
  };

  beforeEach(() => {
    useFakeTimers();
    ({
      TikTokWebSocketClient,
    } = require("../../../src/platforms/tiktok-websocket-client.ts"));
    mockWs = null;
    mockLogger = {
      debug: createMockFn(),
      info: createMockFn(),
      warn: createMockFn(),
      error: createMockFn(),
    };
  });

  afterEach(() => {
    useRealTimers();
    if (client && client.disconnect) {
      client.disconnect();
    }
  });

  const createClient = (username = "test-user", options = {}) => {
    const CapturingWebSocket = class extends MockWebSocket {
      constructor(...args) {
        super(...args);
        mockWs = this;
      }
    };
    client = new TikTokWebSocketClient(username, {
      WebSocketCtor: CapturingWebSocket,
      logger: mockLogger,
      ...options,
    });
    return client;
  };

  it("logs parse errors through error handler", async () => {
    createClient();
    const errors = [];
    client.on("error", (err) => errors.push(err));

    const connectPromise = client.connect();
    mockWs.emit("open");
    mockWs.emit("message", Buffer.from("not valid json"));

    advanceTimersByTime(16000);
    await expect(connectPromise).rejects.toThrow();

    expect(mockLogger.error).toHaveBeenCalled();
    const errorCall = mockLogger.error.mock.calls[0];
    expect(errorCall[0]).toContain("parse");
  });

  it("logs connection limit errors through error handler", async () => {
    createClient();
    client.on("error", () => {});

    const connectPromise = client.connect();
    mockWs.emit("open");
    mockWs.emit("close", 4429, "Rate limited");

    await expect(connectPromise).rejects.toThrow();

    expect(mockLogger.error).toHaveBeenCalled();
    const errorCall = mockLogger.error.mock.calls[0];
    expect(errorCall[0]).toContain("connection");
  });

  it("logs WebSocket transport errors through error handler", async () => {
    createClient();
    client.on("error", () => {});

    const connectPromise = client.connect();
    const wsError = new Error("WebSocket transport error");
    mockWs.emit("error", wsError);

    await expect(connectPromise).rejects.toThrow("WebSocket transport error");

    expect(mockLogger.error).toHaveBeenCalled();
    const errorCall = mockLogger.error.mock.calls[0];
    expect(errorCall[0]).toContain("WebSocket error");
  });
});
