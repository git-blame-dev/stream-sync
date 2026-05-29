import { describe, expect, beforeEach, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { createMockOBSManager } from "../../helpers/mock-factories";
import { initializeTestLogging } from "../../helpers/test-setup";
import {
  DisplayQueue,
  initializeDisplayQueue,
  resetDisplayQueue,
} from "../../../src/obs/display-queue.ts";
import { PRIORITY_LEVELS } from "../../../src/core/constants";
import { getDefaultSourcesManager } from "../../../src/obs/sources.ts";
import { getDefaultGoalsManager } from "../../../src/obs/goals.ts";

initializeTestLogging();

type DisplayQueueDependencies = ConstructorParameters<typeof DisplayQueue>[4];
type SourcesManagerApi = ReturnType<typeof getDefaultSourcesManager>;
type GoalsManager = ReturnType<typeof getDefaultGoalsManager>;

const resolvedVoid = () => Promise.resolve();

function createSourcesManagerFixture(): SourcesManagerApi {
  return {
    updateTextSource: createMockFn<[string, string?], Promise<void>>(resolvedVoid),
    clearTextSource: createMockFn<[string], Promise<void>>(resolvedVoid),
    updateChatMsgText: createMockFn<[string, string, string], Promise<void>>(resolvedVoid),
    getSceneItemId: createMockFn<[string, string], Promise<{ sceneItemId: number }>>(async () => ({ sceneItemId: 1 })),
    setSourceVisibility: createMockFn<[string, string, boolean], Promise<void>>(resolvedVoid),
    getGroupSceneItemId: createMockFn<[string, string], Promise<{ sceneItemId: number }>>(async () => ({ sceneItemId: 1 })),
    setGroupSourceVisibility: createMockFn<[string, string | null | undefined, boolean], Promise<void>>(resolvedVoid),
    setPlatformLogoVisibility: createMockFn<[string, Record<string, unknown>], Promise<void>>(resolvedVoid),
    setNotificationPlatformLogoVisibility: createMockFn<[string, Record<string, unknown>], Promise<void>>(resolvedVoid),
    hideAllPlatformLogos: createMockFn<[Record<string, unknown>], Promise<void>>(resolvedVoid),
    hideAllNotificationPlatformLogos: createMockFn<[Record<string, unknown>], Promise<void>>(resolvedVoid),
    setChatDisplayVisibility: createMockFn<[boolean], Promise<void>>(resolvedVoid),
    setNotificationDisplayVisibility: createMockFn<[boolean], Promise<void>>(resolvedVoid),
    hideAllDisplays: createMockFn<[], Promise<void>>(resolvedVoid),
    setSourceFilterEnabled: createMockFn<[string, string, boolean], Promise<void>>(resolvedVoid),
    getSourceFilterSettings: createMockFn<[string, string], Promise<Record<string, unknown>>>(async () => ({})),
    setSourceFilterSettings: createMockFn<[string, string, Record<string, unknown>], Promise<void>>(resolvedVoid),
    clearSceneItemCache: createMockFn<[], void>(() => {}),
  };
}

function createGoalsManagerFixture(): GoalsManager {
  return {
    initializeGoalDisplay: createMockFn<[], Promise<void>>(resolvedVoid),
    updateAllGoalDisplays: createMockFn<[], Promise<void>>(resolvedVoid),
    updateGoalDisplay: createMockFn<[string, string?], Promise<void>>(resolvedVoid),
    processDonationGoal: createMockFn<[unknown, number], Promise<{ success: boolean }>>(async () => ({ success: true })),
    processPaypiggyGoal: createMockFn<[string], Promise<{ success: boolean }>>(async () => ({ success: true })),
    getCurrentGoalStatus: createMockFn<[string], Record<string, unknown> | null>(() => null),
    getAllCurrentGoalStatuses: createMockFn<[], Record<string, unknown>>(() => ({})),
  };
}

describe("DisplayQueue DI requirements", () => {
  afterEach(() => {
    restoreAllMocks();
    resetDisplayQueue();
  });

  beforeEach(() => {
    initializeTestLogging();
  });

  it("requires an OBS manager in the constructor", () => {
    expect(() => Reflect.construct(DisplayQueue, [null, {}, {}, null, {}])).toThrow(
      /OBSConnectionManager/,
    );
  });

  it("accepts items when initialized with injected obsManager", () => {
    const mockObsManager = createMockOBSManager("connected");

    const queue = initializeDisplayQueue(
      mockObsManager,
      {
        autoProcess: false,
        chat: {
          sourceName: "chat",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
        notification: {
          sourceName: "notification",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
      },
      {
        PRIORITY_LEVELS,
        CHAT_MESSAGE_DURATION: 4500,
      },
      null,
      {},
    );

    expect(() =>
      queue.addItem({
        type: "chat",
        platform: "twitch",
        data: { username: "test-user", message: "Hello" },
      }),
    ).not.toThrow();

    expect(queue.queue.length).toBe(1);
  });

  it("throws when dependencies throw during construction", () => {
    const mockObsManager = createMockOBSManager("connected");
    const dependencies = {};
    Object.defineProperty(dependencies, "sourcesManager", {
      get: () => {
        throw new Error("test-injected error");
      },
    });

    expect(() => {
      new DisplayQueue(
        mockObsManager,
        { autoProcess: true },
        { PRIORITY_LEVELS },
        null,
        dependencies,
      );
    }).toThrow("test-injected error");
  });

  it("passes initializeDisplayQueue dependencies through to DisplayQueue construction", () => {
    const mockObsManager = createMockOBSManager("connected");
    const injectedSourcesManager = createSourcesManagerFixture();
    const injectedGoalsManager = createGoalsManagerFixture();

    const queue = initializeDisplayQueue(
      mockObsManager,
      {
        autoProcess: false,
        chat: {
          sourceName: "chat",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
        notification: {
          sourceName: "notification",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
      },
      { PRIORITY_LEVELS, CHAT_MESSAGE_DURATION: 4500 },
      null,
      {
        sourcesManager: injectedSourcesManager,
        goalsManager: injectedGoalsManager,
      } satisfies DisplayQueueDependencies,
    );

    expect(queue.sourcesManager).toBe(injectedSourcesManager);
    expect(queue.goalsManager).toBe(injectedGoalsManager);
  });

  it("rebinds obs manager on repeated initializeDisplayQueue calls", () => {
    const firstManager = createMockOBSManager("connected");
    const secondManager = createMockOBSManager("connected");

    const queue = initializeDisplayQueue(
      firstManager,
      {
        autoProcess: false,
        chat: {
          sourceName: "chat",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
        notification: {
          sourceName: "notification",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
      },
      { PRIORITY_LEVELS, CHAT_MESSAGE_DURATION: 4500 },
      null,
      {},
    );

    initializeDisplayQueue(
      secondManager,
      {
        autoProcess: false,
        chat: {
          sourceName: "chat",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
        notification: {
          sourceName: "notification",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
      },
      { PRIORITY_LEVELS, CHAT_MESSAGE_DURATION: 4500 },
      null,
      {},
    );

    expect(queue.obsManager).toBe(secondManager);
  });

  it("supports resetting display queue singleton between initializations", () => {
    const manager = createMockOBSManager("connected");
    const first = initializeDisplayQueue(
      manager,
      {
        autoProcess: false,
        chat: {
          sourceName: "chat",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
        notification: {
          sourceName: "notification",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
      },
      { PRIORITY_LEVELS, CHAT_MESSAGE_DURATION: 4500 },
      null,
      {},
    );

    resetDisplayQueue();

    const second = initializeDisplayQueue(
      manager,
      {
        autoProcess: false,
        chat: {
          sourceName: "chat",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
        notification: {
          sourceName: "notification",
          sceneName: "scene",
          groupName: "group",
          platformLogos: {},
        },
      },
      { PRIORITY_LEVELS, CHAT_MESSAGE_DURATION: 4500 },
      null,
      {},
    );

    expect(second).not.toBe(first);
  });
});
