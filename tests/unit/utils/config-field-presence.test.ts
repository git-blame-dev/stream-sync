import { describe, expect, it } from "bun:test";
import { ConfigValidator } from "../../../src/utils/config-validator";
describe("_parseInheritableFlags", () => {
  const EXPECTED_INHERITABLE_FLAGS = [
    "messagesEnabled",
    "commandsEnabled",
    "greetingsEnabled",
    "farewellsEnabled",
    "followsEnabled",
    "giftsEnabled",
    "raidsEnabled",
    "paypiggiesEnabled",
    "ignoreSelfMessages",
  ];

  it("returns all inheritable flag fields", () => {
    const result = ConfigValidator._parseInheritableFlags({});

    EXPECTED_INHERITABLE_FLAGS.forEach((field) => {
      expect(result).toHaveProperty(field);
    });
  });

  it("returns null for all flags when raw config is empty", () => {
    const result = ConfigValidator._parseInheritableFlags({});

    EXPECTED_INHERITABLE_FLAGS.forEach((field) => {
      expect(result[field]).toBe(null);
    });
  });

  it("parses boolean values from raw config", () => {
    const raw = {
      messagesEnabled: "true",
      commandsEnabled: "false",
      greetingsEnabled: true,
      giftsEnabled: false,
    };
    const result = ConfigValidator._parseInheritableFlags(raw);

    expect(result.messagesEnabled).toBe(true);
    expect(result.commandsEnabled).toBe(false);
    expect(result.greetingsEnabled).toBe(true);
    expect(result.giftsEnabled).toBe(false);
  });

  it("returns exactly the expected fields and no extra fields", () => {
    const result = ConfigValidator._parseInheritableFlags({});
    const keys = Object.keys(result);

    expect(keys.length).toBe(EXPECTED_INHERITABLE_FLAGS.length);
    expect(keys.sort()).toEqual(EXPECTED_INHERITABLE_FLAGS.slice().sort());
  });
});

describe("_parseShareFlag", () => {
  it("returns sharesEnabled field", () => {
    const result = ConfigValidator._parseShareFlag({});

    expect(result).toHaveProperty("sharesEnabled");
  });

  it("returns null when raw config is empty", () => {
    const result = ConfigValidator._parseShareFlag({});

    expect(result.sharesEnabled).toBe(null);
  });

  it("parses boolean values from raw config", () => {
    const raw = { sharesEnabled: "true" };
    const result = ConfigValidator._parseShareFlag(raw);

    expect(result.sharesEnabled).toBe(true);
  });
});

describe("Config field presence - all normalizers return expected fields", () => {
  describe("_normalizeGeneralSection", () => {
    const EXPECTED_FIELDS = [
      "debugEnabled",
      "messagesEnabled",
      "commandsEnabled",
      "greetingsEnabled",
      "farewellsEnabled",
      "followsEnabled",
      "giftsEnabled",
      "raidsEnabled",
      "sharesEnabled",
      "paypiggiesEnabled",
      "filterOldMessages",
      "logChatMessages",
      "keywordParsingEnabled",
      "ignoreSelfMessages",
      "envFileReadEnabled",
      "envFileWriteEnabled",
      "viewerCountPollingInterval",
      "maxMessageLength",

      "fallbackUsername",
      "anonymousUsername",
      "envFilePath",
    ];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeGeneralSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });

    it("preserves field values from raw config", () => {
      const raw = {
        debugEnabled: "true",
        fallbackUsername: "TestUser",
      };
      const result = ConfigValidator._normalizeGeneralSection(raw);

      expect(result.debugEnabled).toBe(true);
      expect(result.fallbackUsername).toBe("TestUser");
    });
  });

  describe("_normalizeHttpSection", () => {
    const EXPECTED_FIELDS = [
      "userAgents",
      "defaultTimeoutMs",
      "reachabilityTimeoutMs",
      "enhancedTimeoutMs",
      "enhancedReachabilityTimeoutMs",
    ];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeHttpSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeObsSection", () => {
    const EXPECTED_FIELDS = [
      "enabled",
      "address",
      "connectionTimeoutMs",
      "ttsEnabled",
      "chatMsgTxt",
      "chatMsgScene",
      "chatMsgGroup",
      "notificationTxt",
      "notificationScene",
      "notificationMsgGroup",
      "ttsTxt",
      "chatPlatformLogoTwitch",
      "chatPlatformLogoYouTube",
      "chatPlatformLogoTikTok",
      "notificationPlatformLogoTwitch",
      "notificationPlatformLogoYouTube",
      "notificationPlatformLogoTikTok",
    ];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeObsSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeTiktokSection", () => {
    const EXPECTED_FIELDS = [
      "enabled",
      "username",
      "viewerCountEnabled",
      "viewerCountSource",
      "greetingsEnabled",
      "giftAggregationEnabled",
      "dataLoggingEnabled",
      "messagesEnabled",
      "commandsEnabled",
      "farewellsEnabled",
      "followsEnabled",
      "giftsEnabled",
      "raidsEnabled",
      "paypiggiesEnabled",
      "sharesEnabled",
      "ignoreSelfMessages",
      "pollInterval",
    ];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeTiktokSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });

    it("preserves viewerCountSource from raw config", () => {
      const raw = { viewerCountSource: "tiktok viewer count" };
      const result = ConfigValidator._normalizeTiktokSection(raw);

      expect(result.viewerCountSource).toBe("tiktok viewer count");
    });
  });

  describe("_normalizeTwitchSection", () => {
    const EXPECTED_FIELDS = [
      "enabled",
      "username",
      "clientId",
      "channel",
      "viewerCountEnabled",
      "viewerCountSource",
      "dataLoggingEnabled",
      "tokenStorePath",
      "messagesEnabled",
      "commandsEnabled",
      "greetingsEnabled",
      "farewellsEnabled",
      "followsEnabled",
      "giftsEnabled",
      "raidsEnabled",
      "paypiggiesEnabled",
      "ignoreSelfMessages",
      "pollInterval",
    ];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeTwitchSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });

    it("preserves viewerCountSource from raw config", () => {
      const raw = { viewerCountSource: "twitch viewer count" };
      const result = ConfigValidator._normalizeTwitchSection(raw);

      expect(result.viewerCountSource).toBe("twitch viewer count");
    });
  });

  describe("_normalizeYoutubeSection", () => {
    const EXPECTED_FIELDS = [
      "enabled",
      "username",
      "viewerCountEnabled",
      "viewerCountSource",
      "maxStreams",
      "streamPollingInterval",
      "fullCheckInterval",
      "dataLoggingEnabled",
      "enableAPI",
      "streamDetectionMethod",
      "viewerCountMethod",
      "chatMode",
      "messagesEnabled",
      "commandsEnabled",
      "greetingsEnabled",
      "farewellsEnabled",
      "followsEnabled",
      "giftsEnabled",
      "raidsEnabled",
      "paypiggiesEnabled",
      "ignoreSelfMessages",
      "pollInterval",
    ];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeYoutubeSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });

    it("preserves viewerCountSource from raw config", () => {
      const raw = { viewerCountSource: "youtube viewer count" };
      const result = ConfigValidator._normalizeYoutubeSection(raw);

      expect(result.viewerCountSource).toBe("youtube viewer count");
    });
  });

  describe("_normalizeHandcamSection", () => {
    const EXPECTED_FIELDS = [
      "enabled",
      "sourceName",
      "glowFilterName",
      "maxSize",
      "rampUpDuration",
      "holdDuration",
      "rampDownDuration",
      "totalSteps",
      "easingEnabled",
    ];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeHandcamSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeGoalsSection", () => {
    const EXPECTED_FIELDS = [
      "enabled",
      "tiktokGoalEnabled",
      "tiktokGoalSource",
      "tiktokGoalTarget",
      "tiktokGoalCurrency",
      "tiktokPaypiggyEquivalent",
      "youtubeGoalEnabled",
      "youtubeGoalSource",
      "youtubeGoalTarget",
      "youtubeGoalCurrency",
      "youtubePaypiggyPrice",
      "twitchGoalEnabled",
      "twitchGoalSource",
      "twitchGoalTarget",
      "twitchGoalCurrency",
      "twitchPaypiggyEquivalent",
    ];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeGoalsSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeGiftsSection", () => {
    const EXPECTED_FIELDS = ["command", "giftVideoSource", "giftAudioSource"];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeGiftsSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeEnvelopesSection", () => {
    const EXPECTED_FIELDS = ["command"];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeEnvelopesSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeTimingSection", () => {
    const EXPECTED_FIELDS = [
      "fadeDuration",
      "notificationClearDelay",
      "transitionDelay",
      "chatMessageDuration",
    ];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeTimingSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeCooldownsSection", () => {
    const EXPECTED_FIELDS = [
      "defaultCooldown",
      "heavyCommandCooldown",
      "heavyCommandThreshold",
      "heavyCommandWindow",
      "maxEntries",
    ];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeCooldownsSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeSpamSection", () => {
    const EXPECTED_FIELDS = [
      "enabled",
      "lowValueThreshold",
      "detectionWindow",
      "maxIndividualNotifications",
      "tiktokEnabled",
      "tiktokLowValueThreshold",
      "twitchEnabled",
      "twitchLowValueThreshold",
      "youtubeEnabled",
      "youtubeLowValueThreshold",
    ];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeSpamSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeDisplayQueueSection", () => {
    const EXPECTED_FIELDS = ["autoProcess", "maxQueueSize"];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeDisplayQueueSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeLoggingSection", () => {
    const EXPECTED_FIELDS = ["consoleLevel", "fileLevel", "fileLoggingEnabled"];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeLoggingSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeGuiSection", () => {
    const EXPECTED_FIELDS = [
      "enableDock",
      "enableOverlay",
      "host",
      "port",
      "messageCharacterLimit",
      "overlayMaxMessages",
      "overlayMaxLinesPerMessage",
      "showMessages",
      "showCommands",
      "showGreetings",
      "showFarewells",
      "showFollows",
      "showShares",
      "showRaids",
      "showGifts",
      "showPaypiggies",
      "showGiftPaypiggies",
      "showEnvelopes",
    ];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeGuiSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeFarewellSection", () => {
    const EXPECTED_FIELDS = ["command", "timeout"];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeFarewellSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeVfxSection", () => {
    const EXPECTED_FIELDS = ["filePath"];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeVfxSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeStreamElementsSection", () => {
    const EXPECTED_FIELDS = [
      "enabled",
      "youtubeChannelId",
      "twitchChannelId",
      "dataLoggingEnabled",
    ];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeStreamElementsSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeFollowsSection", () => {
    const EXPECTED_FIELDS = ["command"];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeFollowsSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeRaidsSection", () => {
    const EXPECTED_FIELDS = ["command"];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeRaidsSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizePaypiggiesSection", () => {
    const EXPECTED_FIELDS = ["command"];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizePaypiggiesSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeGreetingsSection", () => {
    const EXPECTED_FIELDS = ["command", "customVfxProfiles"];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeGreetingsSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeSharesSection", () => {
    const EXPECTED_FIELDS = ["command"];

    it("returns all expected fields", () => {
      const result = ConfigValidator._normalizeSharesSection({});

      EXPECTED_FIELDS.forEach((field) => {
        expect(result).toHaveProperty(field);
      });
    });
  });

  describe("_normalizeCommandsSection", () => {
    it("returns empty object for empty input", () => {
      const result = ConfigValidator._normalizeCommandsSection({});

      expect(result).toEqual({});
    });

    it("preserves command definitions", () => {
      const raw = {
        "test-cmd": "!test, vfx top",
      };
      const result = ConfigValidator._normalizeCommandsSection(raw);

      expect(result["test-cmd"]).toBe("!test, vfx top");
    });
  });
});

describe("Platform config viewerCountSource consistency", () => {
  it("all platform normalizers handle viewerCountSource identically", () => {
    const testSource = "test-viewer-count-source";

    const tiktokResult = ConfigValidator._normalizeTiktokSection({
      viewerCountSource: testSource,
    });
    const twitchResult = ConfigValidator._normalizeTwitchSection({
      viewerCountSource: testSource,
    });
    const youtubeResult = ConfigValidator._normalizeYoutubeSection({
      viewerCountSource: testSource,
    });

    expect(tiktokResult.viewerCountSource).toBe(testSource);
    expect(twitchResult.viewerCountSource).toBe(testSource);
    expect(youtubeResult.viewerCountSource).toBe(testSource);
  });

  it("all platform normalizers return null for viewerCountSource when not provided", () => {
    const tiktokResult = ConfigValidator._normalizeTiktokSection({});
    const twitchResult = ConfigValidator._normalizeTwitchSection({});
    const youtubeResult = ConfigValidator._normalizeYoutubeSection({});

    expect(tiktokResult.viewerCountSource).toBeNull();
    expect(twitchResult.viewerCountSource).toBeNull();
    expect(youtubeResult.viewerCountSource).toBeNull();
  });
});
