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
};

type StartupDeps = {
  logger: LoggerLike;
  getOBSConnectionManager: () => ObsManager | null;
  getDefaultSourcesManager: () => {
    hideAllDisplays: HideAllDisplaysMock;
    clearTextSource: ClearTextSourceMock;
  };
};

describe("OBS Startup Display Clearing - Detailed Behavior", () => {
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

  describe("Behavior", () => {
    it("clears startup displays using configured OBS sources", async () => {
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

    it("should warn and skip when config is null", async () => {
      const warnSpy = createMockFn<[string, string?, unknown?], void>(() => undefined);
      const warnDeps = {
        ...deps,
        logger: { ...deps.logger, warn: warnSpy },
      };

      await clearStartupDisplays(null, warnDeps);

      expect(hideAllDisplays).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]).toEqual([
        "clearStartupDisplays requires config; skipping display clearing",
        "OBSStartup",
      ]);
    });

    it("should not clear text sources directly on startup", async () => {
      await clearStartupDisplays(configFixture, deps);

      expect(clearTextSource).not.toHaveBeenCalled();
    });

    it("should skip clearing when required obs fields are missing", async () => {
      const missingFieldsConfig: StartupConfig = {
        obs: {
          chatMsgScene: "stream pkmn switch",
          chatMsgGroup: "test",
          notificationScene: "stream pkmn switch",
          notificationTxt: "",
          ttsTxt: "",
          notificationMsgGroup: "test",
          chatPlatformLogos: {},
          notificationPlatformLogos: {},
        },
        timing: { fadeDuration: 750 },
      };

      await clearStartupDisplays(missingFieldsConfig, deps);

      expect(hideAllDisplays).not.toHaveBeenCalled();
    });

    it("should skip operations when OBS is not connected", async () => {
      mockOBSManager.isConnected = createMockFn<[], boolean>(() => false);

      await clearStartupDisplays(configFixture, deps);

      expect(hideAllDisplays).not.toHaveBeenCalled();
      expect(clearTextSource).not.toHaveBeenCalled();
    });

    it("should not crash startup if entire clearing fails", async () => {
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

    it("should use provided config for platform logos", async () => {
      const customConfig: StartupConfig = {
        obs: {
          chatMsgScene: "stream pkmn switch",
          chatMsgGroup: "test-group",
          notificationScene: "stream pkmn switch",
          notificationTxt: "notification streamlabs",
          ttsTxt: "tts txt",
          notificationMsgGroup: "test-notification-group",
          chatPlatformLogos: {
            twitch: "custom-twitch",
            youtube: "custom-youtube",
            tiktok: "custom-tiktok",
          },
          notificationPlatformLogos: {
            twitch: "notice-twitch",
            youtube: "notice-youtube",
            tiktok: "notice-tiktok",
          },
        },
        timing: {
          fadeDuration: 500,
        },
      };

      await clearStartupDisplays(customConfig, deps);

      expect(hideAllDisplays).toHaveBeenCalledTimes(1);
      expect(hideAllDisplays.mock.calls[0]).toEqual([
        "stream pkmn switch",
        "stream pkmn switch",
        customConfig.obs.chatPlatformLogos,
        customConfig.obs.notificationPlatformLogos,
        "tts txt",
        "notification streamlabs",
      ]);
    });
  });
});
