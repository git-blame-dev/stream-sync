import { describe, it, expect, beforeEach } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { loadTokens, saveTokens } from "../../../src/utils/token-store.ts";

type FileStore = Record<string, string>;
type Permissions = Record<string, number>;
type WriteOptions = { mode?: number };
type LoadTokenOptions = Parameters<typeof loadTokens>[0];

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

const expectRestrictedMode = (permissions: Permissions, targetPath: string) => {
  const savedMode = permissions[targetPath];
  expect(savedMode).toBeDefined();
  if (savedMode === undefined) {
    throw new Error(`Expected permissions for ${targetPath} to be recorded`);
  }
  expect(savedMode & 0o077).toBe(0);
};

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

  it("throws when saving without accessToken", async () => {
    await expect(
      saveTokens(
        { tokenStorePath: storePath, fs: mockFs, logger: noOpLogger },
        { refreshToken: "new-refresh" } as unknown as Parameters<typeof saveTokens>[1],
      ),
    ).rejects.toThrow(/accessToken is required/i);
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
