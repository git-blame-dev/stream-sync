import { describe, it, expect } from "bun:test";
import { ConnectionStateManager } from "../../../src/utils/connection-state-manager.ts";
import { noOpLogger } from "../../helpers/mock-factories";
const createManager = (disconnectFn = () => {}) => {
  const mockConnection = {
    on: () => {},
    emit: () => {},
    removeAllListeners: () => {},
    connect: () => {},
    disconnect: disconnectFn,
  };
  const connectionFactory = {
    createConnection: () => ({ ...mockConnection }),
  };
  const manager = new ConnectionStateManager("tiktok", connectionFactory);
  manager.initialize({}, { logger: noOpLogger });
  manager.ensureConnection();
  return manager;
};

const observeCleanupReport = (manager: ConnectionStateManager) => new Promise<void>((resolve) => {
  manager.initialize({}, { logger: { ...noOpLogger, error: (message: string) => {
    if (message !== "Connection cleanup failed (disconnect)") return;
    resolve();
    throw new Error("synthetic reporter failure after observation");
  } } });
});

describe("ConnectionStateManager", () => {
  describe("cleanup", () => {
    it("keeps listener-removal stage and sanitized bounded cause in real logger records", () => {
      const records: unknown[][] = [];
      const manager = createManager();
      manager.initialize({}, { logger: { ...noOpLogger, error: (...args: unknown[]) => { records.push(args); } } });
      manager.getConnection()!.removeAllListeners = () => {
        throw new Error(`Authorization: Bearer ${"synthetic-cleanup-secret".repeat(300)}; synthetic-safe-listener-cause ${"x".repeat(5000)}`);
      };
      manager.cleanup();
      const serialized = JSON.stringify(records);
      expect(records).toHaveLength(1);
      expect(serialized).toContain("listener-removal");
      expect(serialized).toContain("synthetic-safe-listener-cause");
      expect(serialized).not.toContain("synthetic-cleanup-secret");
      const metadata = records[0]![2] as { payloadSummary: { error: string } };
      expect(typeof metadata.payloadSummary.error).toBe("string");
      expect(metadata.payloadSummary.error.length).toBeLessThanOrEqual(4096);
      expect(metadata.payloadSummary.error).toContain("Authorization: Bearer [REDACTED]; synthetic-safe-listener-cause");
      expect(records[0]).toEqual([
        "Connection cleanup failed (listener-removal)", "connection-state-manager",
        { payloadSummary: { error: metadata.payloadSummary.error } },
      ]);
    });

    it("records a late disconnect stage and safe cause without changing connected B", async () => {
      let rejectOld: (reason: unknown) => void = () => { throw new Error("Missing synthetic reject"); };
      const pending = new Promise<void>((_resolve, reject) => { rejectOld = reject; });
      const manager = createManager(() => pending);
      const records: unknown[][] = [];
      const reported = new Promise<void>((resolve) => {
        manager.initialize({}, { logger: { ...noOpLogger, error: (...args: unknown[]) => { records.push(args); resolve(); } } });
      });
      manager.cleanup();
      manager.ensureConnection();
      manager.markConnected();
      const connectionB = manager.getConnection();
      rejectOld(new Error(`Authorization: Bearer ${"synthetic-cleanup-secret".repeat(300)}; synthetic-safe-disconnect-cause ${"x".repeat(5000)}`));
      await reported;
      const serialized = JSON.stringify(records);
      expect(records).toHaveLength(1);
      expect(serialized).toContain("disconnect");
      expect(serialized).toContain("synthetic-safe-disconnect-cause");
      expect(serialized).not.toContain("synthetic-cleanup-secret");
      const metadata = records[0]![2] as { payloadSummary: { error: string } };
      expect(typeof metadata.payloadSummary.error).toBe("string");
      expect(metadata.payloadSummary.error.length).toBeLessThanOrEqual(4096);
      expect(metadata.payloadSummary.error).toContain("Authorization: Bearer [REDACTED]; synthetic-safe-disconnect-cause");
      expect(records[0]).toEqual([
        "Connection cleanup failed (disconnect)", "connection-state-manager",
        { payloadSummary: { error: metadata.payloadSummary.error } },
      ]);
      expect(manager.getConnection()).toBe(connectionB);
      expect(manager.getState()).toBe("connected");
      expect(manager.getConnectionInfo().lastError).toBeNull();
    });

    it("retires state first and attempts disconnect despite removal and reporter failures", () => {
      const failure = new Error("synthetic listener removal failed");
      const manager = createManager();
      const connection = manager.getConnection()!;
      let disconnected = false;
      let reports = 0;
      connection.removeAllListeners = () => {
        expect(manager.getConnection()).toBeNull();
        expect(manager.getState()).toBe("disconnected");
        throw failure;
      };
      connection.disconnect = () => { disconnected = true; throw new Error("synthetic second cleanup failure"); };
      manager.initialize({}, { logger: { ...noOpLogger, error: () => { reports++; throw new Error("synthetic reporter failure"); }, debug: () => { throw new Error("synthetic debug failure"); } } });
      expect(() => manager.cleanup()).not.toThrow();
      expect(disconnected).toBe(true);
      expect(reports).toBe(1);
      expect(manager.lastError).toBe(failure);
      expect(manager.getConnectionInfo().lastError).toBe("synthetic listener removal failed");
    });

    it("observes async disconnect rejection and exposes a bounded sanitized summary", async () => {
      const failure = new Error(`Authorization: Bearer synthetic-cleanup-secret ${"x".repeat(5000)}`);
      const manager = createManager(() => Promise.reject(failure));
      const reported = observeCleanupReport(manager);
      expect(manager.cleanup()).toBeUndefined();
      await reported;
      expect(manager.lastError).toBe(failure);
      const info = manager.getConnectionInfo();
      expect(info.state).toBe("disconnected");
      expect(info.lastError).not.toContain("synthetic-cleanup-secret");
      expect(info.lastError!.length).toBeLessThanOrEqual(4096);
    });

    it("observes a disconnect then-getter failure without throwing from cleanup", async () => {
      const failure = new Error("synthetic then getter failure");
      const manager = createManager(() => ({ get then() { throw failure; } }) as unknown as Promise<void>);
      const reported = observeCleanupReport(manager);
      expect(manager.cleanup()).toBeUndefined();
      await reported;
      expect(manager.getConnectionInfo().lastError).toBe(failure.message);
    });

    it("does not let late retired-A failure overwrite connected B or B's later retirement", async () => {
      let rejectOld: (reason: unknown) => void = () => { throw new Error("Missing synthetic reject"); };
      const pending = new Promise<void>((_resolve, reject) => { rejectOld = reject; });
      const manager = createManager(() => pending);
      const reported = observeCleanupReport(manager);
      const connectionA = manager.getConnection();
      manager.cleanup();
      manager.ensureConnection();
      manager.markConnected();
      const connectionB = manager.getConnection();
      expect(connectionB).not.toBe(connectionA);
      rejectOld(new Error("synthetic old failure"));
      await reported;
      expect(manager.getConnection()).toBe(connectionB);
      expect(manager.getState()).toBe("connected");
      expect(manager.getConnectionInfo().lastError).toBeNull();

      connectionB!.disconnect = () => {};
      manager.cleanup();
      expect(manager.getConnectionInfo().lastError).toBeNull();
    });

    it("does not publish old-A errors after B has already been adopted and cleaned up", async () => {
      let rejectOld: (reason: unknown) => void = () => { throw new Error("Missing synthetic reject"); };
      const pending = new Promise<void>((_resolve, reject) => { rejectOld = reject; });
      const manager = createManager(() => pending);
      const reported = observeCleanupReport(manager);
      manager.cleanup();
      manager.ensureConnection();
      manager.getConnection()!.disconnect = () => {};
      manager.markConnected();
      manager.cleanup();
      rejectOld(new Error("synthetic old failure"));
      await reported;
      expect(manager.getConnectionInfo().lastError).toBeNull();
      expect(manager.getState()).toBe("disconnected");
    });

    it("does not replace a new creation failure with a late retired disconnect failure", async () => {
      let rejectOld: (reason: unknown) => void = () => { throw new Error("Missing synthetic reject"); };
      const pending = new Promise<void>((_resolve, reject) => { rejectOld = reject; });
      const manager = createManager(() => pending);
      const reported = new Promise<void>((resolve) => {
        manager.initialize({}, { logger: { ...noOpLogger, error: (message: string) => {
          if (message === "Connection cleanup failed (disconnect)") resolve();
        } } });
      });
      manager.cleanup();
      const creationFailure = new Error("synthetic new creation failure");
      manager.connectionFactory.createConnection = () => { throw creationFailure; };
      expect(() => manager.ensureConnection()).toThrow(creationFailure);
      rejectOld(new Error("synthetic old disconnect failure"));
      await reported;
      expect(manager.getState()).toBe("error");
      expect(manager.lastError).toBe(creationFailure);
    });

    it("handles disconnect methods that return undefined", () => {
      const manager = createManager(() => undefined);

      expect(() => manager.cleanup()).not.toThrow();
      expect(manager.getState()).toBe("disconnected");
    });

    it("handles disconnect methods that return Promises", () => {
      const manager = createManager(() => Promise.resolve());

      expect(() => manager.cleanup()).not.toThrow();
      expect(manager.getState()).toBe("disconnected");
    });

    it("handles disconnect methods that return rejected Promises gracefully", () => {
      const manager = createManager(() =>
        Promise.reject(new Error("test-disconnect-error")),
      );

      expect(() => manager.cleanup()).not.toThrow();
      expect(manager.getState()).toBe("disconnected");
    });

    it("resets connection state after cleanup", () => {
      const manager = createManager();
      manager.markConnected();

      manager.cleanup();

      const info = manager.getConnectionInfo();
      expect(info.state).toBe("disconnected");
      expect(info.hasConnection).toBe(false);
      expect(info.connectionTime).toBe(0);
      expect(info.lastError).toBeNull();
    });
  });
});
