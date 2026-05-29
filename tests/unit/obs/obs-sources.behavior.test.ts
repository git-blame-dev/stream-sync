import { describe, expect, beforeEach, it } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createOBSSourcesManager } from "../../../src/obs/sources.ts";

describe("obs/sources behavior", () => {
  type SourcesObsManager = Parameters<typeof createOBSSourcesManager>[0];
  type SourcesConfig = Omit<Parameters<typeof createOBSSourcesManager>[1], "logger" | "ensureOBSConnected" | "obsCall">;

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
});
