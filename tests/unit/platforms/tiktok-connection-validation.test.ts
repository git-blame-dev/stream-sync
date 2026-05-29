import { describe, it, expect } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { PlatformConnectionFactory } from "../../../src/utils/platform-connection-factory";

type TikTokConnectorInstance = Record<string, unknown> & {
  connect: () => Promise<boolean>;
};

type EventedTikTokConnection = {
  on: (eventName: string, handler: (payload: string) => void) => void;
  emit: (eventName: string, payload: string) => void;
  removeAllListeners: () => void;
};

function isEventedTikTokConnection(
  connection: unknown,
): connection is EventedTikTokConnection {
  return (
    typeof connection === "object" &&
    connection !== null &&
    "on" in connection &&
    typeof connection.on === "function" &&
    "emit" in connection &&
    typeof connection.emit === "function" &&
    "removeAllListeners" in connection &&
    typeof connection.removeAllListeners === "function"
  );
}

describe("TikTok connection creation", () => {
  it("wraps connector instances so they expose EventEmitter methods for listener setup", async () => {
    const bareConnectorInstance = {
      connect: createMockFn().mockResolvedValue(true),
    };
    class TikTokWebSocketClient implements TikTokConnectorInstance {
      [key: string]: unknown;
      connect = bareConnectorInstance.connect;
    }
    const factory = new PlatformConnectionFactory(noOpLogger);

    const connection = factory.createTikTokConnection(
      { username: "testStream" },
      { logger: noOpLogger, TikTokWebSocketClient },
    );
    expect(isEventedTikTokConnection(connection)).toBe(true);

    if (!isEventedTikTokConnection(connection)) {
      throw new Error("Expected TikTok connection to expose EventEmitter methods");
    }

    const handlerCalls: string[] = [];
    connection.on("connected", (payload: string) => handlerCalls.push(payload));
    connection.emit("connected", "payload");

    expect(typeof connection.on).toBe("function");
    expect(typeof connection.emit).toBe("function");
    expect(typeof connection.removeAllListeners).toBe("function");
    expect(handlerCalls).toHaveLength(1);
    expect(handlerCalls[0]).toBe("payload");
  });
});
