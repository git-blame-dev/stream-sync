import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { EventEmitter } from "events";
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

describe("TikTokWebSocketClient (behavior)", () => {
  type TikTokWebSocketClientConstructor = new (
    username: string,
    options: { WebSocketCtor: typeof MockWebSocket },
  ) => EventEmitter & { connect: () => Promise<{ roomId: string }>; disconnect: () => void };
  type ChatEvent = { comment: string };
  type GiftEvent = {
    giftDetails: { giftName: string };
    repeatCount: number;
    groupId: string;
    repeatEnd: number;
  };
  type StreamEndEvent = { reason: string };

  let TikTokWebSocketClient: TikTokWebSocketClientConstructor;
  let mockWs: MockWebSocket | null;
  let client: InstanceType<TikTokWebSocketClientConstructor>;

  const requireMockWebSocket = () => {
    if (!mockWs) {
      throw new Error("Expected test WebSocket to be constructed");
    }
    return mockWs;
  };
  const requireFirst = <T>(items: T[]): T => {
    const first = items[0];
    if (first === undefined) {
      throw new Error("Expected at least one captured event");
    }
    return first;
  };

  beforeEach(() => {
    useFakeTimers();
    ({
      TikTokWebSocketClient,
    } = require("../../../src/platforms/tiktok-websocket-client.ts"));
    mockWs = null;
    const CapturingWebSocket = class extends MockWebSocket {
      constructor() {
        super();
        mockWs = this;
      }
    };
    client = new TikTokWebSocketClient("testuser123", {
      WebSocketCtor: CapturingWebSocket,
    });
  });

  afterEach(() => {
    useRealTimers();
    if (client && client.disconnect) {
      client.disconnect();
    }
  });

  test("resolves connect and emits room info and chat from batched messages", async () => {
    const chatEvents: ChatEvent[] = [];
    client.on("chat", (data: ChatEvent) => chatEvents.push(data));

    const connectPromise = client.connect();
    const ws = requireMockWebSocket();
    ws.emit("open");

    const payload = {
      messages: [
        {
          type: "roomInfo",
          data: { roomInfo: { id: "room123", isLive: true, status: 2 } },
        },
        {
          type: "chat",
          data: {
            comment: "hello world",
            user: { userId: "user123-id", uniqueId: "user123" },
          },
        },
      ],
    };
    ws.emit("message", Buffer.from(JSON.stringify(payload)));

    const roomInfo = await connectPromise;
    expect(roomInfo.roomId).toBe("room123");
    expect(chatEvents).toHaveLength(1);
    expect(requireFirst(chatEvents).comment).toBe("hello world");
  });

  test("emits gift events with repeat and group data", async () => {
    const gifts: GiftEvent[] = [];
    client.on("gift", (data: GiftEvent) => gifts.push(data));

    const connectPromise = client.connect();
    const ws = requireMockWebSocket();
    ws.emit("open");

    const payload = {
      messages: [
        {
          type: "roomInfo",
          data: { roomInfo: { id: "room123", isLive: true, status: 2 } },
        },
        {
          type: "gift",
          data: {
            giftDetails: { giftName: "Rose", diamondCount: 1, giftType: 1 },
            repeatCount: 3,
            groupId: "g123",
            repeatEnd: 0,
          },
        },
      ],
    };
    ws.emit("message", Buffer.from(JSON.stringify(payload)));
    await connectPromise;

    expect(gifts).toHaveLength(1);
    const gift = requireFirst(gifts);
    expect(gift.giftDetails.giftName).toBe("Rose");
    expect(gift.repeatCount).toBe(3);
    expect(gift.groupId).toBe("g123");
    expect(gift.repeatEnd).toBe(0);
  });

  test("emits streamEnd on close code 4404 and rejects connect", async () => {
    const streamEndEvents: StreamEndEvent[] = [];
    client.on("streamEnd", (data: StreamEndEvent) => streamEndEvents.push(data));

    const connectPromise = client.connect();
    const ws = requireMockWebSocket();
    ws.emit("open");
    ws.emit("close", 4404, "offline");

    await expect(connectPromise).rejects.toBeInstanceOf(Error);
    expect(streamEndEvents).toHaveLength(1);
    expect(requireFirst(streamEndEvents).reason).toBe("User is not live");
  });

  test("rejects connect when no room info arrives before timeout", async () => {
    const connectPromise = client.connect();
    requireMockWebSocket().emit("open");

    advanceTimersByTime(16000);

    await expect(connectPromise).rejects.toThrow(/timeout/i);
  });
});
