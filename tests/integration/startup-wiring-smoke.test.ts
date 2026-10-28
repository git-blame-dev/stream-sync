import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import fs from "fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { getDebugMode, getLoggingConfig, initializeLoggingConfig, setDebugMode } from "../../src/core/logging";
import { buildLoggingConfig } from "../../src/core/config-builders";
const load = createRequire(import.meta.url);
const configModulePath = load.resolve("../../src/core/config");

type LoggingConfig = NonNullable<Parameters<typeof initializeLoggingConfig>[0]["logging"]>;

const buildSmokeConfigIni = () => `[general]
envFileReadEnabled=false
debugEnabled=true
viewerCountPollingInterval=60
maxMessageLength=500

[obs]
enabled=false
chatMsgTxt=smoke chat txt
chatMsgScene=smoke chat scene
chatMsgGroup=
ttsChatEnabled=false
ttsNotificationsEnabled=false
notificationTxt=smoke notification txt
notificationScene=smoke notification scene
notificationMsgGroup=smoke notification group
chatPlatformLogoTwitch=smoke chat twitch
chatPlatformLogoYouTube=smoke chat youtube
chatPlatformLogoTikTok=smoke chat tiktok
notificationPlatformLogoTwitch=smoke notification twitch
notificationPlatformLogoYouTube=smoke notification youtube
notificationPlatformLogoTikTok=smoke notification tiktok
connectionTimeoutMs=1000
ttsTxt=smoke tts txt

[timing]
fadeDuration=250
notificationClearDelay=1000
transitionDelay=250
chatMessageDuration=3000

[youtube]
enabled=false
innertubeInstanceTtlMs=60000
innertubeMinTtlMs=30000
userAgents=smoke-agent
streamDetectionMethod=api

[handcam]
enabled=false
sourceName=smoke handcam
glowFilterName=smoke glow
maxSize=50
rampUpDuration=0.5
holdDuration=1
rampDownDuration=0.5
totalSteps=10
easingEnabled=true

[cooldowns]
defaultCooldown=10
heavyCommandCooldown=60
heavyCommandThreshold=3
heavyCommandWindow=60
maxEntries=100

[twitch]
enabled=false
cheermoteDefaultGiftCount=1
cheermoteGenericCheerName=cheer
cheermoteGenericBitsName=bits
cheermoteUnknownUserIdPrefix=unknown
cheermoteDefaultType=bits

[commands]
enabled=false

[logging]
consoleLevel=debug

[tiktok]
enabled=false
`;

describe("Startup wiring smoke", () => {
  let tempDir: string | undefined;
  let tempConfigPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(tmpdir(), "startup-smoke-"));
    tempConfigPath = path.join(tempDir, "config.smoke.ini");
    fs.writeFileSync(tempConfigPath, buildSmokeConfigIni());
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("core startup modules can be required and initialized", () => {
    expect(typeof buildLoggingConfig).toBe("function");
    expect(typeof initializeLoggingConfig).toBe("function");

    const originalEntry = load.cache[configModulePath];
    const originalConfigPath = process.env.CHAT_BOT_CONFIG_PATH;
    const originalLogging = getLoggingConfig();
    const originalDebug = getDebugMode();
    try {
      process.env.CHAT_BOT_CONFIG_PATH = tempConfigPath;
      delete load.cache[configModulePath];
      const configModule = load(configModulePath) as typeof import("../../src/core/config");
      const normalized = configModule.loadConfig();
      expect(normalized.general?.debugEnabled).toBe(true);
      expect(normalized.general?.envFileReadEnabled).toBe(false);
      const builtLoggingConfig = buildLoggingConfig(normalized);
      const loggingConfig: LoggingConfig = {
        ...builtLoggingConfig,
        console: { ...builtLoggingConfig.console, level: "debug" },
        file: { ...builtLoggingConfig.file, level: "debug" },
      };
      initializeLoggingConfig({ logging: loggingConfig });
      setDebugMode(true);
      expect(getLoggingConfig()).toBe(loggingConfig);
      expect(getDebugMode()).toBe(true);
    } finally {
      try {
        initializeLoggingConfig({ logging: originalLogging });
      } finally {
        try {
          setDebugMode(originalDebug);
        } finally {
          try {
            if (originalEntry) load.cache[configModulePath] = originalEntry;
            else delete load.cache[configModulePath];
          } finally {
            if (originalConfigPath === undefined) delete process.env.CHAT_BOT_CONFIG_PATH;
            else process.env.CHAT_BOT_CONFIG_PATH = originalConfigPath;
          }
        }
      }
    }
    expect(getLoggingConfig()).toBe(originalLogging);
    expect(getDebugMode()).toBe(originalDebug);
    expect(load.cache[configModulePath]).toBe(originalEntry);
    expect(process.env.CHAT_BOT_CONFIG_PATH).toBe(originalConfigPath);
  });

  test("smoke config file exists and is readable", () => {
    expect(fs.existsSync(tempConfigPath)).toBe(true);

    const content = fs.readFileSync(tempConfigPath, "utf-8");
    expect(content).toContain("[general]");
    expect(content).toContain("[obs]");
    expect(content).toContain("[commands]");
  });

  test("bootstrap file exists", () => {
    const bootstrapPath = path.join(__dirname, "../../src/bootstrap.ts");

    expect(fs.existsSync(bootstrapPath)).toBe(true);
  });
});
