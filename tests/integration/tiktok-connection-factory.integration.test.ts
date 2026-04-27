import { describe, expect, it } from "bun:test";
import { noOpLogger } from "../helpers/mock-factories";
import { createConfigFixture } from "../helpers/config-fixture";

import { EventEmitter } from "events";
import { DependencyFactory } from "../../src/utils/dependency-factory";
import { TikTokPlatform } from "../../src/platforms/tiktok.ts";

const mockRetrySystem = {
  resetRetryCount: () => {},
  handleConnectionError: () => {},
  delay: () => Promise.resolve(),
};

describe("TikTokPlatform connection factory integration", () => {
  const config = { enabled: true, username: "test-factory-user" };

  const createPlatform = () => {
    class MockTikTokWebSocketClient extends EventEmitter {
      constructor() {
        super();
        this.isConnected = false;
        this.isConnecting = false;
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
    const dependencies = factory.createTiktokDependencies(config, {
      TikTokWebSocketClient: MockTikTokWebSocketClient,
      logger: noOpLogger,
      retrySystem: mockRetrySystem,
      config: createConfigFixture(),
    });
    return new TikTokPlatform(config, dependencies);
  };

  it("creates an event-emitter-capable connection when connecting", async () => {
    const platform = createPlatform();

    await platform.initialize({});

    expect(typeof platform.connection.on).toBe("function");
    expect(typeof platform.connection.removeAllListeners).toBe("function");
  });
});
