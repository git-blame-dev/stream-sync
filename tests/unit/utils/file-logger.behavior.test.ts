import { describe, expect, it, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../../helpers/bun-mock-utils";
import { FileLogger } from "../../../src/utils/file-logger";
import { type TestMockFn } from "../../helpers/bun-mock-utils";
type FileStore = Record<string, string>;
type FileLoggerDependencies = NonNullable<ConstructorParameters<typeof FileLogger>[1]>;
type FileLoggerFs = NonNullable<FileLoggerDependencies["fs"]>;
type StderrWrite = typeof process.stderr.write;
type MockFileLoggerFs = FileLoggerDependencies extends { fs?: infer Fs }
  ? Omit<Fs, "appendFileSync" | "existsSync" | "mkdirSync"> & {
      _files: FileStore;
      _dirs: Set<string>;
      existsSync: TestMockFn<[string], boolean>;
      mkdirSync: TestMockFn<[string], string | undefined>;
      appendFileSync: TestMockFn<[string, string], void>;
    }
  : never;

function createMockFs() {
  const files: FileStore = {};
  const dirs = new Set<string>();

  return {
    _files: files,
    _dirs: dirs,
    existsSync: createMockFn(
      (target: string) =>
        dirs.has(target) || Object.prototype.hasOwnProperty.call(files, target),
    ),
    mkdirSync: createMockFn<[string], string | undefined>((dir: string) => {
      dirs.add(dir);
      return undefined;
    }),
    appendFileSync: createMockFn((file: string, content: string) => {
      files[file] = (files[file] || "") + content;
    }),
    statSync: createMockFn((file: string) => ({ size: (files[file] || "").length })),
    renameSync: createMockFn((oldPath: string, newPath: string) => {
      files[newPath] = files[oldPath] || "";
      delete files[oldPath];
    }),
    unlinkSync: createMockFn((target: string) => {
      delete files[target];
    }),
  } as MockFileLoggerFs;
}

describe("file-logger behavior", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  it("requires a log directory for construction", () => {
    expect(() => new FileLogger()).toThrow("logDir is required");
  });

  it("creates the configured log directory on construction", () => {
    const mockFs = createMockFs();

    new FileLogger({ logDir: "logs-test" }, { fs: mockFs as FileLoggerFs });

    expect(mockFs._dirs.has("logs-test")).toBe(true);
  });

  it("writes log content to the configured file", () => {
    const mockFs = createMockFs();

    const logger = new FileLogger(
      { logDir: "logs", filename: "app.log" },
      { fs: mockFs as FileLoggerFs },
    );

    logger.log("new-line");

    expect(mockFs._files["logs/app.log"]).toBe("new-line\n");
  });

  it("reports append failures to stderr", () => {
    const mockFs = createMockFs();
    mockFs.appendFileSync.mockImplementation(() => {
      throw new Error("disk full");
    });
    const originalStderrWrite = process.stderr.write;
    const stderrOutput: string[] = [];
    let stderrWriteCount = 0;
    const replacementStderrWrite: StderrWrite = (chunk, ...args) => {
      stderrWriteCount++;
      stderrOutput.push(String(chunk));
      const callback = args.find((arg): arg is (error?: Error | null) => void => typeof arg === "function");
      callback?.();
      return true;
    };
    process.stderr.write = replacementStderrWrite;

    try {
      const logger = new FileLogger(
        { logDir: "logs", filename: "app.log" },
        { fs: mockFs as FileLoggerFs },
      );
      logger.log("entry");

      expect(stderrWriteCount).toBeGreaterThan(0);
      expect(stderrOutput.join("\n")).toContain("Failed to write");
    } finally {
      process.stderr.write = originalStderrWrite;
    }
  });
});
