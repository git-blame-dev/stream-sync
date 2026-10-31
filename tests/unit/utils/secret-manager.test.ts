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
type WriteFileOptions = { mode?: number; encoding?: BufferEncoding; flag?: string };
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
  renameSync: (from: string, to: string) => void;
  unlinkSync: (path: string) => void;
};

const mutableFs = fs as unknown as MutableFs;

let originalReadFileSync: MutableFs["readFileSync"];
let originalWriteFileSync: MutableFs["writeFileSync"];
let originalExistsSync: MutableFs["existsSync"];
let originalChmodSync: MutableFs["chmodSync"];
let originalStatSync: MutableFs["statSync"];
let originalRenameSync: MutableFs["renameSync"];
let originalUnlinkSync: MutableFs["unlinkSync"];

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
    mutableFs.renameSync = createMockFn((from: string, to: string) => {
      fileStore[to] = fileStore[from] ?? "";
      filePermissions[to] = filePermissions[from] ?? 0;
      delete fileStore[from];
      delete filePermissions[from];
    });
    mutableFs.unlinkSync = createMockFn((path: string) => {
      delete fileStore[path];
      delete filePermissions[path];
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
    originalRenameSync = mutableFs.renameSync;
    originalUnlinkSync = mutableFs.unlinkSync;

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
    mutableFs.renameSync = originalRenameSync;
    mutableFs.unlinkSync = originalUnlinkSync;
    restoreAllMocks();
  });

  it("persists representable updates without replacing an unrepresentable credential's existing entry", async () => {
    fileStore[envFilePath] = "OBS_PASSWORD=synthetic-old\nKEEP=synthetic-keep\n";
    const result = await ensureSecrets({
      config: { obs: { enabled: true }, tiktok: { enabled: true } }, logger,
      interactive: true, envFilePath, envFileReadEnabled: false, envFileWriteEnabled: true,
      promptFor: async id => id === 'OBS_PASSWORD' ? 'synthetic-$SYNTHETIC_VAR' : 'synthetic-saveable',
    });
    expect(result.persisted).toEqual(['TIKTOK_API_KEY']);
    expect(process.env.OBS_PASSWORD).toBe('synthetic-$SYNTHETIC_VAR');
    expect(fileStore[envFilePath]).toContain('OBS_PASSWORD=synthetic-old');
    expect(fileStore[envFilePath]).toContain('TIKTOK_API_KEY=synthetic-saveable');
    expect(logger.entries.some(entry => entry.message.includes('not persisted'))).toBe(true);
    expect(logger.entries.some(entry => entry.message.includes('synthetic-$SYNTHETIC_VAR'))).toBe(false);
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
    expect(logger.entries.filter((entry) => entry.level === "debug").map((entry) => entry.message)).toEqual(["Using TIKTOK_API_KEY", "Using TWITCH_CLIENT_SECRET", "Using OBS_PASSWORD", "Using STREAMELEMENTS_JWT_TOKEN"]);
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

    expect(logger.entries.filter((entry) => entry.level === "info").map((entry) => entry.message)).toEqual(["Using prompted TIKTOK_API_KEY for this process", "Using prompted TWITCH_CLIENT_SECRET for this process", "Using prompted OBS_PASSWORD for this process", "Using prompted STREAMELEMENTS_JWT_TOKEN for this process"]);
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

  for (const failure of ["write", "rename"] as const) {
    it(`preserves the original and cleans the adjacent temp on ${failure} failure`, async () => {
      fileStore[envFilePath] = "EXISTING=synthetic-original\n";
      const write = mutableFs.writeFileSync;
      let tempPath = "";
      mutableFs.writeFileSync = (target, content, options) => {
        tempPath = target;
        write(target, content, options);
        if (failure === "write") throw new Error("synthetic write failure");
      };
      mutableFs.renameSync = () => { throw new Error("synthetic rename failure"); };
      const result = await ensureSecrets({
        config: { tiktok: { enabled: true } }, logger, interactive: true,
        envFilePath, envFileWriteEnabled: true,
        promptFor: async () => "synthetic-secret",
      });
      expect(result.persisted).toEqual([]);
      expect(tempPath.startsWith(`${envFilePath}.`)).toBe(true);
      expect(fileStore[envFilePath]).toBe("EXISTING=synthetic-original\n");
      expect(Object.keys(fileStore)).toEqual([envFilePath]);
    });
  }

  it("does not unlink a temp owned by another writer after an exclusive-create collision", async () => {
    let foreignTemp = "";
    mutableFs.writeFileSync = (target) => {
      foreignTemp = target;
      fileStore[target] = "synthetic-other-writer";
      throw Object.assign(new Error("synthetic exclusive-create collision"), { code: "EEXIST" });
    };
    const result = await ensureSecrets({
      config: { tiktok: { enabled: true } }, logger, interactive: true,
      envFilePath, envFileWriteEnabled: true,
      promptFor: async () => "synthetic-secret",
    });
    expect(result.persisted).toEqual([]);
    expect(fileStore[foreignTemp]).toBe("synthetic-other-writer");
  });

  it("preserves the file and empty persistence result when cleanup and diagnostics throw", async () => {
    fileStore[envFilePath] = "EXISTING=synthetic-original\n";
    const original = new Error("synthetic rename failure");
    const reported = new Error("synthetic persistence logger failure");
    mutableFs.renameSync = () => { throw original; };
    mutableFs.unlinkSync = () => { throw new Error("synthetic cleanup failure"); };
    logger.error = (message: string) => {
      if (message === "Failed to persist secrets to environment file") throw reported;
      throw new Error("synthetic cleanup logger failure");
    };
    const result = await ensureSecrets({
      config: { tiktok: { enabled: true } }, logger, interactive: true,
      envFilePath, envFileWriteEnabled: true,
      promptFor: async () => "synthetic-secret",
    });
    expect(result.persisted).toEqual([]);
    expect(fileStore[envFilePath]).toBe("EXISTING=synthetic-original\n");
  });

  it("creates a unique exclusive 0600 adjacent temp before replacing an existing file", async () => {
    fileStore[envFilePath] = "TIKTOK_API_KEY=synthetic-old\nEXISTING=keep\n";
    filePermissions[envFilePath] = 0o644;
    const write = mutableFs.writeFileSync;
    const writes: Array<{ target: string; options: WriteFileOptions | BufferEncoding | undefined; original: string | undefined }> = [];
    mutableFs.writeFileSync = (target, content, options) => {
      writes.push({ target, options, original: fileStore[envFilePath] });
      write(target, content, options);
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      delete process.env.TIKTOK_API_KEY;
      await ensureSecrets({
        config: { tiktok: { enabled: true } }, logger, interactive: true,
        envFilePath, envFileWriteEnabled: true,
        promptFor: async () => "synthetic-old-replacement",
      });
    }
    expect(writes).toHaveLength(2);
    expect(new Set(writes.map(({ target }) => target)).size).toBe(2);
    for (const { target, options, original } of writes) {
      expect(target.startsWith(`${envFilePath}.`)).toBe(true);
      expect(options).toEqual({ encoding: "utf8", mode: 0o600, flag: "wx" });
      expect(original).toContain("synthetic-old");
    }
    expect(filePermissions[envFilePath]).toBe(0o600);
    expect(fileStore[envFilePath]).toBe("TIKTOK_API_KEY=synthetic-old-replacement\nEXISTING=keep\n");
    expect(Object.keys(fileStore)).toEqual([envFilePath]);
  });

  for (const selection of [
    { enableAPI: true },
    { streamDetectionMethod: "api" },
    { viewerCountMethod: "api" },
  ]) {
    it(`rejects unsupported YouTube selection ${JSON.stringify(selection)} before any secret prompt`, async () => {
      await expect(ensureSecrets({
        config: { youtube: { enabled: true, ...selection } },
        logger,
        interactive: true,
        promptFor: async () => { throw new Error("Unexpected secret prompt"); },
      })).rejects.toThrow(/YouTube Data API.*not supported.*youtubei/);
    });
  }

  it("requires no YouTube key for enabled youtubei discovery and viewer counts", async () => {
    const result = await ensureSecrets({
      config: { youtube: { enabled: true, streamDetectionMethod: "youtubei", viewerCountMethod: "youtubei" } },
      logger,
      interactive: true,
      promptFor: async () => { throw new Error("Unexpected secret prompt"); },
    });
    expect(result.applied).toEqual({});
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
