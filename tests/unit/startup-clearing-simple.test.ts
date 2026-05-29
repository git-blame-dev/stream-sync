import { beforeEach, describe, expect, it } from "bun:test";

import { createMockFn, type TestMockFn } from "../helpers/bun-mock-utils";
import { noOpLogger } from "../helpers/mock-factories";
import { clearStartupDisplays } from "../../src/obs/startup";
import "../../src/obs/startup.ts";
import "../../src/obs/startup.ts";

type LoggerLike = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type IsConnectedMock = TestMockFn<[], boolean>;
type HideAllDisplaysMock = TestMockFn<
  [string, string, Record<string, string>, Record<string, string>, string, string],
  Promise<void>
>;
type ClearTextSourceMock = TestMockFn<[string, string], Promise<void>>;

type ObsManager = {
  isConnected: IsConnectedMock;
  connected: boolean;
};

type StartupConfig = {
  obs: {
    chatMsgScene: string;
    chatMsgTxt?: string;
    chatMsgGroup: string;
    notificationScene: string;
    notificationTxt: string;
    ttsTxt: string;
    notificationMsgGroup: string;
    chatPlatformLogos: Record<string, string>;
    notificationPlatformLogos: Record<string, string>;
  };
  timing: {
    fadeDuration: number;
  };
  general?: Record<string, unknown>;
};

type StartupDeps = {
  logger: LoggerLike;
  getOBSConnectionManager: () => ObsManager | null;
  getDefaultSourcesManager: () => {
    hideAllDisplays: HideAllDisplaysMock;
    clearTextSource: ClearTextSourceMock;
  };
};

describe("OBS Startup Display Clearing - Regression Tests", () => {
  let mockOBSManager: ObsManager;
  let hideAllDisplays: HideAllDisplaysMock;
  let clearTextSource: ClearTextSourceMock;
  let configFixture: StartupConfig;
  let deps: StartupDeps;

  beforeEach(() => {
    mockOBSManager = {
      isConnected: createMockFn<[], boolean>(() => true),
      connected: true,
    };

    hideAllDisplays = createMockFn<Parameters<HideAllDisplaysMock>, Promise<void>>(async () => undefined);
    clearTextSource = createMockFn<Parameters<ClearTextSourceMock>, Promise<void>>(async () => undefined);

    configFixture = {
      obs: {
        chatMsgScene: "stream pkmn switch",
        chatMsgTxt: "notification streamlabs",
        chatMsgGroup: "test-chat-group",
        notificationScene: "stream pkmn switch",
        notificationTxt: "notification streamlabs",
        ttsTxt: "tts txt",
        notificationMsgGroup: "test-notification-group",
        chatPlatformLogos: {
          twitch: "twitch-img",
          youtube: "youtube-img",
          tiktok: "tiktok-img",
        },
        notificationPlatformLogos: {
          twitch: "twitch-img",
          youtube: "youtube-img",
          tiktok: "tiktok-img",
        },
      },
      timing: {
        fadeDuration: 750,
      },
    };

    deps = {
      logger: noOpLogger,
      getOBSConnectionManager: () => mockOBSManager,
      getDefaultSourcesManager: () => ({ hideAllDisplays, clearTextSource }),
    };
  });

  describe("Core Clearing Behavior", () => {
    it("clears startup displays using source names from config", async () => {
      await clearStartupDisplays(configFixture, deps);

      expect(hideAllDisplays).toHaveBeenCalledTimes(1);
      expect(hideAllDisplays.mock.calls[0]).toEqual([
        "stream pkmn switch",
        "stream pkmn switch",
        configFixture.obs.chatPlatformLogos,
        configFixture.obs.notificationPlatformLogos,
        "tts txt",
        "notification streamlabs",
      ]);
    });

    it("should not clear text sources directly", async () => {
      await clearStartupDisplays(configFixture, deps);

      expect(clearTextSource).not.toHaveBeenCalled();
    });

    it("should skip clearing when OBS is not connected", async () => {
      mockOBSManager.isConnected = createMockFn<[], boolean>(() => false);

      await clearStartupDisplays(configFixture, deps);

      expect(hideAllDisplays).not.toHaveBeenCalled();
      expect(clearTextSource).not.toHaveBeenCalled();
    });

    it("should skip clearing when config is incomplete", async () => {
      const incompleteConfig: StartupConfig = {
        general: {},
        obs: {
          chatMsgScene: "",
          chatMsgGroup: "",
          notificationScene: "",
          notificationTxt: "",
          ttsTxt: "",
          notificationMsgGroup: "",
          chatPlatformLogos: {},
          notificationPlatformLogos: {},
        },
        timing: { fadeDuration: 750 },
      };

      await clearStartupDisplays(incompleteConfig, deps);

      expect(hideAllDisplays).not.toHaveBeenCalled();
    });

    it("should not invoke direct text source clearing", async () => {
      clearTextSource = createMockFn<Parameters<ClearTextSourceMock>, Promise<void>>(async () => {
        throw new Error("Source not found");
      });
      deps = {
        ...deps,
        getDefaultSourcesManager: () => ({ hideAllDisplays, clearTextSource }),
      };

      await clearStartupDisplays(configFixture, deps);

      expect(hideAllDisplays).toHaveBeenCalled();
      expect(clearTextSource).not.toHaveBeenCalled();
    });
  });

  describe("Configuration-Driven Behavior", () => {
    it("should use custom source names from config", async () => {
      const customConfig: StartupConfig = {
        obs: {
          chatMsgScene: "custom chat scene",
          chatMsgGroup: "custom-chat-group",
          notificationScene: "custom notification scene",
          ttsTxt: "custom tts source",
          notificationTxt: "custom notification source",
          notificationMsgGroup: "custom-notification-group",
          chatPlatformLogos: { twitch: "custom-twitch" },
          notificationPlatformLogos: { twitch: "custom-twitch" },
        },
        timing: {
          fadeDuration: 500,
        },
      };

      await clearStartupDisplays(customConfig, deps);

      expect(hideAllDisplays).toHaveBeenCalledTimes(1);
      expect(hideAllDisplays.mock.calls[0]).toEqual([
        "custom chat scene",
        "custom notification scene",
        expect.any(Object),
        expect.any(Object),
        "custom tts source",
        "custom notification source",
      ]);
    });
  });

  describe("Error Handling", () => {
    it("should not throw errors when hideAllDisplays fails", async () => {
      hideAllDisplays = createMockFn<Parameters<HideAllDisplaysMock>, Promise<void>>(async () => {
        throw new Error("OBS connection lost");
      });
      deps = {
        ...deps,
        getDefaultSourcesManager: () => ({ hideAllDisplays, clearTextSource }),
      };

      await expect(
        clearStartupDisplays(configFixture, deps),
      ).resolves.toBeUndefined();
    });

    it("should continue when OBS manager is null", async () => {
      const nullManagerDeps = {
        ...deps,
        getOBSConnectionManager: () => null,
      };

      await expect(
        clearStartupDisplays(configFixture, nullManagerDeps),
      ).resolves.toBeUndefined();
    });
  });
});
