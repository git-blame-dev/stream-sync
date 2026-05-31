import { describe, expect, beforeEach, it } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { DisplayQueue } from "../../../src/obs/display-queue.ts";
import { EventEmitter } from "events";
import { PRIORITY_LEVELS } from "../../../src/core/constants";

describe("DisplayQueue notification TTS disabled", () => {
  let mockOBSManager: ConstructorParameters<typeof DisplayQueue>[0];
  let mockSourcesManager: NonNullable<ConstructorParameters<typeof DisplayQueue>[4]>["sourcesManager"];
  let updateCalls: string[];
  let queue: DisplayQueue;
  let testRuntimeConstants: ConstructorParameters<typeof DisplayQueue>[2];

  beforeEach(() => {
    updateCalls = [];

    mockOBSManager = {
      isReady: createMockFn().mockResolvedValue(true),
      call: createMockFn().mockResolvedValue({}),
    };

    mockSourcesManager = {
      updateTextSource: createMockFn<[string, string?], Promise<void>>((_, text) => {
        if (text !== undefined) {
        updateCalls.push(text);
        }
        return Promise.resolve();
      }),
      clearTextSource: createMockFn().mockResolvedValue(),
      setSourceVisibility: createMockFn().mockResolvedValue(),
      setPlatformLogoVisibility: createMockFn().mockResolvedValue(),
      hideAllDisplays: createMockFn().mockResolvedValue(),
      updateChatMsgText: createMockFn().mockResolvedValue(),
      setNotificationPlatformLogoVisibility: createMockFn().mockResolvedValue(),
      setGroupSourceVisibility: createMockFn().mockResolvedValue(),
      getGroupSceneItemId: createMockFn<[string, string], Promise<{ sceneItemId: number }>>(async () => ({ sceneItemId: 1 })),
      setChatDisplayVisibility: createMockFn().mockResolvedValue(),
      setNotificationDisplayVisibility: createMockFn().mockResolvedValue(),
      getSceneItemId: createMockFn<[string, string], Promise<{ sceneItemId: number }>>(async () => ({ sceneItemId: 1 })),
      hideAllPlatformLogos: createMockFn().mockResolvedValue(),
      hideAllNotificationPlatformLogos: createMockFn().mockResolvedValue(),
      setSourceFilterEnabled: createMockFn().mockResolvedValue(),
      getSourceFilterSettings: createMockFn().mockResolvedValue({}),
      setSourceFilterSettings: createMockFn().mockResolvedValue(),
      clearSceneItemCache: createMockFn(),
    };

    testRuntimeConstants = {
      CHAT_TRANSITION_DELAY: 0,
      NOTIFICATION_CLEAR_DELAY: 0,
      CHAT_MESSAGE_DURATION: 0,
      PRIORITY_LEVELS,
    };

    queue = new DisplayQueue(
      mockOBSManager,
      {
        ttsEnabled: false,
        chat: {
          sourceName: "chat",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
        notification: {
          sourceName: "notif",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
        obs: { ttsTxt: "tts txt" },
        youtube: {},
      },
      testRuntimeConstants,
      new EventEmitter(),
      mockSourcesManager === undefined ? {} : { sourcesManager: mockSourcesManager },
    );
  });

  it("skips notification TTS when ttsEnabled is false", async () => {
    await queue.handleNotificationEffects({
      type: "platform:paypiggy",
      platform: "youtube",
      data: {
        username: "testMember",
        displayMessage: "Welcome!",
        ttsMessage: "Hi member",
      },
    });

    expect(updateCalls).toEqual([]);
  });

  it("skips notification TTS when ttsNotificationsEnabled is false", async () => {
    const queueWithNotificationsDisabled = new DisplayQueue(
      mockOBSManager,
      {
        ttsNotificationsEnabled: false,
        chat: {},
        notification: {},
        obs: { ttsTxt: "tts txt", ttsNotificationsEnabled: false },
        youtube: {},
      },
      testRuntimeConstants,
      new EventEmitter(),
      mockSourcesManager === undefined ? {} : { sourcesManager: mockSourcesManager },
    );

    await queueWithNotificationsDisabled.handleNotificationEffects({
      type: "platform:paypiggy",
      platform: "youtube",
      data: {
        username: "testMember",
        displayMessage: "Welcome!",
        ttsMessage: "Hi member",
      },
    });

    expect(updateCalls).toEqual([]);
  });

  it("keeps notification TTS enabled from split config when legacy ttsEnabled is false", async () => {
    const queueWithNotificationsEnabled = new DisplayQueue(
      mockOBSManager,
      {
        ttsEnabled: false,
        chat: {},
        notification: {},
        obs: { ttsTxt: "tts txt", ttsEnabled: false, ttsNotificationsEnabled: true },
        youtube: {},
      },
      testRuntimeConstants,
      new EventEmitter(),
      mockSourcesManager === undefined ? {} : { sourcesManager: mockSourcesManager },
    );

    await queueWithNotificationsEnabled.handleNotificationEffects({
      type: "platform:paypiggy",
      platform: "youtube",
      data: {
        username: "testMember",
        displayMessage: "Welcome!",
        ttsMessage: "Hi member",
      },
    });

    expect(updateCalls).toEqual(["Hi member"]);
  });

  it("plays chat TTS only after displayed chat and flattens structured messages", async () => {
    const chatQueue = new DisplayQueue(
      mockOBSManager,
      {
        chat: {},
        notification: {},
        obs: { ttsTxt: "tts txt", ttsChatEnabled: true, ttsNotificationsEnabled: true },
        youtube: {},
      },
      testRuntimeConstants,
      new EventEmitter(),
      mockSourcesManager === undefined
        ? { delay: async () => {} }
        : { sourcesManager: mockSourcesManager, delay: async () => {} },
    );
    chatQueue.renderer.displayChatItem = createMockFn().mockResolvedValue(true);

    await chatQueue.displayChatItem({
      type: "chat",
      platform: "twitch",
      data: {
        username: "chatUser",
        message: { parts: [{ text: "hello " }, { text: "chat" }] },
      },
    });

    expect(updateCalls).toEqual(["chatUser says hello chat"]);
  });

  it("does not play chat TTS when displayed chat TTS is disabled", async () => {
    const chatQueue = new DisplayQueue(
      mockOBSManager,
      {
        chat: {},
        notification: {},
        obs: { ttsTxt: "tts txt", ttsChatEnabled: false, ttsNotificationsEnabled: true },
        youtube: {},
      },
      testRuntimeConstants,
      new EventEmitter(),
      mockSourcesManager === undefined
        ? { delay: async () => {} }
        : { sourcesManager: mockSourcesManager, delay: async () => {} },
    );
    chatQueue.renderer.displayChatItem = createMockFn().mockResolvedValue(true);

    await chatQueue.displayChatItem({
      type: "chat",
      platform: "twitch",
      data: {
        username: "chatUser",
        message: "hello chat",
      },
    });

    expect(updateCalls).toEqual([]);
  });
});
