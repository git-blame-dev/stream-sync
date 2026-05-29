import { describe, it, expect } from "bun:test";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";

import {
  createTikTokGiftAnimationResolver,
  getGiftAnimationDependencyStatus,
} from "../../../../src/services/tiktok-gift-animation/resolver";

type AnimationUrl = { label: string; url: string };
type ExecuteFile = (command: string, args: string[]) => Promise<{ stdout?: string; stderr?: string }>;
type FetchBinary = (url: string) => Promise<{ data: Buffer }>;
type ResolverLogger = { debug: () => void; info: () => void; warn: () => void; error: () => void };
type UnzipContext = {
  marker: string;
  extractDirectory: string;
  cacheDirectory: string;
};
type HarnessOptions = {
  executeFile?: ExecuteFile;
  onUnzip?: (context: UnzipContext) => Promise<void>;
  logger?: ResolverLogger;
  maxEntries?: number;
};
type CodedError = Error & { code: string };

function createResolverLogger(): ResolverLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function createNotificationData(urls: AnimationUrl[]) {
  return {
    enhancedGiftData: {
      originalData: {
        asset: {
          videoResourceList: urls.map((entry: AnimationUrl) => ({
            videoTypeName: entry.label,
            videoUrl: {
              urlList: [entry.url],
            },
          })),
        },
      },
    },
  };
}

function createResolverTestHarness(options: HarnessOptions = {}) {
  const cacheDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "gift-animation-resolver-test-"),
  );
  const fetchCalls: string[] = [];

  const fetchBinary: FetchBinary = async (url: string) => {
    fetchCalls.push(url);
    return { data: Buffer.from(url) };
  };

  const executeFile =
    options.executeFile ||
    (async (command: string, args: string[]) => {
      if (command === "ffprobe") {
        return { stdout: "2.5\n" };
      }

      if (command !== "unzip") {
        throw new Error(`Unexpected command: ${command}`);
      }

      const zipPath = args[1];
      const extractDirectory = args[3];
      if (!zipPath || !extractDirectory) {
        throw new Error("Expected unzip zip path and extract directory arguments");
      }
      const marker = String(await fsp.readFile(zipPath));

      if (typeof options.onUnzip === "function") {
        await options.onUnzip({ marker, extractDirectory, cacheDirectory });
        return { stdout: "" };
      }

      throw new Error("onUnzip handler is required");
    });

  const logger: ResolverLogger = options.logger || createResolverLogger();

  const resolver = createTikTokGiftAnimationResolver({
    cacheDirectory,
    maxEntries: options.maxEntries || 12,
    fetchBinary,
    executeFile,
    logger,
  });

  return {
    resolver,
    cacheDirectory,
    fetchCalls,
    async cleanup() {
      await fsp.rm(cacheDirectory, { recursive: true, force: true });
    },
  };
}

describe("TikTok gift animation resolver behavior", () => {
  it("falls through ranked candidates when the top candidate fails", async () => {
    const harness = createResolverTestHarness({
      onUnzip: async ({ marker, extractDirectory }) => {
        if (marker.includes("https://example.invalid/fail.zip")) {
          throw new Error("failed extracting top candidate");
        }

        await fsp.writeFile(
          path.join(extractDirectory, "config.json"),
          JSON.stringify({
            portrait: {
              path: "output.mp4",
              videoW: 960,
              videoH: 864,
              w: 480,
              h: 854,
              rgbFrame: [0, 0, 480, 854],
              aFrame: [480, 0, 480, 854],
              f: 75,
            },
          }),
        );
        await fsp.writeFile(
          path.join(extractDirectory, "output.mp4"),
          Buffer.from("ok"),
        );
      },
    });

    try {
      const resolved = await harness.resolver.resolveFromNotificationData(
        createNotificationData([
          { label: "h264", url: "https://example.invalid/fail.zip" },
          { label: "480p", url: "https://example.invalid/success.zip" },
        ]),
      );

      expect(resolved).toBeDefined();
      expect(harness.fetchCalls).toEqual([
        "https://example.invalid/fail.zip",
        "https://example.invalid/success.zip",
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  it("uses first valid profile when portrait exists but is invalid", async () => {
    const harness = createResolverTestHarness({
      onUnzip: async ({ extractDirectory }) => {
        await fsp.writeFile(
          path.join(extractDirectory, "config.json"),
          JSON.stringify({
            portrait: {
              path: "portrait.mp4",
              videoW: 960,
              videoH: 864,
              w: 480,
              h: 854,
              f: 75,
            },
            landscape: {
              path: "landscape.mp4",
              videoW: 960,
              videoH: 864,
              w: 480,
              h: 854,
              rgbFrame: [0, 0, 480, 854],
              aFrame: [480, 0, 480, 854],
              f: 75,
            },
          }),
        );
        await fsp.writeFile(
          path.join(extractDirectory, "landscape.mp4"),
          Buffer.from("ok"),
        );
      },
    });

    try {
      const resolved = await harness.resolver.resolveFromNotificationData(
        createNotificationData([
          {
            label: "h264",
            url: "https://example.invalid/profile-fallback.zip",
          },
        ]),
      );

      expect(resolved).toBeDefined();
      if (!resolved) {
        throw new Error("Expected resolved gift animation");
      }
      expect(resolved.animationConfig.profileName).toBe("landscape");
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects extracted media paths that escape the extract directory", async () => {
    const harness = createResolverTestHarness({
      onUnzip: async ({ extractDirectory }) => {
        const escapedPath = path.resolve(extractDirectory, "../../escaped.mp4");
        await fsp.mkdir(path.dirname(escapedPath), { recursive: true });
        await fsp.writeFile(escapedPath, Buffer.from("escaped"));
        await fsp.writeFile(
          path.join(extractDirectory, "config.json"),
          JSON.stringify({
            portrait: {
              path: "../../escaped.mp4",
              videoW: 960,
              videoH: 864,
              w: 480,
              h: 854,
              rgbFrame: [0, 0, 480, 854],
              aFrame: [480, 0, 480, 854],
              f: 75,
            },
          }),
        );
      },
    });

    try {
      const resolved = await harness.resolver.resolveFromNotificationData(
        createNotificationData([
          { label: "h264", url: "https://example.invalid/path-escape.zip" },
        ]),
      );

      expect(resolved).toBeNull();
    } finally {
      await harness.cleanup();
    }
  });

  it("prunes pre-existing cache directories on startup using max entries", async () => {
    const cacheDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "gift-animation-prune-test-"),
    );
    const oldA = path.join(cacheDirectory, "a");
    const oldB = path.join(cacheDirectory, "b");
    const oldC = path.join(cacheDirectory, "c");
    const oldD = path.join(cacheDirectory, "d");
    await fsp.mkdir(oldA, { recursive: true });
    await fsp.mkdir(oldB, { recursive: true });
    await fsp.mkdir(oldC, { recursive: true });
    await fsp.mkdir(oldD, { recursive: true });

    const baseTimestampMs = 1700000000000;
    const setAge = async (directoryPath: string, ageMs: number) => {
      const at = new Date(baseTimestampMs - ageMs);
      await fsp.utimes(directoryPath, at, at);
    };

    await setAge(oldA, 4000);
    await setAge(oldB, 3000);
    await setAge(oldC, 2000);
    await setAge(oldD, 1000);

    const resolver = createTikTokGiftAnimationResolver({
      cacheDirectory,
      maxEntries: 2,
      fetchBinary: async () => ({ data: Buffer.from("") }),
      executeFile: async () => ({ stdout: "" }),
      logger: createResolverLogger(),
    });

    try {
      await resolver.resolveFromNotificationData({});
      const entries = await fsp.readdir(cacheDirectory, {
        withFileTypes: true,
      });
      const directories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      expect(directories.length).toBe(2);
      expect(directories.includes("d")).toBe(true);
      expect(directories.includes("c")).toBe(true);
    } finally {
      await fsp.rm(cacheDirectory, { recursive: true, force: true });
    }
  });

  it("fails when unzip is unavailable everywhere", async () => {
    const cacheDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "gift-animation-unzip-missing-"),
    );
    const commands: string[] = [];

    const resolver = createTikTokGiftAnimationResolver({
      cacheDirectory,
      unzipBinaries: ["unzip"],
      fetchBinary: async (url: string) => ({ data: Buffer.from(url) }),
      executeFile: async (command: string, args: string[]) => {
        commands.push(command);
        if (command === "ffprobe") {
          return { stdout: "2.5\n" };
        }

        if (command === "unzip") {
          const missingError: CodedError = Object.assign(new Error(
            'Executable not found in $PATH: "unzip"',
          ), { code: "ENOENT" });
          throw missingError;
        }

        if (command === "/usr/bin/unzip" || command === "/bin/unzip") {
          const missingError: CodedError = Object.assign(new Error(`spawn ${command} ENOENT`), {
            code: "ENOENT",
          });
          throw missingError;
        }

        throw new Error(`Unexpected command: ${command}`);
      },
      logger: createResolverLogger(),
    });

    try {
      const resolved = await resolver.resolveFromNotificationData(
        createNotificationData([
          { label: "h264", url: "https://example.invalid/fallback.zip" },
        ]),
      );

      expect(resolved).toBeNull();
      expect(commands).toEqual(["unzip", "/usr/bin/unzip", "/bin/unzip"]);
    } finally {
      await fsp.rm(cacheDirectory, { recursive: true, force: true });
    }
  });

  it("uses absolute unzip path fallback when unzip is missing in PATH", async () => {
    const cacheDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "gift-animation-unzip-absolute-"),
    );
    let usedAbsoluteUnzip = false;

    const resolver = createTikTokGiftAnimationResolver({
      cacheDirectory,
      fetchBinary: async (url: string) => ({ data: Buffer.from(url) }),
      executeFile: async (command: string, args: string[]) => {
        if (command === "ffprobe") {
          return { stdout: "2.5\n" };
        }

        if (command === "unzip") {
          const missingError: CodedError = Object.assign(new Error("spawn unzip ENOENT"), {
            code: "ENOENT",
          });
          throw missingError;
        }

        if (command === "/usr/bin/unzip") {
          usedAbsoluteUnzip = true;
          const zipPath = args[1];
          const extractDirectory = args[3];
          if (!zipPath || !extractDirectory) {
            throw new Error("Expected unzip zip path and extract directory arguments");
          }
          const marker = String(await fsp.readFile(zipPath));
          expect(
            marker.includes("https://example.invalid/unzip-absolute.zip"),
          ).toBe(true);

          await fsp.mkdir(extractDirectory, { recursive: true });
          await fsp.writeFile(
            path.join(extractDirectory, "config.json"),
            JSON.stringify({
              portrait: {
                path: "output.mp4",
                videoW: 960,
                videoH: 864,
                w: 480,
                h: 854,
                rgbFrame: [0, 0, 480, 854],
                aFrame: [480, 0, 480, 854],
                f: 75,
              },
            }),
          );
          await fsp.writeFile(
            path.join(extractDirectory, "output.mp4"),
            Buffer.from("ok"),
          );
          return { stdout: "" };
        }

        throw new Error(`Unexpected command: ${command}`);
      },
      logger: createResolverLogger(),
    });

    try {
      const resolved = await resolver.resolveFromNotificationData(
        createNotificationData([
          { label: "h264", url: "https://example.invalid/unzip-absolute.zip" },
        ]),
      );

      expect(usedAbsoluteUnzip).toBe(true);
      expect(resolved).toBeDefined();
      if (!resolved) {
        throw new Error("Expected resolved gift animation");
      }
      expect(resolved.mediaContentType).toBe("video/mp4");
    } finally {
      await fsp.rm(cacheDirectory, { recursive: true, force: true });
    }
  });
});

describe("TikTok gift animation dependency diagnostics", () => {
  it("reports unzip extraction availability", () => {
    const status = getGiftAnimationDependencyStatus({
      platform: "linux",
      pathEnv: "/usr/local/bin:/usr/bin",
      fileExists: (candidatePath: string) => candidatePath === "/usr/bin/unzip",
    });

    expect(status.unzip.available).toBe(true);
    expect(status.unzip.command).toBe("/usr/bin/unzip");
    expect(status.extraction.available).toBe(true);
    expect(status.extraction.command).toBe("/usr/bin/unzip");
  });
});
