import { describe, expect, it } from "bun:test";
import { noOpLogger } from "../helpers/mock-factories";
import { createConfigFixture } from "../helpers/config-fixture";

import { EventEmitter } from "events";
import { DependencyFactory } from "../../src/utils/dependency-factory";
import { TikTokPlatform } from "../../src/platforms/tiktok.ts";

type TikTokDependencies = NonNullable<ConstructorParameters<typeof TikTokPlatform>[1]>;
type TikTokWebcastEvent = NonNullable<TikTokDependencies["WebcastEvent"]>;
type TikTokControlEvent = NonNullable<TikTokDependencies["ControlEvent"]>;
type SelfMessageDetectionService = Exclude<
  TikTokDependencies["selfMessageDetectionService"],
  null | undefined
>;

const WEBCAST_EVENT = {
  CHAT: "chat",
  GIFT: "gift",
  FOLLOW: "follow",
  SOCIAL: "social",
  ROOM_USER: "roomUser",
  ERROR: "error",
  DISCONNECT: "disconnect",
} satisfies TikTokWebcastEvent;

const CONTROL_EVENT = {
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  ERROR: "error",
} satisfies TikTokControlEvent;

const requireRecord = (value: unknown, name: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Expected ${name} to be an object`);
  }

  return Object.fromEntries(Object.entries(value));
};

const selfMessageDetectionService = {
  shouldFilterMessage: () => false,
} satisfies SelfMessageDetectionService;

const mockRetrySystem = {
  resetRetryCount: () => {},
  handleConnectionError: () => {},
  delay: () => Promise.resolve(),
};

describe("TikTokPlatform connection factory integration", () => {
  const config = { enabled: true, username: "test-factory-user" };

  const createPlatform = () => {
    class MockTikTokWebSocketClient extends EventEmitter {
      isConnected = false;
      isConnecting = false;

      constructor() {
        super();
      }
      async connect() {
        this.isConnected = true;
        this.emit("connected", {
          roomId: "room-test",
          isLive: true,
          status: 2,
        });
        return { roomId: "room-test" };
      }
      disconnect() {
        this.isConnected = false;
        this.emit("disconnected", { code: 1000, reason: "intentional" });
      }
    }

    const factory = new DependencyFactory();
    const generatedDependencies = factory.createTiktokDependencies(config, {
      TikTokWebSocketClient: MockTikTokWebSocketClient,
      logger: noOpLogger,
      retrySystem: mockRetrySystem,
      config: createConfigFixture(),
    });
    const dependencies = {
      ...generatedDependencies,
      connectionFactory: {
        createConnection: (
          platform: string,
          connectionConfig: unknown,
          connectionDependencies: unknown,
        ) =>
          generatedDependencies.connectionFactory.createConnection(
            platform,
            requireRecord(connectionConfig, "connection config"),
            requireRecord(connectionDependencies, "connection dependencies"),
          ),
      },
      WebcastEvent: WEBCAST_EVENT,
      ControlEvent: CONTROL_EVENT,
      selfMessageDetectionService,
    } satisfies TikTokDependencies;
    return new TikTokPlatform(config, dependencies);
  };

  it("creates an event-emitter-capable connection when connecting", async () => {
    const platform = createPlatform();

    await platform.initialize({});

    const connection = platform.connection;
    expect(connection).not.toBeNull();
    expect(typeof connection?.on).toBe("function");
    expect(typeof connection?.removeAllListeners).toBe("function");
  });
});
