import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import { createRequire } from "node:module";

import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";

const nodeRequire: NodeJS.Require = createRequire(import.meta.url);

type FsLike = {
  readFileSync: (...args: unknown[]) => unknown;
  existsSync: (...args: unknown[]) => boolean;
};

type ConfigShape = {
  obs: {
    address: string;
    ttsChatEnabled: boolean;
    ttsNotificationsEnabled: boolean;
    connectionTimeoutMs: number;
  };
};

let originalReadFileSync: typeof fs.readFileSync;
let originalExistsSync: typeof fs.existsSync;
let originalConfigPath: string | undefined;

const CONFIG_MODULE_PATH = nodeRequire.resolve("../../../src/core/config");

function resetConfigModule() {
  delete nodeRequire.cache[CONFIG_MODULE_PATH];
}

function loadFreshConfig() {
  resetConfigModule();
  const { config } = nodeRequire("../../../src/core/config") as {
    config: ConfigShape;
  };
  return { config };
}

function buildMinimalConfig(
  overrides: Record<string, Record<string, string>> = {},
) {
  const base = {
    general: {
      debugEnabled: "false",
      viewerCountPollingInterval: "60",
      maxMessageLength: "500",
    },
    obs: {
      enabled: "false",
      chatMsgGroup: "",
      ttsChatEnabled: "false",
      ttsNotificationsEnabled: "true",
      notificationScene: "smoke notification scene",
      notificationMsgGroup: "smoke notification group",
      chatPlatformLogoTwitch: "smoke chat twitch",
      chatPlatformLogoYouTube: "smoke chat youtube",
      chatPlatformLogoTikTok: "smoke chat tiktok",
      notificationPlatformLogoTwitch: "smoke notification twitch",
      notificationPlatformLogoYouTube: "smoke notification youtube",
      notificationPlatformLogoTikTok: "smoke notification tiktok",
      connectionTimeoutMs: "1000",
    },
    timing: {
      fadeDuration: "250",
      notificationClearDelay: "1000",
      transitionDelay: "250",
      chatMessageDuration: "3000",
    },
    youtube: {
      enabled: "false",
      innertubeInstanceTtlMs: "60000",
      innertubeMinTtlMs: "30000",
      userAgents: "smoke-agent",
      streamDetectionMethod: "api",
    },
    handcam: {
      enabled: "false",
      sourceName: "smoke handcam",
      glowFilterName: "smoke glow",
      maxSize: "50",
      rampUpDuration: "0.5",
      holdDuration: "1",
      rampDownDuration: "0.5",
      totalSteps: "10",
      easingEnabled: "true",
    },
    cooldowns: {
      defaultCooldown: "10",
      heavyCommandCooldown: "60",
      heavyCommandThreshold: "3",
      heavyCommandWindow: "60",
      maxEntries: "100",
    },
    twitch: {
      enabled: "false",
      cheermoteDefaultGiftCount: "1",
      cheermoteGenericCheerName: "cheer",
      cheermoteGenericBitsName: "bits",
      cheermoteUnknownUserIdPrefix: "unknown",
      cheermoteDefaultType: "bits",
    },
    commands: {
      enabled: "false",
    },
  };

  const merged = {
    general: { ...base.general, ...(overrides.general || {}) },
    obs: { ...base.obs, ...(overrides.obs || {}) },
    timing: { ...base.timing, ...(overrides.timing || {}) },
    youtube: { ...base.youtube, ...(overrides.youtube || {}) },
    handcam: { ...base.handcam, ...(overrides.handcam || {}) },
    cooldowns: { ...base.cooldowns, ...(overrides.cooldowns || {}) },
    twitch: { ...base.twitch, ...(overrides.twitch || {}) },
    commands: { ...base.commands, ...(overrides.commands || {}) },
  };

  const lines: string[] = [];
  Object.entries(merged).forEach(([section, values]) => {
    lines.push(`[${section}]`);
    Object.entries(values).forEach(([key, value]) => {
      lines.push(`${key}=${value}`);
    });
    lines.push("");
  });

  return lines.join("\n");
}

describe("Config path override", () => {
  beforeEach(() => {
    originalReadFileSync = fs.readFileSync;
    originalExistsSync = fs.existsSync;
    originalConfigPath = process.env.CHAT_BOT_CONFIG_PATH;
  });

  afterEach(() => {
    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;
    restoreAllMocks();
    resetConfigModule();
    if (originalConfigPath === undefined) {
      delete process.env.CHAT_BOT_CONFIG_PATH;
    } else {
      process.env.CHAT_BOT_CONFIG_PATH = originalConfigPath;
    }
  });

  it("loads config from CHAT_BOT_CONFIG_PATH when set", () => {
     const uniqueAddress = "ws://override:4455";
     const configContent = buildMinimalConfig({
       obs: { address: uniqueAddress },
    });
    const testConfigPath = "/test/override/config.ini";

    fs.existsSync = createMockFn(
      (filePath) => filePath === testConfigPath,
    ) as FsLike["existsSync"];
    fs.readFileSync = createMockFn((filePath) => {
      if (filePath === testConfigPath) return configContent;
      throw new Error(`ENOENT: no such file: ${filePath}`);
    }) as unknown as typeof fs.readFileSync;

    process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;
    const { config } = loadFreshConfig();

     expect(config.obs.address).toBe(uniqueAddress);
  });

  it("provides startup-critical defaults when values are missing", () => {
    const configContent = buildMinimalConfig({
       obs: { address: "ws://defaults:4455" },
    });
    const testConfigPath = "/test/defaults/config.ini";

    fs.existsSync = createMockFn(
      (filePath) => filePath === testConfigPath,
    ) as FsLike["existsSync"];
    fs.readFileSync = createMockFn((filePath) => {
      if (filePath === testConfigPath) return configContent;
      throw new Error(`ENOENT: no such file: ${filePath}`);
    }) as unknown as typeof fs.readFileSync;

    process.env.CHAT_BOT_CONFIG_PATH = testConfigPath;
    const { config } = loadFreshConfig();

    expect(typeof config.obs.ttsChatEnabled).toBe("boolean");
    expect(typeof config.obs.ttsNotificationsEnabled).toBe("boolean");
     expect(typeof config.obs.address).toBe("string");
     expect(config.obs.address.length).toBeGreaterThan(0);
     expect(config.obs.connectionTimeoutMs).toBe(1000);
  });
});
