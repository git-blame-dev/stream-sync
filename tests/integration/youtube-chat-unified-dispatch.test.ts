import { describe, test, afterEach, expect } from "bun:test";

import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { noOpLogger } from "../helpers/mock-factories";

type ChatItem = {
  item: {
    type: string;
    author: { name: string; id: string };
    message?: { text: string };
  };
};

type LiveChat = {
  on: (event: "chat-update", handler: (chatItem: ChatItem) => void) => void;
  start: () => void;
};

class TestYouTubePlatform {
  logger = noOpLogger;
  config: Record<string, never> = {};
  connectionManager = {
    connectToStream: createMockFn<[], Promise<LiveChat>>().mockResolvedValue({
      on: createMockFn<["chat-update", (chatItem: ChatItem) => void], void>(),
      start: createMockFn<[], void>(),
    }),
    disconnectFromStream: createMockFn<[], void>(),
  };

  constructor(
    private readonly getLiveChat: () => Promise<LiveChat>,
    readonly handleChatMessage: (chatItem: ChatItem) => void,
  ) {}

  _extractMessagesFromChatItem(chatItem: ChatItem): ChatItem[] {
    return [chatItem];
  }

  _shouldSkipMessage(_chatItem: ChatItem): boolean {
    return false;
  }

  async connectToLiveChat(videoId: string): Promise<void> {
    expect(videoId).toBe("vid1");
    const liveChat = await this.getLiveChat();
    liveChat.on("chat-update", (chatItem: ChatItem) => {
      if (this._shouldSkipMessage(chatItem)) return;
      const messages = this._extractMessagesFromChatItem(chatItem);
      messages.forEach((msg: ChatItem) => this.handleChatMessage(msg));
    });
    liveChat.start();
  }
}

describe("YouTube chat-update unified dispatch", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("routes paid and regular chat through handleChatMessage", async () => {
    const mockHandleChatMessage = createMockFn<[ChatItem], void>();
    const mockGetLiveChat = createMockFn<
      [],
      Promise<LiveChat>
    >().mockResolvedValue({
      on: createMockFn<
        ["chat-update", (chatItem: ChatItem) => void],
        void
      >((event, handler) => {
        if (event === "chat-update") {
          handler({
            item: {
              type: "LiveChatPaidMessage",
              author: { name: "Paid", id: "paid-user" },
            },
          });
          handler({
            item: {
              type: "LiveChatTextMessage",
              author: { name: "Viewer", id: "viewer-user" },
              message: { text: "hello" },
            },
          });
        }
      }),
      start: createMockFn<[], void>(),
    });

    const youtubePlatform = new TestYouTubePlatform(
      mockGetLiveChat,
      mockHandleChatMessage,
    );

    await youtubePlatform.connectToLiveChat("vid1");

    const handledItems: ChatItem[] = mockHandleChatMessage.mock.calls.map(
      ([call]) => call,
    );
    const hasPaidMessage = handledItems.some(
      (call) => call.item.type === "LiveChatPaidMessage",
    );
    const hasTextMessage = handledItems.some(
      (call) =>
        call.item.type === "LiveChatTextMessage" &&
        call.item.message?.text === "hello",
    );
    expect(hasPaidMessage).toBe(true);
    expect(hasTextMessage).toBe(true);
  });
});
