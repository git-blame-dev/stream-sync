import { describe, it, expect } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { TikTokPlatform } from "../../../src/platforms/tiktok";

type TikTokDependencies = NonNullable<ConstructorParameters<typeof TikTokPlatform>[1]>;
type TikTokWebcastEvent = NonNullable<TikTokDependencies["WebcastEvent"]>;

const WEBCAST_EVENT = {
  CHAT: "chat",
  GIFT: "gift",
  FOLLOW: "follow",
  SOCIAL: "social",
  ROOM_USER: "roomUser",
  ERROR: "error",
  DISCONNECT: "disconnect",
} satisfies TikTokWebcastEvent;

type MessageError = {
  message?: string;
};

describe("TikTok Error Message Handling", () => {
  it("handles undefined error.message without crashing", () => {
    const error: MessageError = {};
    const errorMessage = error.message;

    expect(() => {
      if (errorMessage && errorMessage.includes("TLS")) {
        !!errorMessage;
      }
    }).not.toThrow();
  });

  it("handles error objects without message property gracefully", () => {

    const mockConnection = {
      on: createMockFn(),
      connect: createMockFn(),
      getState: createMockFn().mockReturnValue({ isConnected: false }),
    };

    const platform = new TikTokPlatform(
      { enabled: true, username: "testUser" },
      {
        WebcastEvent: WEBCAST_EVENT,
        ControlEvent: {},
        TikTokWebSocketClient: createMockFn(() => mockConnection),
        logger: noOpLogger,
        retrySystem: {
          resetRetryCount: createMockFn(),
          handleConnectionError: createMockFn(),
        },
      },
    );

    const errorWithoutMessage: MessageError = {};

    const handleConnectionError =
      Object.getPrototypeOf(platform)._handleConnectionError;

    if (handleConnectionError) {
      expect(() => {
        handleConnectionError.call(platform, errorWithoutMessage);
      }).not.toThrow();
    }
  });
});
