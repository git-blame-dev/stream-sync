import { describe, expect, beforeEach, it } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import {
  OBSSourcesManager,
  createOBSSourcesManager,
  getDefaultSourcesManager,
  resetDefaultSourcesManager,
  sanitizeForOBS,
} from "../../../src/obs/sources.ts";

describe("obs/sources behavior", () => {
  type SourcesObsManager = Parameters<typeof createOBSSourcesManager>[0];
  type SourcesConfig = Omit<Parameters<typeof createOBSSourcesManager>[1], "logger" | "ensureOBSConnected" | "obsCall">;
  type ObsCallArgs = [requestType: string, payload?: Record<string, unknown>];

  let mockLogger: typeof noOpLogger;
  let sourcesConfig: SourcesConfig;

  const createReadyObsManager = (): SourcesObsManager => ({
    ensureConnected: createMockFn<[], Promise<void>>().mockResolvedValue(),
    call: createMockFn<
      [requestType: string, payload?: Record<string, unknown>],
      Promise<unknown>
    >().mockResolvedValue({}),
    isConnected: createMockFn<[], boolean>().mockReturnValue(true),
    isReady: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
  });

  const obsRequests = (obsCall: { mock: { calls: ObsCallArgs[] } }) =>
    obsCall.mock.calls.map(([requestType, payload]) => ({ requestType, payload }));

  beforeEach(() => {
    mockLogger = noOpLogger;
    sourcesConfig = {
      chatGroupName: "TestStatusGroup",
      notificationGroupName: "TestNotifyGroup",
      fadeDelay: 10,
    };
  });

it("sanitizes text before sending OBS text-source updates", async () => {
    const mockCall = createMockFn<
      [requestType: string, payload?: Record<string, unknown>],
      Promise<unknown>
    >()
      .mockResolvedValueOnce({ inputSettings: {} })
      .mockResolvedValueOnce();
    const mockEnsureConnected = createMockFn<[], Promise<void>>().mockResolvedValue();

    const sources = createOBSSourcesManager(
      createReadyObsManager(),
      {
        logger: mockLogger,
        ...sourcesConfig,
        ensureOBSConnected: mockEnsureConnected,
        obsCall: mockCall,
      },
    );

    await sources.updateTextSource("TestChatText", "Hello 🌟");

  const requests = mockCall.mock.calls.map(([requestType, payload]) => ({
    requestType,
    payload,
  }));
  expect(requests).toEqual([
    {
      requestType: "GetInputSettings",
      payload: { inputName: "TestChatText" },
    },
    {
      requestType: "SetInputSettings",
      payload: {
        inputName: "TestChatText",
        inputSettings: { text: "Hello " },
        overlay: false,
      },
    },
  ]);
});

  it("caches group scene item lookups to avoid repeated OBS calls", async () => {
    const obsCall = createMockFn<
      [requestType: string, payload?: Record<string, unknown>],
      Promise<unknown>
    >().mockResolvedValue({
      sceneItems: [{ sourceName: "TestLogo", sceneItemId: 42 }],
    });

    const sources = createOBSSourcesManager(
      createReadyObsManager(),
      {
        logger: mockLogger,
        ...sourcesConfig,
        ensureOBSConnected: createMockFn<[], Promise<void>>().mockResolvedValue(),
        obsCall,
      },
    );

    const firstLookup = await sources.getGroupSceneItemId(
      "TestLogo",
      "TestLogos",
    );
    expect(firstLookup).toEqual({ sceneItemId: 42 });

    await sources.getGroupSceneItemId("TestLogo", "TestLogos");
    expect(obsCall).toHaveBeenCalledTimes(1);
  });

  it("retries lookup on subsequent calls when source is not found", async () => {
    const obsCall = createMockFn<
      [requestType: string, payload?: Record<string, unknown>],
      Promise<unknown>
    >().mockResolvedValue({ sceneItems: [] });
    const sources = createOBSSourcesManager(
      createReadyObsManager(),
      {
        logger: mockLogger,
        ...sourcesConfig,
        ensureOBSConnected: createMockFn<[], Promise<void>>().mockResolvedValue(),
        obsCall,
      },
    );

    await expect(
      sources.getGroupSceneItemId("TestMissing", "TestGroup"),
    ).rejects.toThrow(/TestMissing/);
    await expect(
      sources.getGroupSceneItemId("TestMissing", "TestGroup"),
    ).rejects.toThrow(/TestMissing/);

    expect(obsCall).toHaveBeenCalledTimes(2);
  });

  it("shows exactly the active notification platform logo and hides the others", async () => {
    const obsCall = createMockFn<ObsCallArgs, Promise<unknown>>().mockResolvedValue({
      sceneItems: [
        { sourceName: "NotifyTikTokLogo", sceneItemId: 11 },
        { sourceName: "NotifyTwitchLogo", sceneItemId: 12 },
        { sourceName: "NotifyYouTubeLogo", sceneItemId: 13 },
      ],
    });

    const sources = createOBSSourcesManager(
      createReadyObsManager(),
      {
        logger: mockLogger,
        ...sourcesConfig,
        ensureOBSConnected: createMockFn<[], Promise<void>>().mockResolvedValue(),
        obsCall,
      },
    );

    await sources.setNotificationPlatformLogoVisibility("twitch", {
      tiktok: "NotifyTikTokLogo",
      twitch: "NotifyTwitchLogo",
      youtube: "NotifyYouTubeLogo",
      missing: "",
      malformed: { sourceName: "NotAString" },
    });

    expect(obsRequests(obsCall)).toEqual([
      {
        requestType: "GetGroupSceneItemList",
        payload: { sceneName: "TestNotifyGroup" },
      },
      {
        requestType: "SetSceneItemEnabled",
        payload: {
          sceneName: "TestNotifyGroup",
          sceneItemId: 11,
          sceneItemEnabled: false,
        },
      },
      {
        requestType: "GetGroupSceneItemList",
        payload: { sceneName: "TestNotifyGroup" },
      },
      {
        requestType: "SetSceneItemEnabled",
        payload: {
          sceneName: "TestNotifyGroup",
          sceneItemId: 12,
          sceneItemEnabled: true,
        },
      },
      {
        requestType: "GetGroupSceneItemList",
        payload: { sceneName: "TestNotifyGroup" },
      },
      {
        requestType: "SetSceneItemEnabled",
        payload: {
          sceneName: "TestNotifyGroup",
          sceneItemId: 13,
          sceneItemEnabled: false,
        },
      },
    ]);
  });

  it("hides every configured notification logo with notification-group payloads", async () => {
    const obsCall = createMockFn<ObsCallArgs, Promise<unknown>>().mockResolvedValue({
      sceneItems: [
        { sourceName: "NotifyTikTokLogo", sceneItemId: 21 },
        { sourceName: "NotifyTwitchLogo", sceneItemId: 22 },
      ],
    });

    const sources = createOBSSourcesManager(
      createReadyObsManager(),
      {
        logger: mockLogger,
        ...sourcesConfig,
        ensureOBSConnected: createMockFn<[], Promise<void>>().mockResolvedValue(),
        obsCall,
      },
    );

    await sources.hideAllNotificationPlatformLogos({
      tiktok: "NotifyTikTokLogo",
      twitch: "NotifyTwitchLogo",
      ignored: null,
    });

    expect(obsRequests(obsCall)).toEqual([
      {
        requestType: "GetGroupSceneItemList",
        payload: { sceneName: "TestNotifyGroup" },
      },
      {
        requestType: "SetSceneItemEnabled",
        payload: {
          sceneName: "TestNotifyGroup",
          sceneItemId: 21,
          sceneItemEnabled: false,
        },
      },
      {
        requestType: "GetGroupSceneItemList",
        payload: { sceneName: "TestNotifyGroup" },
      },
      {
        requestType: "SetSceneItemEnabled",
        payload: {
          sceneName: "TestNotifyGroup",
          sceneItemId: 22,
          sceneItemEnabled: false,
        },
      },
    ]);
  });

  it("hides displays before clearing text sources", async () => {
    const delay = createMockFn<[ms: number], Promise<void>>().mockResolvedValue();
    const obsCall = createMockFn<ObsCallArgs, Promise<unknown>>(
      async (requestType, payload) => {
        if (requestType === "GetSceneItemId") {
          return {
            sceneItemId: payload?.sourceName === "TestStatusGroup" ? 31 : 32,
          };
        }

        if (requestType === "GetInputSettings") {
          return { inputSettings: { text: "existing", font: "Inter" } };
        }

        return {};
      },
    );

    const sources = createOBSSourcesManager(
      createReadyObsManager(),
      {
        logger: mockLogger,
        ...sourcesConfig,
        ensureOBSConnected: createMockFn<[], Promise<void>>().mockResolvedValue(),
        obsCall,
        utils: { delay },
      },
    );

    await sources.hideAllDisplays(
      "ChatScene",
      "NotificationScene",
      {},
      {},
      "TtsText",
      "NotificationText",
    );

    const requests = obsRequests(obsCall);
    const firstClearIndex = requests.findIndex(
      ({ requestType }) => requestType === "GetInputSettings",
    );
    const chatHideIndex = requests.findIndex(
      ({ payload }) => payload?.sceneName === "ChatScene",
    );
    const notificationHideIndex = requests.findIndex(
      ({ payload }) => payload?.sceneName === "NotificationScene",
    );
    const displayHideRequests = requests.filter(
      ({ requestType }) => requestType === "SetSceneItemEnabled",
    );
    const clearTextRequests = requests.filter(
      ({ requestType }) => requestType === "SetInputSettings",
    );

    expect(firstClearIndex).toBeGreaterThan(1);
    expect(chatHideIndex).toBeGreaterThanOrEqual(0);
    expect(notificationHideIndex).toBeGreaterThanOrEqual(0);
    expect(chatHideIndex).toBeLessThan(firstClearIndex);
    expect(notificationHideIndex).toBeLessThan(firstClearIndex);
    expect(displayHideRequests).toEqual([
      {
        requestType: "SetSceneItemEnabled",
        payload: {
          sceneName: "ChatScene",
          sceneItemId: 31,
          sceneItemEnabled: false,
        },
      },
      {
        requestType: "SetSceneItemEnabled",
        payload: {
          sceneName: "NotificationScene",
          sceneItemId: 32,
          sceneItemEnabled: false,
        },
      },
    ]);
    expect(clearTextRequests).toEqual([
      {
        requestType: "SetInputSettings",
        payload: {
          inputName: "TtsText",
          inputSettings: { text: "", font: "Inter" },
          overlay: false,
        },
      },
      {
        requestType: "SetInputSettings",
        payload: {
          inputName: "NotificationText",
          inputSettings: { text: "", font: "Inter" },
          overlay: false,
        },
      },
    ]);
    expect(delay.mock.calls).toEqual([[10], [10], [200]]);
  });

  it("creates the default manager from injected config and clears its cache invalidator on reset", async () => {
    resetDefaultSourcesManager();

    const cacheInvalidators: Array<(() => void) | null> = [];
    const obsCall = createMockFn<ObsCallArgs, Promise<unknown>>().mockResolvedValue({});
    const obsManager: SourcesObsManager = {
      ...createReadyObsManager(),
      setSourcesCacheInvalidator: (invalidator) => cacheInvalidators.push(invalidator),
    };

    const defaultSources = getDefaultSourcesManager({
      logger: mockLogger,
      config: {
        obs: {
          chatMsgGroup: "DefaultChatGroup",
          notificationMsgGroup: "DefaultNotificationGroup",
        },
        timing: { fadeDuration: 25 },
      },
      ensureOBSConnected: createMockFn<[], Promise<void>>().mockResolvedValue(),
      obsCall,
      getOBSConnectionManager: () => obsManager,
    });

    await defaultSources.setSourceFilterEnabled("DefaultSource", "DefaultFilter", true);
    resetDefaultSourcesManager();

    expect(obsRequests(obsCall)).toEqual([
      {
        requestType: "SetSourceFilterEnabled",
        payload: {
          sourceName: "DefaultSource",
          filterName: "DefaultFilter",
          filterEnabled: true,
        },
      },
    ]);
    expect(cacheInvalidators).toEqual([expect.any(Function), null]);
  });

  it("falls back to a degraded default manager when the OBS connection manager is unavailable", async () => {
    resetDefaultSourcesManager();

    const defaultSources = getDefaultSourcesManager({
      logger: mockLogger,
      config: {
        obs: {
          chatMsgGroup: "DefaultChatGroup",
          notificationMsgGroup: "DefaultNotificationGroup",
        },
        timing: { fadeDuration: 25 },
      },
      getOBSConnectionManager: () => {
        throw new Error("OBS unavailable");
      },
    });

    await defaultSources.updateTextSource("WillBeSkipped", "not sent");

    expect(defaultSources.isDegraded).toBe(true);

    resetDefaultSourcesManager();
  });

  it("constructs class instances with the sources API and preserves sanitize edge cases", async () => {
    const obsCall = createMockFn<ObsCallArgs, Promise<unknown>>()
      .mockResolvedValueOnce({ inputSettings: {} })
      .mockResolvedValueOnce();
    const sources = new OBSSourcesManager(
      createReadyObsManager(),
      {
        logger: mockLogger,
        ...sourcesConfig,
        ensureOBSConnected: createMockFn<[], Promise<void>>().mockResolvedValue(),
        obsCall,
      },
    ) as ReturnType<typeof createOBSSourcesManager>;

    await sources.updateTextSource("ClassText", undefined);

    expect(sanitizeForOBS("Hi 🚀")).toBe("Hi ");
    expect(sanitizeForOBS(null)).toBe("");
    expect(obsRequests(obsCall)).toEqual([
      {
        requestType: "GetInputSettings",
        payload: { inputName: "ClassText" },
      },
      {
        requestType: "SetInputSettings",
        payload: {
          inputName: "ClassText",
          inputSettings: { text: "" },
          overlay: false,
        },
      },
    ]);
  });
});
