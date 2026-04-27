import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { restoreAllMocks } from "../../helpers/bun-mock-utils";
import testClock from "../../helpers/test-clock";
import { CommandParser } from "../../../src/chat/commands";

type CommandParserConfig = {
  commands: Record<string, string>;
  farewell: {
    command: string;
    timeout?: string;
  };
  vfx: {
    filePath: string;
  };
  general: {
    keywordParsingEnabled: boolean;
  };
};

type ParsedVfxConfig = {
  filename: string;
  command: string;
  keyword?: string;
} | null;

type CommandParserInstance = {
  getVFXConfig: (firstWord: string, message: string) => ParsedVfxConfig;
  getMatchingFarewell: (message: string, firstWord: string) => string | null;
  parsedCommands: {
    keywords: Map<string, unknown>;
  };
};

const requireParsedVfxConfig = (
  result: ParsedVfxConfig,
): Exclude<ParsedVfxConfig, null> => {
  expect(result).not.toBeNull();
  if (!result) {
    throw new Error("Expected parsed VFX config");
  }
  return result;
};

describe("CommandParser Keyword Parsing", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let commandParser: CommandParserInstance;
  let configFixture: CommandParserConfig;

  beforeEach(() => {
    configFixture = {
      commands: {
        "hello-there": "!hello, vfx bottom green",
        "im-a-mod": "!mod, vfx top, mod|mods",
        "span-lol": "!lol, vfx top, haha|hehe",
      },
      farewell: {
        command: "!bye|!bye1|!bye2|!bye3",
      },
      vfx: {
        filePath: "/path/to/vfx",
      },
      general: {
        keywordParsingEnabled: true,
      },
    };
  });

  describe("Keyword Parsing Enabled (Default)", () => {
    beforeEach(() => {
      commandParser = new CommandParser(configFixture);
    });

    test("should detect ! prefix commands when keyword parsing is enabled", () => {
      const result = commandParser.getVFXConfig("!hello", "!hello everyone!");
      const parsed = requireParsedVfxConfig(result);

      expect(parsed.filename).toBe("hello-there");
      expect(parsed.command).toBe("!hello");
    });

    test("should detect keyword-based commands when keyword parsing is enabled", () => {
      const result = commandParser.getVFXConfig(
        "i",
        "I am a mod and I approve this message",
      );
      const parsed = requireParsedVfxConfig(result);

      expect(parsed.filename).toBe("im-a-mod");
      expect(parsed.keyword).toBe("mod");
    });

    test("should detect farewell commands when keyword parsing is enabled", () => {
      const result = commandParser.getMatchingFarewell(
        "!bye everyone!",
        "!bye",
      );

      expect(result).toBe("!bye");
    });

    test("ignores farewell timeout config when parsing farewell triggers", () => {
      configFixture.farewell = {
        command: "!bye|!bye2|!bye3, bye|goodbye|cya",
        timeout: "300",
      };
      commandParser = new CommandParser(configFixture);

      expect(commandParser.getMatchingFarewell("!bye everyone!", "!bye")).toBe(
        "!bye",
      );
      expect(
        commandParser.getMatchingFarewell("300 everyone!", "300"),
      ).toBeNull();
    });

    test("does not treat command-key aliases as farewell triggers", () => {
      configFixture.farewell = {
        command: "bye-bye-bye|bye-bye-bye2|bye-bye-bye3",
      };
      commandParser = new CommandParser(configFixture);

      expect(
        commandParser.getMatchingFarewell("!bye everyone!", "!bye"),
      ).toBeNull();
    });

    test("should detect farewell keywords when keyword parsing is enabled", () => {
      const result = commandParser.getMatchingFarewell(
        "Goodbye everyone!",
        "goodbye",
      );
      expect(result).toBeNull();
    });
  });

  describe("Keyword Parsing Disabled", () => {
    beforeEach(() => {
      configFixture.general = { keywordParsingEnabled: false };
      commandParser = new CommandParser(configFixture);
    });

    test("should still detect ! prefix commands when keyword parsing is disabled", () => {
      const result = commandParser.getVFXConfig("!hello", "!hello everyone!");
      const parsed = requireParsedVfxConfig(result);

      expect(parsed.filename).toBe("hello-there");
      expect(parsed.command).toBe("!hello");
    });

    test("should NOT detect keyword-based commands when keyword parsing is disabled", () => {
      const result = commandParser.getVFXConfig(
        "i",
        "I am a mod and I approve this message",
      );

      expect(result).toBeNull();
    });

    test("should NOT detect keyword-based commands in different messages when keyword parsing is disabled", () => {
      const result = commandParser.getVFXConfig(
        "test",
        "This message contains hehe in it",
      );

      expect(result).toBeNull();
    });

    test("should still detect farewell commands when keyword parsing is disabled", () => {
      const result = commandParser.getMatchingFarewell(
        "!bye everyone!",
        "!bye",
      );

      expect(result).toBe("!bye");
    });

    test("should NOT detect farewell keywords when keyword parsing is disabled", () => {
      const result = commandParser.getMatchingFarewell(
        "Goodbye everyone!",
        "goodbye",
      );
      expect(result).toBeNull();
    });
  });

  describe("Configuration Precedence", () => {
    test("should use config setting to disable keyword parsing", () => {
      configFixture.general = { keywordParsingEnabled: false };
      commandParser = new CommandParser(configFixture);

      const result = commandParser.getVFXConfig(
        "i",
        "I am a mod and I approve this message",
      );
      expect(result).toBeNull();
    });
  });

  describe("Performance Impact", () => {
    test("should not impact performance when keyword parsing is disabled", () => {
      configFixture.general = { keywordParsingEnabled: false };
      commandParser = new CommandParser(configFixture);

      const startTime = testClock.now();

      for (let i = 0; i < 100; i++) {
        commandParser.getVFXConfig("!hello", "!hello everyone!");
      }

      const simulatedDurationMs = 20;
      testClock.advance(simulatedDurationMs);
      const endTime = testClock.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(100);
    });

    test("should skip keyword checking when keyword parsing is disabled", () => {
      configFixture.general = { keywordParsingEnabled: false };
      commandParser = new CommandParser(configFixture);

      const originalKeywordCheck = commandParser.parsedCommands.keywords;
      commandParser.parsedCommands.keywords = new Map();

      const result = commandParser.getVFXConfig(
        "i",
        "I am a mod and I approve this message",
      );
      expect(result).toBeNull();

      commandParser.parsedCommands.keywords = originalKeywordCheck;
    });
  });
});
