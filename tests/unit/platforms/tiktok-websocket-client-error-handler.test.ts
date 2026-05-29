import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import { EventEmitter } from "events";
import { createMockFn } from "../../helpers/bun-mock-utils";
import {
  useFakeTimers,
  useRealTimers,
  advanceTimersByTime,
} from "../../helpers/bun-timers";
import { TikTokWebSocketClient } from "../../../src/platforms/tiktok-websocket-client.ts";

type MockLogger = {
  debug: ReturnType<typeof createMockFn>;
  info: ReturnType<typeof createMockFn>;
  warn: ReturnType<typeof createMockFn>;
  error: ReturnType<typeof createMockFn>;
};

class MockWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState: number;

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
  let mockWs: MockWebSocket | null;
  let client: TikTokWebSocketClient | null;
  let mockLogger: MockLogger;

  beforeEach(() => {
    useFakeTimers();
    mockWs = null;
    client = null;
    mockLogger = {
      debug: createMockFn(),
      info: createMockFn(),
      warn: createMockFn(),
      error: createMockFn(),
    };
  });

  afterEach(() => {
    useRealTimers();
    if (client) {
      client.disconnect();
    }
  });

  const getMockWebSocket = (): MockWebSocket => {
    expect(mockWs).toBeDefined();
    if (!mockWs) {
      throw new Error("Expected test WebSocket to be constructed");
    }
    return mockWs;
  };

  const getFirstLoggerErrorMessage = (): string => {
    const errorCall = mockLogger.error.mock.calls[0];
    expect(errorCall).toBeDefined();
    if (!errorCall) {
      throw new Error("Expected logger.error to be called");
    }
    const message = errorCall[0];
    expect(typeof message).toBe("string");
    if (typeof message !== "string") {
      throw new Error("Expected first logger.error argument to be a string");
    }
    return message;
  };

  const createClient = (username = "test-user", options: Record<string, unknown> = {}) => {
    const CapturingWebSocket = class extends MockWebSocket {
      constructor(_url: string, _options?: unknown) {
        super();
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
    const activeClient = createClient();
    const errors: unknown[] = [];
    activeClient.on("error", (err) => errors.push(err));

    const connectPromise = activeClient.connect();
    const ws = getMockWebSocket();
    ws.emit("open");
    ws.emit("message", Buffer.from("not valid json"));

    advanceTimersByTime(16000);
    await expect(connectPromise).rejects.toThrow();

    expect(mockLogger.error).toHaveBeenCalled();
    expect(getFirstLoggerErrorMessage()).toContain("parse");
  });

  it("logs connection limit errors through error handler", async () => {
    const activeClient = createClient();
    activeClient.on("error", () => {});

    const connectPromise = activeClient.connect();
    const ws = getMockWebSocket();
    ws.emit("open");
    ws.emit("close", 4429, "Rate limited");

    await expect(connectPromise).rejects.toThrow();

    expect(mockLogger.error).toHaveBeenCalled();
    expect(getFirstLoggerErrorMessage()).toContain("connection");
  });

  it("logs WebSocket transport errors through error handler", async () => {
    const activeClient = createClient();
    activeClient.on("error", () => {});

    const connectPromise = activeClient.connect();
    const wsError = new Error("WebSocket transport error");
    const ws = getMockWebSocket();
    ws.emit("error", wsError);

    await expect(connectPromise).rejects.toThrow("WebSocket transport error");

    expect(mockLogger.error).toHaveBeenCalled();
    expect(getFirstLoggerErrorMessage()).toContain("WebSocket error");
  });
});
