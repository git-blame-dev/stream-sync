import { describe, it, expect, beforeEach } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { loadTokens, saveTokens } from "../../../src/utils/token-store.ts";

type FileStore = Record<string, string>;
type Permissions = Record<string, number>;
type WriteOptions = { mode?: number };
type LoadTokenOptions = Parameters<typeof loadTokens>[0];
type MockLogger = {
  info: ReturnType<typeof createMockFn>;
  warn: ReturnType<typeof createMockFn>;
  error: ReturnType<typeof createMockFn>;
};

const createMockFs = (fileStore: FileStore) => {
  const permissions: Permissions = {};

  return {
    promises: {
      readFile: createMockFn(async (path: string) => {
        if (path in fileStore) return fileStore[path];
        const error = new Error(
          `ENOENT: no such file or directory, open '${path}'`,
        ) as Error & { code?: string };
        error.code = "ENOENT";
        throw error;
      }),
      writeFile: createMockFn(async (path: string, content: string, options?: WriteOptions) => {
        fileStore[path] = content;
        if (options && options.mode) {
          permissions[path] = options.mode;
        }
      }),
      mkdir: createMockFn(async (dirPath: string, options?: WriteOptions) => {
        if (options && options.mode) {
          permissions[dirPath] = options.mode;
        }
      }),
      rename: createMockFn(async (oldPath: string, newPath: string) => {
        const existingContent = fileStore[oldPath];
        if (existingContent !== undefined) {
          fileStore[newPath] = existingContent;
          delete fileStore[oldPath];
          const existingMode = permissions[oldPath];
          if (existingMode !== undefined) {
            permissions[newPath] = existingMode;
            delete permissions[oldPath];
          }
        }
      }),
      unlink: createMockFn(async (path: string) => {
        if (!(path in fileStore)) {
          const error = new Error(
            `ENOENT: no such file or directory, unlink '${path}'`,
          ) as Error & { code?: string };
          error.code = "ENOENT";
          throw error;
        }
        delete fileStore[path];
        delete permissions[path];
      }),
      chmod: createMockFn(async (path: string, mode: number) => {
        permissions[path] = mode;
      }),
      stat: createMockFn(async (path: string) => {
        if (path in fileStore) {
          return { mode: (permissions[path] || 0o644) | 0o100000 };
        }
        const error = new Error(
          `ENOENT: no such file or directory, stat '${path}'`,
        ) as Error & { code?: string };
        error.code = "ENOENT";
        throw error;
      }),
    },
    _fileStore: fileStore,
    _permissions: permissions,
  };
};

const loadTokensWithInvalidOptions = (options: Partial<LoadTokenOptions>) =>
  loadTokens(options as LoadTokenOptions);

const createMockLogger = (): MockLogger => ({
  info: createMockFn(),
  warn: createMockFn(),
  error: createMockFn(),
});

const expectRestrictedMode = (permissions: Permissions, targetPath: string) => {
  const savedMode = permissions[targetPath];
  expect(savedMode).toBeDefined();
  if (savedMode === undefined) {
    throw new Error(`Expected permissions for ${targetPath} to be recorded`);
  }
  expect(savedMode & 0o077).toBe(0);
};

const getTempStorePaths = (fileStore: FileStore, storePath: string) =>
  Object.keys(fileStore).filter(
    (path) => path.startsWith(`${storePath}.`) && path.endsWith(".tmp"),
  );

describe("token-store", () => {
  const storePath = "/test/tokens.json";
  let fileStore: FileStore;
  let mockFs: ReturnType<typeof createMockFs>;

  beforeEach(() => {
    fileStore = {};
    mockFs = createMockFs(fileStore);
  });

  it("throws when tokenStorePath is missing", async () => {
    await expect(
      loadTokensWithInvalidOptions({}),
    ).rejects.toThrow(/tokenStorePath/i);
  });

  it("throws when logger is missing", async () => {
    await expect(
      loadTokensWithInvalidOptions({
        tokenStorePath: storePath,
        fs: mockFs,
      }),
    ).rejects.toThrow(/logger is required/i);
  });

  it("returns null when token store file does not exist", async () => {
    const result = await loadTokens({
      tokenStorePath: storePath,
      fs: mockFs,
      logger: noOpLogger,
    });

    expect(result).toBeNull();
  });

  it("saves and loads tokens from the store", async () => {
    await saveTokens(
      { tokenStorePath: storePath, fs: mockFs, logger: noOpLogger },
      {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: 123456,
      },
    );

    const result = await loadTokens({
      tokenStorePath: storePath,
      fs: mockFs,
      logger: noOpLogger,
    });

    expect(result).toEqual({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: 123456,
    });
  });

  it("creates missing token store directories and persists tokens securely", async () => {
    const nestedStorePath = "/test/nested/tokens.json";

    await saveTokens(
      { tokenStorePath: nestedStorePath, fs: mockFs, logger: noOpLogger },
      {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: 123456,
      },
    );

    expect(mockFs.promises.mkdir).toHaveBeenCalled();

    const result = await loadTokens({
      tokenStorePath: nestedStorePath,
      fs: mockFs,
      logger: noOpLogger,
    });

    expect(result).toEqual({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: 123456,
    });

    if (process.platform !== "win32") {
      expectRestrictedMode(mockFs._permissions, nestedStorePath);
    }
  });

  it("preserves other stored data when saving tokens", async () => {
    const existing = {
      otherService: { value: "keep" },
      twitch: { accessToken: "old", refreshToken: "old-refresh" },
    };
    fileStore[storePath] = JSON.stringify(existing, null, 2);

    await saveTokens(
      { tokenStorePath: storePath, fs: mockFs, logger: noOpLogger },
      { accessToken: "updated-access", refreshToken: "updated-refresh" },
    );

    const updated = JSON.parse(fileStore[storePath] ?? "{}");
    expect(updated.otherService).toEqual({ value: "keep" });
    expect(updated.twitch.accessToken).toBe("updated-access");
    expect(updated.twitch.refreshToken).toBe("updated-refresh");
  });

  it("drops unsafe top-level keys while preserving schema-safe unrelated data", async () => {
    fileStore[storePath] = JSON.stringify({
      ["__proto__"]: { polluted: true },
      constructor: { unsafe: true },
      otherService: { value: "keep" },
      twitch: { accessToken: "old", refreshToken: "old-refresh" },
    });

    await saveTokens(
      { tokenStorePath: storePath, fs: mockFs, logger: noOpLogger },
      { accessToken: "updated-access" },
    );

    const updated = JSON.parse(fileStore[storePath] ?? "{}");
    expect(updated.otherService).toEqual({ value: "keep" });
    expect(Object.prototype.hasOwnProperty.call(updated, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(updated, "constructor")).toBe(false);
    expect(updated.twitch.refreshToken).toBe("old-refresh");
  });

  it("throws when token store contains invalid JSON", async () => {
    fileStore[storePath] = "{invalid-json";

    await expect(
      loadTokens({ tokenStorePath: storePath, fs: mockFs, logger: noOpLogger }),
    ).rejects.toThrow(/invalid token store/i);
  });

  it("preserves existing refresh token when saving access token updates", async () => {
    fileStore[storePath] = JSON.stringify({
      twitch: {
        accessToken: "old-access",
        refreshToken: "persist-me",
        expiresAt: 100,
      },
    });

    await saveTokens(
      { tokenStorePath: storePath, fs: mockFs, logger: noOpLogger },
      { accessToken: "new-access", expiresAt: 200 },
    );

    const updated = JSON.parse(fileStore[storePath] ?? "{}");
    expect(updated.twitch.accessToken).toBe("new-access");
    expect(updated.twitch.refreshToken).toBe("persist-me");
    expect(updated.twitch.expiresAt).toBe(200);
  });

  it("rejects invalid existing JSON during save without overwriting it", async () => {
    const logger = createMockLogger();
    fileStore[storePath] = "{invalid-json";

    await expect(
      saveTokens(
        { tokenStorePath: storePath, fs: mockFs, logger },
        { accessToken: "new-access", refreshToken: "new-refresh" },
      ),
    ).rejects.toThrow(/invalid token store/i);

    expect(fileStore[storePath]).toBe("{invalid-json");
    expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("propagates token store directory setup failures before writing tokens", async () => {
    const logger = createMockLogger();
    mockFs.promises.mkdir.mockRejectedValueOnce(new Error("mkdir failed"));

    await expect(
      saveTokens(
        { tokenStorePath: storePath, fs: mockFs, logger },
        { accessToken: "new-access", refreshToken: "new-refresh" },
      ),
    ).rejects.toThrow(/mkdir failed/i);

    expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("warns and overwrites when existing token store read fails for non-ENOENT reasons", async () => {
    const logger = createMockLogger();
    const readError = new Error("permission denied") as Error & { code?: string };
    readError.code = "EACCES";
    mockFs.promises.readFile.mockRejectedValueOnce(readError);

    await saveTokens(
      { tokenStorePath: storePath, fs: mockFs, logger },
      { accessToken: "new-access", refreshToken: "new-refresh" },
    );

    const saved = JSON.parse(fileStore[storePath] ?? "{}");
    expect(saved.twitch.accessToken).toBe("new-access");
    expect(saved.twitch.refreshToken).toBe("new-refresh");
    expect(logger.warn).toHaveBeenCalledWith(
      "Token store read failed; overwriting with new tokens",
      "token-store",
      {
        tokenStorePath: storePath,
        error: "permission denied",
      },
    );
  });

  it("continues saving when chmod fails on POSIX runtimes", async () => {
    const logger = createMockLogger();
    mockFs.promises.chmod.mockRejectedValue(new Error("chmod failed"));

    await saveTokens(
      { tokenStorePath: storePath, fs: mockFs, logger },
      { accessToken: "new-access", refreshToken: "new-refresh" },
    );

    const saved = JSON.parse(fileStore[storePath] ?? "{}");
    expect(saved.twitch.accessToken).toBe("new-access");
    expect(saved.twitch.refreshToken).toBe("new-refresh");
    if (process.platform !== "win32") {
      expect(logger.error).toHaveBeenCalled();
    }
  });

  it("returns null for empty or missing twitch token payloads", async () => {
    const missingOrEmptyTwitchPayloads = [
      {},
      { twitch: null },
      { twitch: {} },
      { twitch: { accessToken: null, refreshToken: null } },
    ];

    for (const [index, payload] of missingOrEmptyTwitchPayloads.entries()) {
      const tokenStorePath = `/test/tokens-${index}.json`;
      fileStore[tokenStorePath] = JSON.stringify(payload);

      await expect(
        loadTokens({ tokenStorePath, fs: mockFs, logger: noOpLogger }),
      ).resolves.toBeNull();
    }
  });

  it("rejects malformed token store JSON shapes", async () => {
    const malformedPayloads = [
      "[]",
      JSON.stringify({ twitch: [] }),
      JSON.stringify({ twitch: { accessToken: "" } }),
      JSON.stringify({ twitch: { accessToken: "   " } }),
      JSON.stringify({ twitch: { refreshToken: 123 } }),
      JSON.stringify({ twitch: { expiresAt: "soon" } }),
      JSON.stringify({ twitch: { updatedAt: false } }),
    ];

    for (const [index, rawPayload] of malformedPayloads.entries()) {
      const tokenStorePath = `/test/malformed-${index}.json`;
      fileStore[tokenStorePath] = rawPayload;

      await expect(
        loadTokens({ tokenStorePath, fs: mockFs, logger: noOpLogger }),
      ).rejects.toThrow(/invalid token store/i);
    }
  });

  it("propagates rename failures and does not replace the existing token store", async () => {
    const logger = createMockLogger();
    fileStore[storePath] = JSON.stringify({
      twitch: { accessToken: "old-access", refreshToken: "old-refresh" },
    });
    mockFs.promises.rename.mockRejectedValueOnce(new Error("rename failed"));

    await expect(
      saveTokens(
        { tokenStorePath: storePath, fs: mockFs, logger },
        { accessToken: "new-access", refreshToken: "new-refresh" },
      ),
    ).rejects.toThrow(/rename failed/i);

    const existing = JSON.parse(fileStore[storePath] ?? "{}");
    expect(existing.twitch.accessToken).toBe("old-access");
    expect(getTempStorePaths(fileStore, storePath)).toHaveLength(0);
    expect(mockFs.promises.unlink).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("uses unique temporary files for atomic writes", async () => {
    const renamePaths: string[] = [];
    mockFs.promises.rename.mockImplementation(async (oldPath: string, newPath: string) => {
      renamePaths.push(oldPath);
      const existingContent = fileStore[oldPath];
      if (existingContent !== undefined) {
        fileStore[newPath] = existingContent;
        delete fileStore[oldPath];
      }
    });

    await saveTokens(
      { tokenStorePath: storePath, fs: mockFs, logger: noOpLogger },
      { accessToken: "first-access" },
    );
    await saveTokens(
      { tokenStorePath: storePath, fs: mockFs, logger: noOpLogger },
      { accessToken: "second-access" },
    );

    expect(renamePaths).toHaveLength(2);
    expect(renamePaths[0]).not.toBe(renamePaths[1]);
    expect(renamePaths[0]?.startsWith(`${storePath}.`)).toBe(true);
    expect(renamePaths[0]?.endsWith(".tmp")).toBe(true);
  });

  it("does not hide write failures when temp cleanup fails", async () => {
    const logger = createMockLogger();
    mockFs.promises.writeFile.mockImplementationOnce(async (path: string, content: string) => {
      fileStore[path] = content;
      throw new Error("write failed");
    });
    mockFs.promises.unlink.mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(
      saveTokens(
        { tokenStorePath: storePath, fs: mockFs, logger },
        { accessToken: "new-access" },
      ),
    ).rejects.toThrow(/write failed/i);

    expect(logger.error).toHaveBeenCalled();
  });

  it("throws when saving without accessToken", async () => {
    await expect(
      saveTokens(
        { tokenStorePath: storePath, fs: mockFs, logger: noOpLogger },
        { refreshToken: "new-refresh" } as unknown as Parameters<typeof saveTokens>[1],
      ),
    ).rejects.toThrow(/accessToken is required/i);
  });

  it("throws when saving with malformed token fields", async () => {
    await expect(
      saveTokens(
        { tokenStorePath: storePath, fs: mockFs, logger: noOpLogger },
        { accessToken: "   " },
      ),
    ).rejects.toThrow(/accessToken is required/i);

    await expect(
      saveTokens(
        { tokenStorePath: storePath, fs: mockFs, logger: noOpLogger },
        { accessToken: "new-access", refreshToken: "" },
      ),
    ).rejects.toThrow(/refreshToken must be a non-empty string/i);

    await expect(
      saveTokens(
        { tokenStorePath: storePath, fs: mockFs, logger: noOpLogger },
        { accessToken: "new-access", expiresAt: Number.POSITIVE_INFINITY },
      ),
    ).rejects.toThrow(/expiresAt must be a finite number/i);

    expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
  });

  it("saves access token when no refresh token is available", async () => {
    await saveTokens(
      { tokenStorePath: storePath, fs: mockFs, logger: noOpLogger },
      { accessToken: "access-only" },
    );

    const saved = JSON.parse(fileStore[storePath] ?? "{}");
    expect(saved.twitch.accessToken).toBe("access-only");
    expect(saved.twitch.refreshToken).toBeUndefined();
  });
});
