import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import syncFs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  StreamSyncAlreadyRunningError,
  acquireSingleInstanceGuard,
} from "../../../src/services/SingleInstanceGuard.ts";
import {
  advanceTimersByTime,
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
      isProcessAlive: () => true,
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
      isProcessAlive: () => true,
      registerProcessCleanup: false,
    });

    await expect(
      acquireSingleInstanceGuard({
        lockPath,
        isProcessAlive: () => true,
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

  it("protects a live stalled or suspended owner with an old heartbeat", async () => {
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

    await expect(acquireSingleInstanceGuard({
      lockPath,
      staleMs: 1000,
      isProcessAlive: () => true,
      registerProcessCleanup: false,
    })).rejects.toBeInstanceOf(StreamSyncAlreadyRunningError);
    expect(JSON.parse(await fs.readFile(path.join(lockPath, "owner.json"), "utf8")).instanceId).toBe("stale-owner");
  });

  it("allows only one concurrent acquirer", async () => {
    const lockPath = getLockPath();

    const results = await Promise.allSettled([
      acquireSingleInstanceGuard({ lockPath, isProcessAlive: () => true, registerProcessCleanup: false }),
      acquireSingleInstanceGuard({ lockPath, isProcessAlive: () => true, registerProcessCleanup: false }),
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

  it("treats a fresh owner-only lock as pending even before a PID is available", async () => {
    const lockPath = getLockPath();
    await fs.mkdir(lockPath);
    await fs.writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ instanceId: "synthetic-pending" }));
    await expect(acquireSingleInstanceGuard({
      lockPath, isProcessAlive: () => false, registerProcessCleanup: false,
    })).rejects.toBeInstanceOf(StreamSyncAlreadyRunningError);
  });

  it("allows only one concurrent acquirer when recovering a dead stale owner", async () => {
    useFakeTimers();
    setSystemTime(new Date(5000));
    const lockPath = getLockPath();
    await fs.mkdir(lockPath);
    await fs.writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ instanceId: "synthetic-dead", pid: 123456789 }));
    await fs.writeFile(path.join(lockPath, "heartbeat"), "0");
    const options = { lockPath, staleMs: 1000,
      isProcessAlive: (pid: number) => pid !== 123456789, registerProcessCleanup: false };
    const results = await Promise.allSettled([
      acquireSingleInstanceGuard(options), acquireSingleInstanceGuard(options),
    ]);
    const winners = results.filter((result) => result.status === "fulfilled");
    expect(winners).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    for (const winner of winners) await winner.value.release();
  });

  it("does not retire a replacement installed after stale observation", async () => {
    useFakeTimers();
    setSystemTime(new Date(5000));
    const lockPath = getLockPath();
    await fs.mkdir(lockPath);
    await fs.writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ instanceId: "synthetic-dead", pid: 123456789 }));
    await fs.writeFile(path.join(lockPath, "heartbeat"), "0");
    let replaced = false;
    await expect(acquireSingleInstanceGuard({
      lockPath, staleMs: 1000, registerProcessCleanup: false,
      isProcessAlive: (pid) => pid === 987654321,
      logger: { warn: () => {
        if (replaced) return;
        replaced = true;
        syncFs.renameSync(lockPath, `${lockPath}.synthetic-old`);
        syncFs.mkdirSync(lockPath);
        syncFs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ instanceId: "synthetic-replacement", pid: 987654321 }));
        syncFs.writeFileSync(path.join(lockPath, "heartbeat"), "5000");
      } },
    })).rejects.toBeInstanceOf(StreamSyncAlreadyRunningError);
    expect(JSON.parse(await fs.readFile(path.join(lockPath, "owner.json"), "utf8")).instanceId).toBe("synthetic-replacement");
  });

  it("rechecks a heartbeat renewed after stale observation", async () => {
    useFakeTimers();
    setSystemTime(new Date(5000));
    const lockPath = getLockPath();
    await fs.mkdir(lockPath);
    await fs.writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ instanceId: "synthetic-renewed", pid: 123456789 }));
    await fs.writeFile(path.join(lockPath, "heartbeat"), "0");
    await expect(acquireSingleInstanceGuard({
      lockPath, staleMs: 1000, isProcessAlive: () => false, registerProcessCleanup: false,
      logger: { warn: () => syncFs.writeFileSync(path.join(lockPath, "heartbeat"), "5000") },
    })).rejects.toBeInstanceOf(StreamSyncAlreadyRunningError);
    expect(await fs.readFile(path.join(lockPath, "heartbeat"), "utf8")).toBe("5000");
  });

  it("release preserves a replacement directory even if it copies the old owner token", async () => {
    const lockPath = getLockPath();
    const guard = await acquireSingleInstanceGuard({ lockPath, isProcessAlive: () => true, registerProcessCleanup: false });
    await fs.rename(lockPath, `${lockPath}.synthetic-old`);
    await fs.mkdir(lockPath);
    await fs.writeFile(path.join(lockPath, "owner.json"), JSON.stringify(guard.metadata));
    await guard.release();
    expect(await fs.stat(lockPath)).toBeDefined();
  });

  it("simultaneous old release and replacement acquisition preserve the new guard", async () => {
    const lockPath = getLockPath();
    const old = await acquireSingleInstanceGuard({ lockPath, isProcessAlive: () => true, registerProcessCleanup: false });
    await fs.rename(lockPath, `${lockPath}.synthetic-old`);
    const [replacement] = await Promise.all([
      acquireSingleInstanceGuard({ lockPath, isProcessAlive: () => true, registerProcessCleanup: false }),
      old.release(),
    ]);
    expect(JSON.parse(await fs.readFile(path.join(lockPath, "owner.json"), "utf8")).instanceId).toBe(replacement.metadata.instanceId);
    await replacement.release();
  });

  it("keeps heartbeat writes on the acquired file after directory replacement", async () => {
    useFakeTimers();
    setSystemTime(new Date(234));
    const lockPath = getLockPath();
    const guard = await acquireSingleInstanceGuard({
      lockPath, heartbeatMs: 1000, isProcessAlive: () => true, registerProcessCleanup: false,
    });
    try {
      await fs.rename(lockPath, `${lockPath}.synthetic-old`);
      await fs.mkdir(lockPath);
      await fs.writeFile(path.join(lockPath, "heartbeat"), "synthetic-replacement");
      const originalHeartbeat = await fs.readFile(path.join(`${lockPath}.synthetic-old`, "heartbeat"), "utf8");
      advanceTimersByTime(1000);
      // The old implementation queued an asynchronous path-based write.
      await Promise.resolve();
      expect(await fs.readFile(path.join(lockPath, "heartbeat"), "utf8")).toBe("synthetic-replacement");
      const updatedHeartbeat = await fs.readFile(path.join(`${lockPath}.synthetic-old`, "heartbeat"), "utf8");
      expect(updatedHeartbeat).toMatch(/^\d+$/);
      expect(updatedHeartbeat).not.toBe(originalHeartbeat);
    } finally {
      await guard.release();
    }
  });

  it("preserves rather than deletes a replacement encountered during release rename", async () => {
    const lockPath = getLockPath();
    const guard = await acquireSingleInstanceGuard({ lockPath, isProcessAlive: () => true, registerProcessCleanup: false });
    const rename = syncFs.renameSync;
    let movedTo = "";
    syncFs.renameSync = ((from, to) => {
      if (from === lockPath) {
        rename(lockPath, `${lockPath}.synthetic-old`);
        syncFs.mkdirSync(lockPath);
        syncFs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ instanceId: "synthetic-racing-replacement" }));
        movedTo = String(to);
      }
      rename(from, to);
    }) as typeof syncFs.renameSync;
    try {
      await expect(guard.release()).rejects.toThrow("preserved for recovery");
      expect(JSON.parse(await fs.readFile(path.join(movedTo, "owner.json"), "utf8")).instanceId).toBe("synthetic-racing-replacement");
    } finally {
      syncFs.renameSync = rename;
      await guard.release();
    }
  });
});
