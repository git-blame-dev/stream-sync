import { vi, describe, expect, beforeEach, it } from 'bun:test';

import { DisplayQueue } from "../../../src/obs/display-queue.ts";
import { EventEmitter } from "events";
import { PRIORITY_LEVELS } from "../../../src/core/constants";

describe("DisplayQueue notification TTS disabled", () => {
  let mockOBSManager: ConstructorParameters<typeof DisplayQueue>[0];
  let mockSourcesManager: NonNullable<ConstructorParameters<typeof DisplayQueue>[4]>["sourcesManager"];
  let updateCalls: string[];
  let mockFetch: NonNullable<ConstructorParameters<typeof DisplayQueue>[4]>["fetch"];
  let queue: DisplayQueue;
  let testRuntimeConstants: ConstructorParameters<typeof DisplayQueue>[2];

  beforeEach(() => {
    updateCalls = [];
    mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/v1/speak") && init?.method === "POST") {
        updateCalls.push(JSON.parse(String(init.body)).text);
      }
      return new Response(JSON.stringify({ ready: true }), { status: 200, headers: { "content-type": "application/json" } });
    };

    mockOBSManager = {
      isReady: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
      call: vi.fn<(...args: unknown[]) => Promise<{}>>().mockResolvedValue({}),
    };

    mockSourcesManager = {
      updateTextSource: vi.fn<(...args: [string, string?]) => Promise<void>>((_, text) => {
        if (text !== undefined) {
        updateCalls.push(text);
        }
        return Promise.resolve();
      }),
      clearTextSource: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      setSourceVisibility: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      setPlatformLogoVisibility: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      hideAllDisplays: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      updateChatMsgText: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      setNotificationPlatformLogoVisibility: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      setGroupSourceVisibility: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      getGroupSceneItemId: vi.fn<(...args: [string, string]) => Promise<{ sceneItemId: number }>>(async () => ({ sceneItemId: 1 })),
      setChatDisplayVisibility: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      setNotificationDisplayVisibility: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      getSceneItemId: vi.fn<(...args: [string, string]) => Promise<{ sceneItemId: number }>>(async () => ({ sceneItemId: 1 })),
      hideAllPlatformLogos: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      hideAllNotificationPlatformLogos: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      setSourceFilterEnabled: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      getSourceFilterSettings: vi.fn<(...args: unknown[]) => Promise<{}>>().mockResolvedValue({}),
      setSourceFilterSettings: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      clearSceneItemCache: vi.fn<(...args: unknown[]) => unknown>(),
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
        ttsChatEnabled: false,
        ttsNotificationsEnabled: false,
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
        obs: {},
        youtube: {},
      },
      testRuntimeConstants,
      new EventEmitter(),
      mockSourcesManager === undefined ? { fetch: mockFetch } : { sourcesManager: mockSourcesManager, fetch: mockFetch },
    );
  });

  it("skips notification TTS when ttsNotificationsEnabled is false", async () => {
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
        obs: { ttsNotificationsEnabled: false },
        youtube: {},
      },
      testRuntimeConstants,
      new EventEmitter(),
      mockSourcesManager === undefined ? { fetch: mockFetch } : { sourcesManager: mockSourcesManager, fetch: mockFetch },
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

  it("keeps notification TTS enabled when chat TTS is disabled", async () => {
    const queueWithNotificationsEnabled = new DisplayQueue(
      mockOBSManager,
      {
        ttsChatEnabled: false,
        ttsNotificationsEnabled: true,
        chat: {},
        notification: {},
        obs: { ttsChatEnabled: false, ttsNotificationsEnabled: true },
        youtube: {},
      },
      testRuntimeConstants,
      new EventEmitter(),
      mockSourcesManager === undefined ? { fetch: mockFetch } : { sourcesManager: mockSourcesManager, fetch: mockFetch },
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
        obs: { ttsChatEnabled: true, ttsNotificationsEnabled: true },
        youtube: {},
      },
      testRuntimeConstants,
      new EventEmitter(),
      mockSourcesManager === undefined
        ? { delay: async () => {}, fetch: mockFetch }
        : { sourcesManager: mockSourcesManager, delay: async () => {}, fetch: mockFetch },
    );
    await chatQueue.displayChatItem({
      type: "chat",
      platform: "twitch",
      data: {
        username: "chatUser",
        message: { parts: [{ text: "hello " }, { text: "chat" }] },
      },
    });
    await chatQueue.effectChain;

    expect(updateCalls).toEqual(["chatUser says hello chat"]);
  });

  it("does not play chat TTS when displayed chat TTS is disabled", async () => {
    const chatQueue = new DisplayQueue(
      mockOBSManager,
      {
        chat: {},
        notification: {},
        obs: { ttsChatEnabled: false, ttsNotificationsEnabled: true },
        youtube: {},
      },
      testRuntimeConstants,
      new EventEmitter(),
      mockSourcesManager === undefined
        ? { delay: async () => {}, fetch: mockFetch }
        : { sourcesManager: mockSourcesManager, delay: async () => {}, fetch: mockFetch },
    );
    await chatQueue.displayChatItem({
      type: "chat",
      platform: "twitch",
      data: {
        username: "chatUser",
        message: "hello chat",
      },
    });
    await chatQueue.effectChain;

    expect(updateCalls).toEqual([]);
  });
});
