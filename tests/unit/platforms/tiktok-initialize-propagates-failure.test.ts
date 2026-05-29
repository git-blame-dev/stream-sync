import { describe, it, expect, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";

import { EventEmitter } from "events";

import { TikTokPlatform } from "../../../src/platforms/tiktok";
import { createMockTikTokPlatformDependencies } from "../../helpers/mock-factories";

type TikTokDependencies = NonNullable<ConstructorParameters<typeof TikTokPlatform>[1]>;
type TikTokWebcastEvent = NonNullable<TikTokDependencies["WebcastEvent"]>;

class FailingTikTokConnection extends EventEmitter {
  isConnecting = false;
  isConnected = false;
  connect = createMockFn<[], Promise<unknown>>().mockRejectedValue(
    new Error("room id failure"),
  );
  disconnect = createMockFn<[], Promise<unknown>>().mockResolvedValue(undefined);
}

const WEBCAST_EVENT = {
  CHAT: "chat",
  GIFT: "gift",
  FOLLOW: "follow",
  ROOM_USER: "roomUser",
  ENVELOPE: "envelope",
  SUBSCRIBE: "subscribe",
  SUPER_FAN: "superfan",
  SOCIAL: "social",
  ERROR: "error",
  DISCONNECT: "disconnect",
  STREAM_END: "stream_end",
} satisfies TikTokWebcastEvent;

describe("TikTokPlatform initialize failure propagation", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  it("rejects initialize when the initial connection attempt fails", async () => {
    const failingConnection = new FailingTikTokConnection();

    const dependencies = {
      ...createMockTikTokPlatformDependencies({
        controlEvent: {
          CONNECTED: "connected",
          DISCONNECTED: "disconnected",
          ERROR: "error",
        },
      }),
      WebcastEvent: WEBCAST_EVENT,
      connectionFactory: {
        createConnection: createMockFn().mockReturnValue(failingConnection),
      },
      retrySystem: {
        handleConnectionError: createMockFn(),
        resetRetryCount: createMockFn(),
        isConnected: createMockFn(),
      },
    } satisfies ConstructorParameters<typeof TikTokPlatform>[1];

    const platform = new TikTokPlatform(
      { enabled: true, username: "retry_tester" },
      dependencies,
    );

    await expect(platform.initialize(platform.handlers)).rejects.toThrow(
      "room id failure",
    );
  });
});
