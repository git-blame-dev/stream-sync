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
});
