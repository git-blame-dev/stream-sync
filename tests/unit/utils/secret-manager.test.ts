import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import fs from "fs";
import { ensureSecrets } from "../../../src/utils/secret-manager.ts";

type FileStore = Record<string, string>;
type FilePermissions = Record<string, number>;
type LoggerEntry = { level: string; message: string };
type CapturingLogger = ReturnType<typeof createCapturingLogger>;
type TestConfig = {
  tiktok: Record<string, unknown>;
  twitch: Record<string, unknown>;
  obs: Record<string, unknown>;
  streamelements: Record<string, unknown>;
  youtube: Record<string, unknown>;
};
type WriteFileOptions = { mode?: number; encoding?: BufferEncoding };
type MutableFs = {
  readFileSync: (path: string, encoding?: BufferEncoding) => string;
  writeFileSync: (
    path: string,
    content: string,
    options?: WriteFileOptions | BufferEncoding,
  ) => void;
  existsSync: (path: string) => boolean;
  chmodSync: (path: string, mode: number) => void;
  statSync: (path: string) => { mode: number };
};

const mutableFs = fs as unknown as MutableFs;

let originalReadFileSync: MutableFs["readFileSync"];
let originalWriteFileSync: MutableFs["writeFileSync"];
let originalExistsSync: MutableFs["existsSync"];
let originalChmodSync: MutableFs["chmodSync"];
let originalStatSync: MutableFs["statSync"];

const createCapturingLogger = () => {
  const entries: LoggerEntry[] = [];
  const push = (level: string) => (message: string) => entries.push({ level, message });
  return {
    entries,
    debug: push("debug"),
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
  };
};

describe("secret-manager", () => {
  let testConfig: TestConfig;
  let logger: CapturingLogger;
  const originalEnv: Record<string, string | undefined> = {};
  const envFilePath = "/test/.env";

  let fileStore: FileStore;
  let filePermissions: FilePermissions;

  const setupFsMocks = () => {
    fileStore = {};
    filePermissions = {};

    mutableFs.existsSync = createMockFn((path: string) => path in fileStore);
    mutableFs.readFileSync = createMockFn((path: string) => {
      if (path in fileStore) return fileStore[path] ?? "";
      throw new Error(`ENOENT: no such file: ${path}`);
    });
    mutableFs.writeFileSync = createMockFn((
      path: string,
      content: string,
      options?: WriteFileOptions | BufferEncoding,
    ) => {
      fileStore[path] = content;
      if (options && typeof options === "object" && options.mode) {
        filePermissions[path] = options.mode;
      }
    });
    mutableFs.chmodSync = createMockFn((path: string, mode: number) => {
      filePermissions[path] = mode;
    });
    mutableFs.statSync = createMockFn((path: string) => {
      if (!(path in fileStore)) {
        throw new Error(`ENOENT: no such file: ${path}`);
      }
      return {
        mode: (filePermissions[path] || 0o644) | 0o100000,
      };
    });
  };

  beforeEach(() => {
    originalReadFileSync = mutableFs.readFileSync;
    originalWriteFileSync = mutableFs.writeFileSync;
    originalExistsSync = mutableFs.existsSync;
    originalChmodSync = mutableFs.chmodSync;
    originalStatSync = mutableFs.statSync;

    setupFsMocks();

    testConfig = {
      tiktok: { enabled: true, username: "test-tiktok-user" },
      twitch: {
        enabled: true,
        username: "test-twitch-user",
        channel: "test-twitch-channel",
        clientId: "test-client-id",
      },
      obs: { enabled: true },
      streamelements: {
        enabled: true,
        youtubeChannelId: "test-yt-channel",
        twitchChannelId: "test-twitch-channel",
      },
      youtube: { enabled: false },
    };
    logger = createCapturingLogger();

    [
      "TIKTOK_API_KEY",
      "TWITCH_CLIENT_SECRET",
      "OBS_PASSWORD",
      "STREAMELEMENTS_JWT_TOKEN",
      "YOUTUBE_API_KEY",
    ].forEach((key) => {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    });
  });

  afterEach(() => {
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });

    mutableFs.readFileSync = originalReadFileSync;
    mutableFs.writeFileSync = originalWriteFileSync;
    mutableFs.existsSync = originalExistsSync;
    mutableFs.chmodSync = originalChmodSync;
    mutableFs.statSync = originalStatSync;
    restoreAllMocks();
  });

  it("applies environment secrets without prompting and leaves existing env file untouched", async () => {
    process.env.TIKTOK_API_KEY = "env_tiktok_key";
    process.env.TWITCH_CLIENT_SECRET = "env_client_secret";
    process.env.OBS_PASSWORD = "env_obs_password";
    process.env.STREAMELEMENTS_JWT_TOKEN = "env_jwt_token";

    const result = await ensureSecrets({
      config: {
        tiktok: testConfig.tiktok,
        twitch: testConfig.twitch,
        obs: testConfig.obs,
        streamelements: testConfig.streamelements,
      },
      logger,
      interactive: false,
      envFilePath,
      envFileReadEnabled: false,
      envFileWriteEnabled: false,
    });

    expect(result.missingRequired).toEqual([]);
    expect(process.env.TIKTOK_API_KEY).toBe("env_tiktok_key");
    expect(process.env.OBS_PASSWORD).toBe("env_obs_password");
    expect(envFilePath in fileStore).toBe(false);
    expect(
      logger.entries.some((entry) => entry.message.includes("env_tiktok_key")),
    ).toBe(false);
  });

  it("prompts in interactive mode, persists secrets to .env, and preserves existing entries", async () => {

    const promptValues: Record<string, string> = {
      TIKTOK_API_KEY: "prompt_tiktok",
      TWITCH_CLIENT_SECRET: "prompt_client_secret",
      OBS_PASSWORD: "prompt_obs_password",
      STREAMELEMENTS_JWT_TOKEN: "prompt_jwt",
    };

    const promptFor = async (secretId: string) => promptValues[secretId] || "";
    fileStore[envFilePath] = "EXISTING=keep\n";

    const result = await ensureSecrets({
      config: {
        tiktok: testConfig.tiktok,
        twitch: testConfig.twitch,
        obs: testConfig.obs,
        streamelements: testConfig.streamelements,
      },
      logger,
      interactive: true,
      envFilePath,
      envFileReadEnabled: true,
      envFileWriteEnabled: true,
      promptFor,
    });

    const envContent = fileStore[envFilePath];
    expect(envContent).toContain("EXISTING=keep");
    expect(envContent).toContain("TIKTOK_API_KEY=prompt_tiktok");
    expect(envContent).toContain("OBS_PASSWORD=prompt_obs_password");
    expect(process.env.TWITCH_CLIENT_SECRET).toBe("prompt_client_secret");
    expect(result.persisted.sort()).toEqual(
      expect.arrayContaining([
        "TIKTOK_API_KEY",
        "TWITCH_CLIENT_SECRET",
        "OBS_PASSWORD",
        "STREAMELEMENTS_JWT_TOKEN",
      ]),
    );
    expect(
      logger.entries.some((entry) =>
        entry.message.includes("prompt_client_secret"),
      ),
    ).toBe(false);
  });

  it("writes the env file with restricted permissions", async () => {

    const promptValues: Record<string, string> = {
      TIKTOK_API_KEY: "prompt_tiktok",
      TWITCH_CLIENT_SECRET: "prompt_client_secret",
      OBS_PASSWORD: "prompt_obs_password",
      STREAMELEMENTS_JWT_TOKEN: "prompt_jwt",
    };

    const promptFor = async (secretId: string) => promptValues[secretId] || "";

    await ensureSecrets({
      config: {
        tiktok: testConfig.tiktok,
        twitch: testConfig.twitch,
        obs: testConfig.obs,
        streamelements: testConfig.streamelements,
      },
      logger,
      interactive: true,
      envFilePath,
      envFileReadEnabled: false,
      envFileWriteEnabled: true,
      promptFor,
    });

    expect(envFilePath in fileStore).toBe(true);

    if (process.platform !== "win32") {
      const savedMode = filePermissions[envFilePath];
      expect(savedMode).toBeDefined();
      if (savedMode === undefined) {
        throw new Error("Expected env file permissions to be recorded");
      }
      const mode = savedMode & 0o077;
      expect(mode).toBe(0);
    }
  });

  it("requires a YouTube API key when API methods are selected", async () => {
    process.env.TIKTOK_API_KEY = "env_tiktok_key";
    process.env.TWITCH_CLIENT_SECRET = "env_client_secret";
    process.env.OBS_PASSWORD = "env_obs_password";
    process.env.STREAMELEMENTS_JWT_TOKEN = "env_jwt_token";

    const youtubeSection = {
      ...testConfig.youtube,
      enabled: true,
      enableAPI: false,
      streamDetectionMethod: "api",
      viewerCountMethod: "youtubei",
    };

    await expect(
      ensureSecrets({
        config: {
          tiktok: testConfig.tiktok,
          twitch: testConfig.twitch,
          obs: testConfig.obs,
          streamelements: testConfig.streamelements,
          youtube: youtubeSection,
        },
        logger,
        interactive: false,
        envFilePath,
        envFileReadEnabled: false,
        envFileWriteEnabled: false,
      }),
    ).rejects.toThrow(/missing required secrets/i);
  });

  it("shows colon-terminated prompts for interactive clarity", async () => {

    const promptValues: Record<string, string> = {
      TIKTOK_API_KEY: "prompt_tiktok",
      TWITCH_CLIENT_SECRET: "prompt_client_secret",
      OBS_PASSWORD: "prompt_obs_password",
      STREAMELEMENTS_JWT_TOKEN: "prompt_jwt",
    };

    const promptsSeen: Array<{ secretId: string; promptText: string }> = [];
    const promptFor = async (secretId: string, promptText = "") => {
      promptsSeen.push({ secretId, promptText });
      return promptValues[secretId] || "";
    };

    await ensureSecrets({
      config: {
        tiktok: testConfig.tiktok,
        twitch: testConfig.twitch,
        obs: testConfig.obs,
        streamelements: testConfig.streamelements,
      },
      logger,
      interactive: true,
      envFilePath,
      envFileReadEnabled: false,
      envFileWriteEnabled: false,
      promptFor,
    });

    expect(promptsSeen).not.toHaveLength(0);
    promptsSeen.forEach(({ promptText }) => {
      expect(promptText).toMatch(/: $/);
    });
  });

  it("prompts for required secrets when interactive and TTY is available", async () => {
    const promptCalls: string[] = [];
    const promptFor = async (secretId: string) => {
      promptCalls.push(secretId);
      return "test-tiktok-api-key";
    };

    const originalIsTTY = process.stdin.isTTY;
    const originalCI = process.env.CI;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalApiKey = process.env.TIKTOK_API_KEY;

    process.stdin.isTTY = true;
    delete process.env.CI;
    process.env.NODE_ENV = "test";

    try {
      const result = await ensureSecrets({
        config: {
          tiktok: { enabled: true },
          twitch: { enabled: false },
          obs: { enabled: false },
          streamelements: { enabled: false },
          youtube: { enabled: false },
        },
        logger,
        interactive: true,
        envFileReadEnabled: false,
        envFileWriteEnabled: false,
        promptFor,
      });

      expect(promptCalls).toEqual(["TIKTOK_API_KEY"]);
      expect(result.missingRequired).toEqual([]);
      expect(result.applied.TIKTOK_API_KEY).toBeDefined();
      expect(result.applied.TIKTOK_API_KEY?.source).toBe("prompt");
      expect(process.env.TIKTOK_API_KEY).toBe("test-tiktok-api-key");
    } finally {
      process.stdin.isTTY = originalIsTTY;
      if (originalCI === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCI;
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalApiKey === undefined) {
        delete process.env.TIKTOK_API_KEY;
      } else {
        process.env.TIKTOK_API_KEY = originalApiKey;
      }
    }
  });

  it("fails fast in non-interactive mode when required secrets are missing", async () => {
    process.env.TIKTOK_API_KEY = "env_tiktok_key";
    process.env.OBS_PASSWORD = "env_obs_password";
    process.env.STREAMELEMENTS_JWT_TOKEN = "env_jwt_token";

    await expect(
      ensureSecrets({
        config: {
          tiktok: testConfig.tiktok,
          twitch: testConfig.twitch,
          obs: testConfig.obs,
          streamelements: testConfig.streamelements,
        },
        logger,
        interactive: false,
        envFilePath,
        envFileReadEnabled: false,
        envFileWriteEnabled: false,
      }),
    ).rejects.toThrow(/missing required secrets/i);
  });

  it("preserves class-based logger prototype methods", async () => {
    let debugCalls = 0;

    class PrototypeLogger {
      debug() {
        debugCalls += 1;
      }

      info() {}

      warn() {}

      error() {}
    }

    process.env.TIKTOK_API_KEY = "env_tiktok_key";
    process.env.TWITCH_CLIENT_SECRET = "env_client_secret";
    process.env.OBS_PASSWORD = "env_obs_password";
    process.env.STREAMELEMENTS_JWT_TOKEN = "env_jwt_token";

    const logger = new PrototypeLogger();

    const result = await ensureSecrets({
      config: {
        tiktok: testConfig.tiktok,
        twitch: testConfig.twitch,
        obs: testConfig.obs,
        streamelements: testConfig.streamelements,
      },
      logger,
      interactive: false,
      envFilePath,
      envFileReadEnabled: false,
      envFileWriteEnabled: false,
    });

    expect(result.missingRequired).toEqual([]);
    expect(debugCalls).toBeGreaterThan(0);
  });
});
