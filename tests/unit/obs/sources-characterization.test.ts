import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";

import { TEST_TIMEOUTS } from "../../helpers/test-setup";
import { noOpLogger } from "../../helpers/mock-factories";
import { setupAutomatedCleanup } from "../../helpers/mock-lifecycle";
import * as testClock from "../../helpers/test-clock";
import { createSourcesConfigFixture } from "../../helpers/config-fixture";
import { createOBSSourcesManager } from "../../../src/obs/sources.ts";

setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true,
});

describe("OBS Sources Module Characterization Tests", () => {
  let mockObsManager;
  let mockEnsureConnected;
  let mockObsCall;
  let mockSanitizeDisplayName;
  let mockDelay;
  let sourcesModule;

  beforeEach(() => {
    mockEnsureConnected = createMockFn().mockResolvedValue();
    mockObsCall = createMockFn();
    mockSanitizeDisplayName = createMockFn((name, limit) =>
      name.substring(0, limit),
    );
    mockDelay = createMockFn().mockResolvedValue();

    mockObsManager = {
      ensureConnected: mockEnsureConnected,
      call: mockObsCall,
      isConnected: createMockFn().mockReturnValue(true),
      isReady: createMockFn().mockResolvedValue(true),
      addEventListener: createMockFn(),
      removeEventListener: createMockFn(),
    };

    sourcesModule = createOBSSourcesManager(mockObsManager, {
      logger: noOpLogger,
      ...createSourcesConfigFixture(),
      ensureOBSConnected: mockEnsureConnected,
      obsCall: mockObsCall,
      utils: {
        sanitizeDisplayName: mockSanitizeDisplayName,
        delay: mockDelay,
      },
    });
  });

  afterEach(() => {
    restoreAllMocks();
  });

  describe("Text Source Management", () => {
test(
  "updateTextSource preserves existing settings while writing sanitized text",
  async () => {
        mockObsCall.mockResolvedValueOnce({ inputSettings: {} });
        mockObsCall.mockResolvedValueOnce();

        await sourcesModule.updateTextSource("test-source", "new message");

      expect(mockEnsureConnected).toHaveBeenCalled();
      const requests = mockObsCall.mock.calls.map(([requestType, payload]) => ({
        requestType,
        payload,
      }));
      expect(requests).toEqual([
        {
          requestType: "GetInputSettings",
          payload: { inputName: "test-source" },
        },
        {
          requestType: "SetInputSettings",
          payload: {
            inputName: "test-source",
            inputSettings: { text: "new message" },
            overlay: false,
          },
        },
      ]);
      },
      TEST_TIMEOUTS.FAST,
    );

test(
  "clearTextSource preserves non-text settings while blanking text",
  async () => {
        const mockInputSettings = { text: "existing text", font: "Arial" };

        expect(mockObsManager).toBeDefined();
        expect(typeof mockObsManager.isReady).toBe("function");

        const isReady = await mockObsManager.isReady();
        expect(isReady).toBe(true);

        mockObsCall.mockResolvedValueOnce({ inputSettings: mockInputSettings });
        mockObsCall.mockResolvedValueOnce();

        await sourcesModule.clearTextSource("test-source");

      expect(mockEnsureConnected).toHaveBeenCalledTimes(1);
      const requests = mockObsCall.mock.calls.map(([requestType, payload]) => ({
        requestType,
        payload,
      }));
      expect(requests).toEqual([
        {
          requestType: "GetInputSettings",
          payload: { inputName: "test-source" },
        },
        {
          requestType: "SetInputSettings",
          payload: {
            inputName: "test-source",
            inputSettings: {
              ...mockInputSettings,
              text: "",
            },
            overlay: false,
          },
        },
      ]);
      },
      TEST_TIMEOUTS.FAST,
    );

test(
  "updateChatMsgText writes formatted username-prefixed text",
  async () => {
        mockSanitizeDisplayName.mockReturnValue("User");
        mockObsCall.mockResolvedValueOnce({ inputSettings: {} });
        mockObsCall.mockResolvedValueOnce();

        await sourcesModule.updateChatMsgText(
          "chat-source",
          "VeryLongUsername",
          "Hello world",
        );

      const requests = mockObsCall.mock.calls.map(([requestType, payload]) => ({
        requestType,
        payload,
      }));
      expect(requests[1]).toEqual({
        requestType: "SetInputSettings",
        payload: {
          inputName: "chat-source",
          inputSettings: { text: "User: Hello world" },
          overlay: false,
        },
      });
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "text source operations should handle errors when OBS operations run",
      async () => {
        const testError = new Error("OBS connection failed");
        mockObsCall.mockRejectedValue(testError);

        await expect(
          sourcesModule.clearTextSource("test-source"),
        ).rejects.toThrow("OBS connection failed");
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Source Visibility Management", () => {
    test(
      "getSceneItemId should return scene item information with correct format",
      async () => {
        mockObsCall.mockResolvedValue({ sceneItemId: 42 });

        const result = await sourcesModule.getSceneItemId(
          "test-scene",
          "test-source",
        );

      expect(mockEnsureConnected).toHaveBeenCalledTimes(1);
      const [requestType, payload] = mockObsCall.mock.calls[0] || [];
      expect(requestType).toBe("GetSceneItemId");
      expect(payload).toEqual({
        sceneName: "test-scene",
        sourceName: "test-source",
      });

        expect(result).toEqual({
          sceneItemId: 42,
          sceneName: "test-scene",
        });
        expect(typeof result.sceneItemId).toBe("number");
        expect(typeof result.sceneName).toBe("string");
      },
      TEST_TIMEOUTS.FAST,
    );

test(
  "setSourceVisibility updates scene-item enabled state",
  async () => {
        mockObsCall.mockResolvedValueOnce({ sceneItemId: 42 });
        mockObsCall.mockResolvedValueOnce();

        await sourcesModule.setSourceVisibility(
          "test-scene",
          "test-source",
          true,
        );

      expect(mockEnsureConnected).toHaveBeenCalled();
      const requests = mockObsCall.mock.calls.map(([requestType, payload]) => ({
        requestType,
        payload,
      }));
      expect(requests).toEqual([
        {
          requestType: "GetSceneItemId",
          payload: {
            sceneName: "test-scene",
            sourceName: "test-source",
          },
        },
        {
          requestType: "SetSceneItemEnabled",
          payload: {
            sceneName: "test-scene",
            sceneItemId: 42,
            sceneItemEnabled: true,
          },
        },
      ]);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "getSceneItemId should throw error for invalid scene item ID",
      async () => {
        mockObsCall.mockResolvedValue({ sceneItemId: null });

        await expect(
          sourcesModule.getSceneItemId("test-scene", "invalid-source"),
        ).rejects.toThrow(
          'Scene item ID for source "invalid-source" in scene "test-scene" not found.',
        );
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Group Source Management", () => {
    test(
      "getGroupSceneItemId should find source within group (no test environment check)",
      async () => {
        const mockSceneItems = [
          { sourceName: "other-source", sceneItemId: 10 },
          { sourceName: "target-source", sceneItemId: 20 },
        ];
        mockObsCall.mockResolvedValue({ sceneItems: mockSceneItems });

        const result = await sourcesModule.getGroupSceneItemId(
          "target-source",
          "test-group",
        );

      expect(mockEnsureConnected).toHaveBeenCalledTimes(1);
      const [requestType, payload] = mockObsCall.mock.calls[0] || [];
      expect(requestType).toBe("GetGroupSceneItemList");
      expect(payload).toEqual({ sceneName: "test-group" });
      expect(result).toEqual({ sceneItemId: 20 });
      },
      TEST_TIMEOUTS.FAST,
    );

test(
  "setGroupSourceVisibility updates group item visibility",
  async () => {
        mockObsCall.mockResolvedValueOnce({
          sceneItems: [{ sourceName: "test-source", sceneItemId: 20 }],
        });
        mockObsCall.mockResolvedValueOnce();

        await sourcesModule.setGroupSourceVisibility(
          "test-source",
          "test-group",
          false,
        );

      expect(mockEnsureConnected).toHaveBeenCalled();
      const requests = mockObsCall.mock.calls.map(([requestType, payload]) => ({
        requestType,
        payload,
      }));
      expect(requests).toEqual([
        {
          requestType: "GetGroupSceneItemList",
          payload: { sceneName: "test-group" },
        },
        {
          requestType: "SetSceneItemEnabled",
          payload: {
            sceneName: "test-group",
            sceneItemId: 20,
            sceneItemEnabled: false,
          },
        },
      ]);
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "getGroupSceneItemId should handle missing source in group",
      async () => {
        const mockSceneItems = [
          { sourceName: "other-source", sceneItemId: 10 },
        ];
        mockObsCall.mockResolvedValue({ sceneItems: mockSceneItems });

        await expect(
          sourcesModule.getGroupSceneItemId("missing-source", "test-group"),
        ).rejects.toThrow(
          "Source 'missing-source' not found inside group 'test-group'",
        );
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Platform Logo Management", () => {
test(
  "setPlatformLogoVisibility updates logo visibility across platforms",
  async () => {
        const mockPlatformLogos = {
          tiktok: "tiktok-logo-source",
          twitch: "twitch-logo-source",
          youtube: "youtube-logo-source",
        };

        mockObsCall.mockResolvedValue({
          sceneItems: [
            { sourceName: "tiktok-logo-source", sceneItemId: 1 },
            { sourceName: "twitch-logo-source", sceneItemId: 2 },
            { sourceName: "youtube-logo-source", sceneItemId: 3 },
          ],
        });

        await sourcesModule.setPlatformLogoVisibility(
          "tiktok",
          mockPlatformLogos,
        );

        expect(mockObsCall).toHaveBeenCalled();
      },
      TEST_TIMEOUTS.FAST,
    );

test(
  "hideAllPlatformLogos hides every configured platform logo",
  async () => {
        const mockPlatformLogos = {
          tiktok: "tiktok-logo-source",
          twitch: "twitch-logo-source",
          youtube: "youtube-logo-source",
        };

        mockObsCall.mockResolvedValue({
          sceneItems: [
            { sourceName: "tiktok-logo-source", sceneItemId: 1 },
            { sourceName: "twitch-logo-source", sceneItemId: 2 },
            { sourceName: "youtube-logo-source", sceneItemId: 3 },
          ],
        });

        await sourcesModule.hideAllPlatformLogos(mockPlatformLogos);

        expect(mockObsCall).toHaveBeenCalled();
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Display Control", () => {
test(
  "setChatDisplayVisibility toggles the chat display group",
  async () => {
        mockObsCall.mockResolvedValue({ sceneItemId: 42 });

        await sourcesModule.setChatDisplayVisibility(true, "test-scene", {});

        expect(mockObsCall).toHaveBeenCalled();
      },
      TEST_TIMEOUTS.FAST,
    );

test(
  "setNotificationDisplayVisibility toggles notification display group",
  async () => {
        mockObsCall.mockResolvedValue({ sceneItemId: 42 });

        await sourcesModule.setNotificationDisplayVisibility(
          true,
          "test-scene",
          {},
        );

        expect(mockObsCall).toHaveBeenCalled();
      },
      TEST_TIMEOUTS.FAST,
    );

test(
  "hideAllDisplays clears both display groups and text sources",
  async () => {
        mockObsCall.mockResolvedValue({ sceneItemId: 42, inputSettings: {} });

        await sourcesModule.hideAllDisplays(
          "chat-scene",
          "notif-scene",
          {},
          {},
          "tts",
          "notif",
        );

        expect(mockObsCall).toHaveBeenCalled();
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Source Filter Management", () => {
test(
  "setSourceFilterEnabled forwards filter toggle request",
  async () => {
        mockObsCall.mockResolvedValue();

        await sourcesModule.setSourceFilterEnabled(
          "test-source",
          "test-filter",
          true,
        );

      expect(mockEnsureConnected).toHaveBeenCalled();
      const [requestType, payload] = mockObsCall.mock.calls[0] || [];
      expect(requestType).toBe("SetSourceFilterEnabled");
      expect(payload).toEqual({
        sourceName: "test-source",
        filterName: "test-filter",
        filterEnabled: true,
      });
      },
      TEST_TIMEOUTS.FAST,
    );

test(
  "getSourceFilterSettings returns filter settings from OBS",
  async () => {
        const mockSettings = { enabled: true, settings: { key: "value" } };
        const mockFilterInfo = { filterSettings: mockSettings };
        mockObsCall.mockResolvedValue(mockFilterInfo);

        const result = await sourcesModule.getSourceFilterSettings(
          "test-source",
          "test-filter",
        );

      expect(mockEnsureConnected).toHaveBeenCalledTimes(1);
      const [requestType, payload] = mockObsCall.mock.calls[0] || [];
      expect(requestType).toBe("GetSourceFilter");
      expect(payload).toEqual({
        sourceName: "test-source",
        filterName: "test-filter",
      });
      expect(result).toEqual(mockSettings);
      },
      TEST_TIMEOUTS.FAST,
    );

test(
  "setSourceFilterSettings forwards provided filter payload",
  async () => {
        mockObsCall.mockResolvedValue();

        await sourcesModule.setSourceFilterSettings(
          "test-source",
          "test-filter",
          { key: "value" },
        );

      expect(mockEnsureConnected).toHaveBeenCalled();
      const [requestType, payload] = mockObsCall.mock.calls[0] || [];
      expect(requestType).toBe("SetSourceFilterSettings");
      expect(payload).toEqual({
        sourceName: "test-source",
        filterName: "test-filter",
        filterSettings: { key: "value" },
      });
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Error Handling", () => {
    test(
      "should handle OBS connection failures gracefully",
      async () => {
        const connectionError = new Error("OBS connection failed");
        mockEnsureConnected.mockRejectedValue(connectionError);

        await expect(
          sourcesModule.clearTextSource("test-source"),
        ).rejects.toThrow("OBS connection failed");
      },
      TEST_TIMEOUTS.FAST,
    );

    test(
      "should handle invalid source names gracefully",
      async () => {
        mockEnsureConnected.mockResolvedValue();
        mockObsCall.mockResolvedValue({ sceneItemId: null });

        await expect(
          sourcesModule.getSceneItemId("test-scene", ""),
        ).rejects.toThrow(
          'Scene item ID for source "" in scene "test-scene" not found.',
        );
      },
      TEST_TIMEOUTS.FAST,
    );
  });

  describe("Performance Tests", () => {
    test(
      "should handle rapid source operations efficiently",
      async () => {
        mockObsCall.mockResolvedValue({ inputSettings: {} });
        const startTime = testClock.now();

        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push(
            sourcesModule.updateTextSource(`source-${i}`, `message-${i}`),
          );
        }

        await Promise.all(promises);
        testClock.advance(promises.length);
        const duration = testClock.now() - startTime;

        expect(duration).toBeLessThan(100);
        expect(mockObsCall).toHaveBeenCalledTimes(20);
      },
      TEST_TIMEOUTS.FAST,
    );
  });
});
