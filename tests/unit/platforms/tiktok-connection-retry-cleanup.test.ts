import { describe, it, expect, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";

import { EventEmitter } from "events";
import { TikTokPlatform } from "../../../src/platforms/tiktok";
import { createMockTikTokPlatformDependencies } from "../../helpers/mock-factories";

describe("TikTokPlatform connection recovery", () => {
  const baseConfig = { enabled: true, username: "retry_tester" };
  type TestConnection = EventEmitter & {
    id: string;
    isConnecting: boolean;
    isConnected: boolean;
    connect: () => Promise<boolean>;
    disconnect: () => Promise<boolean>;
  };
  type ViewerCountEvent = { platform: string; count: number };

  afterEach(() => {
    restoreAllMocks();
  });

  const createConnection = ({
    shouldReject,
    id,
  }: {
    shouldReject: boolean;
    id: string;
  }): TestConnection => {
    const connection = new EventEmitter() as TestConnection;
    connection.id = id;
    connection.isConnecting = false;
    connection.isConnected = false;
    connection.connect = createMockFn(() => {
      connection.isConnecting = true;
      if (shouldReject) {
        return Promise.reject(new Error("room id failure"));
      }
      connection.isConnecting = false;
      connection.isConnected = true;
      return Promise.resolve(true);
    });
    connection.disconnect = createMockFn().mockResolvedValue(true);
    connection.removeAllListeners =
      connection.removeAllListeners.bind(connection);
    return connection;
  };

  it("drops a stuck connecting instance and retries with a fresh connection", async () => {
    const connection1 = createConnection({ shouldReject: true, id: "conn-1" });
    const connection2 = createConnection({ shouldReject: false, id: "conn-2" });

    const dependencyBase = createMockTikTokPlatformDependencies();
    const dependencies = {
      ...dependencyBase,
      ControlEvent: {
        CONNECTED: "connected",
        DISCONNECTED: "disconnected",
        ERROR: "error",
      },
      WebcastEvent: {
        CHAT: "chat",
        GIFT: "gift",
        FOLLOW: "follow",
        ROOM_USER: "roomUser",
        ENVELOPE: "envelope",
        SUBSCRIBE: "subscribe",
        SUPER_FAN: "superfan",
        LIKE: "like",
        SOCIAL: "social",
        SHARE: "share",
        MEMBER: "member",
        EMOTE: "emote",
        QUESTION_NEW: "question",
        ERROR: "error",
        DISCONNECT: "disconnect",
        STREAM_END: "stream_end",
      },
    };

    const connectionFactory = {
      createConnection: createMockFn()
        .mockReturnValueOnce(connection1)
        .mockReturnValueOnce(connection2),
    };

    const platformDependencies = {
      ...dependencies,
      connectionFactory,
    };

    const viewerCounts: ViewerCountEvent[] = [];
    const platform = new TikTokPlatform(baseConfig, platformDependencies);
    platform.handlers = {
      ...platform.handlers,
      onViewerCount: (payload: unknown) => {
        viewerCounts.push(payload as ViewerCountEvent);
      },
    };

    await expect(platform.initialize(platform.handlers)).rejects.toThrow(
      "room id failure",
    );

    await platform.initialize(platform.handlers);
    connection2.emit(platformDependencies.ControlEvent.CONNECTED);
    const viewerTimestamp = Date.parse("2024-01-01T00:00:00Z");
    connection2.emit(platformDependencies.WebcastEvent.ROOM_USER, {
      viewerCount: 99,
      common: { createTime: viewerTimestamp },
    });

    expect(viewerCounts).toHaveLength(1);
    expect(viewerCounts[0]).toMatchObject({ platform: "tiktok", count: 99 });
  });
});
