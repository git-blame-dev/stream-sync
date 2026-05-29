import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  StreamSyncAlreadyRunningError,
  acquireSingleInstanceGuard,
} from "../../../src/services/SingleInstanceGuard.ts";
import {
  setSystemTime,
  useFakeTimers,
  useRealTimers,
} from "../../helpers/bun-timers.ts";

describe("SingleInstanceGuard", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stream-sync-guard-test-"));
  });

  afterEach(async () => {
    useRealTimers();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  const getLockPath = () => path.join(tempDir, "stream-sync.lock");

  it("acquires and releases a lock directory", async () => {
    const lockPath = getLockPath();
    const guard = await acquireSingleInstanceGuard({
      lockPath,
      registerProcessCleanup: false,
    });

    expect(guard.lockPath).toBe(lockPath);
    expect(guard.metadata.pid).toBe(process.pid);
    expect(await fs.stat(lockPath)).toBeDefined();

    await guard.release();
    await guard.release();

    await expect(fs.stat(lockPath)).rejects.toThrow();
  });

  it("rejects acquisition while an existing lock is active", async () => {
    const lockPath = getLockPath();
    const guard = await acquireSingleInstanceGuard({
      lockPath,
      registerProcessCleanup: false,
    });

    await expect(
      acquireSingleInstanceGuard({
        lockPath,
        registerProcessCleanup: false,
      }),
    ).rejects.toBeInstanceOf(StreamSyncAlreadyRunningError);

    await guard.release();
  });

  it("treats a fresh metadata-less lock as active", async () => {
    const lockPath = getLockPath();
    await fs.mkdir(lockPath);

    await expect(
      acquireSingleInstanceGuard({
        lockPath,
        staleMs: 60_000,
        isProcessAlive: () => false,
        registerProcessCleanup: false,
      }),
    ).rejects.toBeInstanceOf(StreamSyncAlreadyRunningError);
  });

  it("removes stale locks before acquiring", async () => {
    useFakeTimers();
    setSystemTime(new Date(5000));

    const lockPath = getLockPath();
    await fs.mkdir(lockPath);
    await fs.writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ instanceId: "stale-owner", pid: 999999999 }),
      "utf8",
    );
    await fs.writeFile(path.join(lockPath, "heartbeat"), "0", "utf8");

    const guard = await acquireSingleInstanceGuard({
      lockPath,
      staleMs: 1000,
      isProcessAlive: () => false,
      registerProcessCleanup: false,
    });

    expect(guard.metadata.pid).toBe(process.pid);
    await guard.release();
  });

  it("removes stale heartbeat locks even when the recorded pid is alive", async () => {
    useFakeTimers();
    setSystemTime(new Date(5000));

    const lockPath = getLockPath();
    await fs.mkdir(lockPath);
    await fs.writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ instanceId: "stale-owner", pid: process.pid }),
      "utf8",
    );
    await fs.writeFile(path.join(lockPath, "heartbeat"), "0", "utf8");

    const guard = await acquireSingleInstanceGuard({
      lockPath,
      staleMs: 1000,
      isProcessAlive: () => true,
      registerProcessCleanup: false,
    });

    expect(guard.metadata.pid).toBe(process.pid);
    await guard.release();
  });

  it("allows only one concurrent acquirer", async () => {
    const lockPath = getLockPath();

    const results = await Promise.allSettled([
      acquireSingleInstanceGuard({ lockPath, registerProcessCleanup: false }),
      acquireSingleInstanceGuard({ lockPath, registerProcessCleanup: false }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0] === undefined || fulfilled[0] === undefined) {
      throw new Error("Expected one fulfilled and one rejected acquisition");
    }
    expect(rejected[0].reason).toBeInstanceOf(StreamSyncAlreadyRunningError);

    await fulfilled[0].value.release();
  });
});
