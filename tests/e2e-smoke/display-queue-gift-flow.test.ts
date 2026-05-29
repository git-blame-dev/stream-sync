import { describe, test, expect } from "bun:test";
import EventEmitter from "events";
import { PRIORITY_LEVELS } from "../../src/core/constants";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";
import { DisplayQueue } from "../../src/obs/display-queue.ts";

type DisplayQueueDependencies = NonNullable<
  ConstructorParameters<typeof DisplayQueue>[4]
>;
type SourcesManagerFixture = NonNullable<
  DisplayQueueDependencies["sourcesManager"]
>;
type GoalsManagerFixture = NonNullable<DisplayQueueDependencies["goalsManager"]>;
type EventBusHandler = (payload: Record<string, unknown>) => void;

type QueueAction = {
  type: string;
  source?: string;
  username?: string;
  message?: string;
  text?: string;
  group?: string;
  visible?: boolean;
  scene?: string;
  platform?: string;
};

describe("DisplayQueue gift flow (smoke E2E)", () => {
  test("processes a gift notification end-to-end", async () => {
    const emitter = new EventEmitter();
    const eventBus = {
      emit: (event: string, payload: Record<string, unknown>) =>
        emitter.emit(event, payload),
      subscribe: (event: string, handler: EventBusHandler) => {
        emitter.on(event, handler);
        return () => emitter.off(event, handler);
      },
    };

    const vfxEvents: unknown[] = [];
    emitter.on(
      PlatformEvents.VFX_COMMAND_RECEIVED,
      (payload: Record<string, unknown>) => {
        vfxEvents.push(payload);
        queueMicrotask(() => {
          emitter.emit(PlatformEvents.VFX_EFFECT_COMPLETED, {
            correlationId: payload.correlationId,
          });
        });
      },
    );

    const actions: QueueAction[] = [];
    const sourcesManager: SourcesManagerFixture = {
      updateChatMsgText: async (
        source: string,
        username: string,
        message: string,
      ) => {
        actions.push({ type: "chatText", source, username, message });
      },
      updateTextSource: async (source: string, text = "") => {
        actions.push({ type: "text", source, text });
      },
      clearTextSource: async (source: string) => {
        actions.push({ type: "clearText", source });
      },
      getSceneItemId: async () => ({ sceneItemId: 1 }),
      setSourceVisibility: async (
        _sceneName: string,
        source: string,
        visible: boolean,
      ) => {
        actions.push({ type: "sourceVisibility", source, visible });
      },
      getGroupSceneItemId: async () => ({ sceneItemId: 1 }),
      setGroupSourceVisibility: async (
        source: string,
        group: string | null | undefined,
        visible: boolean,
      ) => {
        if (!group) {
          return;
        }
        actions.push({ type: "groupVisibility", source, group, visible });
      },
      setPlatformLogoVisibility: async (platform: string) => {
        actions.push({ type: "platformLogo", platform });
      },
      setNotificationPlatformLogoVisibility: async (platform: string) => {
        actions.push({ type: "notificationLogo", platform });
      },
      hideAllPlatformLogos: async () => {},
      hideAllNotificationPlatformLogos: async () => {},
      setChatDisplayVisibility: async (visible: boolean, scene: string) => {
        actions.push({ type: "chatDisplay", visible, scene });
      },
      setNotificationDisplayVisibility: async (
        visible: boolean,
        scene: string,
      ) => {
        actions.push({ type: "notificationDisplay", visible, scene });
      },
      hideAllDisplays: async () => {},
      setSourceFilterEnabled: async () => {},
      getSourceFilterSettings: async () => ({}),
      setSourceFilterSettings: async () => {},
      clearSceneItemCache: () => {},
    };

    const obsCalls: Array<{ method: string; payload: unknown }> = [];
    const obsManager = {
      isReady: async () => true,
      call: async (method: string, payload: Record<string, unknown>) => {
        obsCalls.push({ method, payload });
        return {};
      },
    };

    const goalCalls: Array<{ platform: string; amount: number }> = [];
    const goalsManager: GoalsManagerFixture = {
      initializeGoalDisplay: async () => {},
      updateAllGoalDisplays: async () => {},
      updateGoalDisplay: async () => {},
      processDonationGoal: async (platform: unknown, amount: number) => {
        if (typeof platform === "string") {
          goalCalls.push({ platform, amount });
        }
        return { success: typeof platform === "string" };
      },
      processPaypiggyGoal: async () => ({ success: true }),
      getCurrentGoalStatus: () => ({ current: 0, target: 0, percentage: 0 }),
      getAllCurrentGoalStatuses: () => ({}),
    };

    const config = {
      autoProcess: false,
      maxQueueSize: 10,
      timing: {
        transitionDelay: 0,
        notificationClearDelay: 0,
        chatMessageDuration: 0,
      },
      chat: {
        sourceName: "chat-source",
        sceneName: "chat-scene",
        groupName: "chat-group",
        platformLogos: {},
      },
      notification: {
        sourceName: "notif-source",
        sceneName: "notif-scene",
        groupName: "notif-group",
        platformLogos: {},
      },
      obs: { ttsTxt: "tts-source" },
      gifts: { giftVideoSource: "gift-video", giftAudioSource: "gift-audio" },
      handcam: { enabled: false },
      ttsEnabled: true,
      tiktok: { messagesEnabled: true },
    };

    const queue = new DisplayQueue(
      obsManager,
      config,
      { PRIORITY_LEVELS },
      eventBus,
      {
        sourcesManager,
        goalsManager,
        delay: async () => {},
      },
    );
    queue.getDuration = () => 0;

    queue.addItem({
      type: "platform:gift",
      platform: "tiktok",
      vfxConfig: {
        commandKey: "gifts",
        command: "!gift",
        filename: "gift.mp4",
        mediaSource: "vfx top",
        vfxFilePath: "/tmp/vfx",
      },
      data: {
        username: "test-user",
        userId: "test-user-id",
        giftType: "rose",
        giftCount: 1,
        amount: 100,
        currency: "coins",
        displayMessage: "test-user sent a gift",
        ttsMessage: "test-user sent a gift",
      },
    });

    await queue.processQueue();

    expect(queue.queue).toHaveLength(0);
    expect(goalCalls).toEqual([{ platform: "tiktok", amount: 100 }]);
    expect(vfxEvents).toHaveLength(1);
    expect(vfxEvents[0]).toEqual(
      expect.objectContaining({
        commandKey: "gifts",
        username: "test-user",
        platform: "tiktok",
      }),
    );

    const notificationText = actions.find(
      (action) => action.type === "text" && action.source === "notif-source",
    );
    const ttsText = actions.find(
      (action) => action.type === "text" && action.source === "tts-source",
    );

    expect(notificationText?.text).toBe("test-user sent a gift");
    expect(ttsText?.text).toBe("test-user sent a gift");
    expect(
      actions.some(
        (action) =>
          action.type === "notificationDisplay" && action.visible === true,
      ),
    ).toBe(true);
    expect(obsCalls.length).toBe(2);
  });
});
