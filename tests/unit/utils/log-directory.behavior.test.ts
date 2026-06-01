import { describe, expect, it } from "bun:test";

import {
  ensureLogDirectory,
  ensureLogDirectorySync,
} from "../../../src/utils/log-directory";
import { createMockFn } from "../../helpers/bun-mock-utils";

describe("log-directory behavior", () => {
  it("creates a missing directory synchronously with recursive options", () => {
    const existsSync = createMockFn<[string], boolean>(() => false);
    const mkdirSync = createMockFn<[string, { recursive: true }], unknown>(() => undefined);

    ensureLogDirectorySync("logs", { existsSync, mkdirSync });

    expect(mkdirSync.mock.calls).toEqual([["logs", { recursive: true }]]);
  });

  it("skips synchronous creation when the directory already exists", () => {
    const existsSync = createMockFn<[string], boolean>(() => true);
    const mkdirSync = createMockFn<[string, { recursive: true }], unknown>(() => undefined);

    ensureLogDirectorySync("logs", { existsSync, mkdirSync });

    expect(mkdirSync.mock.calls).toHaveLength(0);
  });

  it("can force synchronous creation without an existence check", () => {
    const existsSync = createMockFn<[string], boolean>(() => true);
    const mkdirSync = createMockFn<[string, { recursive: true }], unknown>(() => undefined);

    ensureLogDirectorySync("logs", { existsSync, mkdirSync, checkExists: false });

    expect(existsSync.mock.calls).toHaveLength(0);
    expect(mkdirSync.mock.calls).toEqual([["logs", { recursive: true }]]);
  });

  it("propagates synchronous creation errors", () => {
    const existsSync = createMockFn<[string], boolean>(() => false);
    const mkdirSync = createMockFn<[string, { recursive: true }], unknown>(() => {
      throw new Error("mkdir failed");
    });

    expect(() => ensureLogDirectorySync("logs", { existsSync, mkdirSync })).toThrow("mkdir failed");
  });

  it("creates a directory asynchronously with recursive options", async () => {
    const mkdir = createMockFn<[string, { recursive: true }], Promise<unknown>>(async () => undefined);

    await ensureLogDirectory("logs", { mkdir });

    expect(mkdir.mock.calls).toEqual([["logs", { recursive: true }]]);
  });

  it("propagates asynchronous creation errors", async () => {
    const mkdir = createMockFn<[string, { recursive: true }], Promise<unknown>>(async () => {
      throw new Error("async mkdir failed");
    });

    await expect(ensureLogDirectory("logs", { mkdir })).rejects.toThrow("async mkdir failed");
  });
});
