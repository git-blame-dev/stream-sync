import { vi, describe, expect, it, beforeEach, afterEach } from 'bun:test';

import { createHandcamConfigFixture } from "../../helpers/config-fixture";
import { PRIORITY_LEVELS } from "../../../src/core/constants";

import { DisplayQueue } from "../../../src/obs/display-queue.ts";
import { EventEmitter } from "events";

describe("DisplayQueue gift effects handcam glow", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    vi.restoreAllMocks();
  });

  function createQueue(handcamEnabled = true) {
    const recordedTexts: string[] = [];
    const mockSourcesManager = {
      updateTextSource: vi.fn<(...args: [string, string?]) => Promise<void>>((_source, text) => {
        if (text !== undefined) {
        recordedTexts.push(text);
        }
        return Promise.resolve();
      }),
      clearTextSource: vi.fn<(...args: [string]) => Promise<void>>(() => Promise.resolve()),
      updateChatMsgText: vi.fn<(...args: [string, string, string]) => Promise<void>>(() => Promise.resolve()),
      getSceneItemId: vi.fn<(...args: [string, string]) => Promise<{ sceneItemId: number }>>(async () => ({ sceneItemId: 1 })),
      setSourceVisibility: vi.fn<(...args: [string, string, boolean]) => Promise<void>>(() => Promise.resolve()),
      setNotificationDisplayVisibility: vi.fn<(...args: [boolean]) => Promise<void>>(() => Promise.resolve()),
      setChatDisplayVisibility: vi.fn<(...args: [boolean]) => Promise<void>>(() => Promise.resolve()),
      hideAllDisplays: vi.fn<(...args: []) => Promise<void>>(() => Promise.resolve()),
      setPlatformLogoVisibility: vi.fn<(...args: [string, Record<string, unknown>]) => Promise<void>>(() => Promise.resolve()),
      setNotificationPlatformLogoVisibility: vi.fn<(...args: [string, Record<string, unknown>]) => Promise<void>>(() => Promise.resolve()),
      hideAllPlatformLogos: vi.fn<(...args: [Record<string, unknown>]) => Promise<void>>(() => Promise.resolve()),
      hideAllNotificationPlatformLogos: vi.fn<(...args: [Record<string, unknown>]) => Promise<void>>(() => Promise.resolve()),
      getGroupSceneItemId: vi.fn<(...args: [string, string]) => Promise<{ sceneItemId: number }>>(async () => ({ sceneItemId: 1 })),
      setGroupSourceVisibility: vi.fn<(...args: [string, string | null | undefined, boolean]) => Promise<void>>(() => Promise.resolve()),
      setSourceFilterEnabled: vi.fn<(...args: [string, string, boolean]) => Promise<void>>(() => Promise.resolve()),
      getSourceFilterSettings: vi.fn<(...args: [string, string]) => Promise<Record<string, unknown>>>(async () => ({})),
      setSourceFilterSettings: vi.fn<(...args: [string, string, Record<string, unknown>]) => Promise<void>>(() => Promise.resolve()),
      clearSceneItemCache: vi.fn<(...args: []) => void>(() => {}),
    };

    const obsManager = {
      ensureConnected: vi.fn<(...args: []) => Promise<void>>(async () => {}),
      call: vi.fn<(...args: unknown[]) => Promise<{}>>().mockResolvedValue({}),
      isConnected: () => true,
      isReady: () => Promise.resolve(true),
    };

    const mockGoalsManager = {
      processDonationGoal: vi.fn<(...args: unknown[]) => Promise<{ success: true; }>>().mockResolvedValue({ success: true }),
      processPaypiggyGoal: vi.fn<(...args: unknown[]) => Promise<{ success: true; }>>().mockResolvedValue({ success: true }),
      initializeGoalDisplay: vi.fn<(...args: []) => Promise<void>>(() => Promise.resolve()),
      updateAllGoalDisplays: vi.fn<(...args: []) => Promise<void>>(() => Promise.resolve()),
      updateGoalDisplay: vi.fn<(...args: [string, string?]) => Promise<void>>(() => Promise.resolve()),
      getCurrentGoalStatus: vi.fn<(...args: [string]) => Record<string, unknown> | null>(() => null),
      getAllCurrentGoalStatuses: vi.fn<(...args: []) => Record<string, unknown>>(() => ({})),
    };

    const queue = new DisplayQueue(
      obsManager,
      {
        ttsChatEnabled: true,
        ttsNotificationsEnabled: true,
        chat: {},
        notification: {},
        obs: {},
        handcam: createHandcamConfigFixture({ enabled: handcamEnabled, rampUpDuration: 0, rampDownDuration: 0, holdDuration: 0, totalSteps: 1 }),
      },
      { PRIORITY_LEVELS },
      new EventEmitter(),
      {
        sourcesManager: mockSourcesManager,
        goalsManager: mockGoalsManager,
        delay: async () => {},
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).endsWith("/v1/speak") && init?.method === "POST") {
            recordedTexts.push(JSON.parse(String(init.body)).text);
          }
          return new Response(null, { status: 200 });
        },
      },
    );

    return { queue, recordedTexts, mockGoalsManager, obsManager };
  }

  it("processes gift notification effects without errors when handcam enabled", async () => {
    const { queue, recordedTexts, obsManager } = createQueue(true);

    await expect(
      queue.handleNotificationEffects({
        type: "platform:gift",
        platform: "tiktok",
        data: {
          username: "test-gifter",
          displayMessage: "sent a gift",
          ttsMessage: "test-gifter sent a gift",
          giftType: "rose",
          giftCount: 1,
          amount: 1,
          currency: "coins",
        },
      }),
    ).resolves.toBeUndefined();

    expect(recordedTexts.length).toBeGreaterThan(0);
    expect(obsManager.ensureConnected).toHaveBeenCalled();
    expect(obsManager.call).toHaveBeenCalledWith("GetSourceFilter", {
      sourceName: "test-handcam-source", filterName: "test-glow-filter",
    });
  });

  it("updates TTS text source for gift notifications", async () => {
    const { queue, recordedTexts } = createQueue(true);

    await queue.handleNotificationEffects({
      type: "platform:gift",
      platform: "tiktok",
      data: {
        username: "test-gifter",
        ttsMessage: "test-gifter sent a rose",
        displayMessage: "sent a rose",
      },
    });

    expect(recordedTexts).toContain("test-gifter sent a rose");
  });

  it("processes gift notification without handcam glow when disabled", async () => {
    const { queue, recordedTexts } = createQueue(false);

    await expect(
      queue.handleNotificationEffects({
        type: "platform:gift",
        platform: "tiktok",
        data: {
          username: "test-gifter",
          ttsMessage: "test-gifter sent a gift",
          displayMessage: "sent a gift",
        },
      }),
    ).resolves.toBeUndefined();

    expect(recordedTexts.length).toBeGreaterThan(0);
  });
});
