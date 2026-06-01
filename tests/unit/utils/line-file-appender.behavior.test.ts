import { describe, expect, it, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../../helpers/bun-mock-utils";
import { LineFileAppender } from "../../../src/utils/line-file-appender";
import { type TestMockFn } from "../../helpers/bun-mock-utils";
type FileStore = Record<string, string>;
type LineFileAppenderDependencies = NonNullable<ConstructorParameters<typeof LineFileAppender>[1]>;
type LineFileAppenderFs = NonNullable<LineFileAppenderDependencies["fs"]>;
type StderrWrite = typeof process.stderr.write;
type MockLineFileAppenderFs = LineFileAppenderDependencies extends { fs?: infer Fs }
  ? Omit<Fs, "appendFileSync" | "existsSync" | "mkdirSync"> & {
      _files: FileStore;
      _dirs: Set<string>;
      existsSync: TestMockFn<[string], boolean>;
      mkdirSync: TestMockFn<[string, { recursive: true }], unknown>;
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
    mkdirSync: createMockFn<[string, { recursive: true }], unknown>((dir: string) => {
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
  } as MockLineFileAppenderFs;
}

describe("line-file-appender behavior", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  it("requires a log directory for construction", () => {
    expect(() => new LineFileAppender()).toThrow("logDir is required for LineFileAppender");
  });

  it("creates the configured log directory on construction", () => {
    const mockFs = createMockFs();

    new LineFileAppender({ logDir: "logs-test" }, { fs: mockFs as LineFileAppenderFs });

    expect(mockFs._dirs.has("logs-test")).toBe(true);
    expect(mockFs.mkdirSync.mock.calls[0]).toEqual(["logs-test", { recursive: true }]);
  });

  it("writes log content to the configured file", () => {
    const mockFs = createMockFs();

    const appender = new LineFileAppender(
      { logDir: "logs", filename: "app.log" },
      { fs: mockFs as LineFileAppenderFs },
    );

    appender.log("new-line");

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
      const appender = new LineFileAppender(
        { logDir: "logs", filename: "app.log" },
        { fs: mockFs as LineFileAppenderFs },
      );
      appender.log("entry");

      expect(stderrWriteCount).toBeGreaterThan(0);
      expect(stderrOutput.join("\n")).toContain("[LineFileAppender] Failed to write");
    } finally {
      process.stderr.write = originalStderrWrite;
    }
  });

  it("reports directory creation failures to stderr", () => {
    const mockFs = createMockFs();
    mockFs.mkdirSync.mockImplementation(() => {
      throw new Error("mkdir failed");
    });
    const originalStderrWrite = process.stderr.write;
    const stderrOutput: string[] = [];
    const replacementStderrWrite: StderrWrite = (chunk, ...args) => {
      stderrOutput.push(String(chunk));
      const callback = args.find((arg): arg is (error?: Error | null) => void => typeof arg === "function");
      callback?.();
      return true;
    };
    process.stderr.write = replacementStderrWrite;

    try {
      expect(() => new LineFileAppender({ logDir: "logs" }, { fs: mockFs as LineFileAppenderFs })).not.toThrow();
      expect(stderrOutput.join("\n")).toContain("[LineFileAppender] Failed to create log directory: mkdir failed");
    } finally {
      process.stderr.write = originalStderrWrite;
    }
  });
});
