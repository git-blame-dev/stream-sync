import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import {
  mockModule,
  unmockModule,
  requireActual,
  resetModules,
  restoreAllModuleMocks,
} from "./bun-module-mocks";

const nodeRequire = createRequire(import.meta.url);

type TemporaryArtifact = {
  tempDir: string;
  modulePath: string;
};

type TestClockLike = {
  now: () => number;
  advance: (ms: number) => number;
  reset: () => number;
};

const createTempModulePath = () => {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "stream-sync-module-mocks-"),
  );
  const modulePath = path.join(tempDir, "temp-module.js");
  fs.writeFileSync(
    modulePath,
    'module.exports = { value: "actual-value" };\n',
    "utf8",
  );
  return { tempDir, modulePath };
};

describe("bun-module-mocks behavior", () => {
  const temporaryArtifacts: TemporaryArtifact[] = [];

  afterEach(() => {
    restoreAllModuleMocks();

    while (temporaryArtifacts.length > 0) {
      const artifact = temporaryArtifacts.pop();
      if (!artifact) {
        continue;
      }

      fs.rmSync(artifact.tempDir, { recursive: true, force: true });
    }
  });

  it("mocks and unmocks modules by resolved id", () => {
    const artifact = createTempModulePath();
    temporaryArtifacts.push(artifact);
    const factory = () => ({ value: "mocked-value" });

    const moduleId = mockModule(artifact.modulePath, factory);
    expect(moduleId).toBe(nodeRequire.resolve(artifact.modulePath));
    expect(nodeRequire(artifact.modulePath).value).toBe("mocked-value");

expect(() => unmockModule(artifact.modulePath)).not.toThrow();
expect(nodeRequire(artifact.modulePath).value).toBe("actual-value");
expect(() => unmockModule(artifact.modulePath)).not.toThrow();
  });

  it("loads module implementation while preserving active mock registration", () => {
    const artifact = createTempModulePath();
    temporaryArtifacts.push(artifact);
    const factory = () => ({ value: "mocked-value" });

mockModule(artifact.modulePath, factory);
expect(nodeRequire(artifact.modulePath).value).toBe("mocked-value");
const module = requireActual(artifact.modulePath);

expect(module.value).toBe("actual-value");
expect(nodeRequire(artifact.modulePath).value).toBe("mocked-value");
unmockModule(artifact.modulePath);
expect(nodeRequire(artifact.modulePath).value).toBe("actual-value");
});

  it("resets only tracked module mocks without resetting helper module state", () => {
    const testClock = nodeRequire("./test-clock") as TestClockLike;
    testClock.reset();
    testClock.advance(1234);
    const expectedTime = testClock.now();

    const artifact = createTempModulePath();
    temporaryArtifacts.push(artifact);
mockModule(artifact.modulePath, () => ({ value: "mocked-value" }));
expect(nodeRequire(artifact.modulePath).value).toBe("mocked-value");

resetModules();

expect(nodeRequire(artifact.modulePath).value).toBe("actual-value");
const reloadedClock = nodeRequire("./test-clock") as TestClockLike;
expect(reloadedClock.now()).toBe(expectedTime);
    reloadedClock.reset();
  });

  it("restores tracked module mocks and allows remocking", () => {
    const artifact = createTempModulePath();
    temporaryArtifacts.push(artifact);

    mockModule(artifact.modulePath, () => ({ value: "first-mock" }));
    expect(nodeRequire(artifact.modulePath).value).toBe("first-mock");

restoreAllModuleMocks();
expect(nodeRequire(artifact.modulePath).value).toBe("actual-value");
mockModule(artifact.modulePath, () => ({ value: "second-mock" }));
    expect(nodeRequire(artifact.modulePath).value).toBe("second-mock");
  });
});
