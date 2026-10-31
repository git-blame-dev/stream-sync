import { vi, describe, expect, it } from 'bun:test';

import { noOpLogger } from "../../helpers/mock-factories";
import { GlobalCommandCooldownManager } from "../../../src/utils/global-command-cooldown";
import testClock from "../../helpers/test-clock";
describe("GlobalCommandCooldownManager behavior", () => {
  it("allows execution on invalid inputs and tracks checks without blocks", () => {
    const manager = new GlobalCommandCooldownManager(noOpLogger);

    const allowed = manager.isCommandOnCooldown("", 0);

    expect(allowed).toBe(false);
    expect(manager.stats.totalChecks).toBe(1);
    expect(manager.stats.totalBlocks).toBe(0);
  });

  it("blocks commands still within cooldown window and reports remaining time", () => {
    const manager = new GlobalCommandCooldownManager(noOpLogger);

    testClock.set(1000);
    manager.updateCommandTimestamp("!testhello");

    testClock.set(1500);
    const blocked = manager.isCommandOnCooldown("!testhello", 1000);

    expect(blocked).toBe(true);
    expect(manager.stats.totalBlocks).toBe(1);

    expect(manager.getRemainingCooldown("!testhello", 1000)).toBeGreaterThan(0);
  });

  it("allows commands after cooldown window has expired", () => {
    const manager = new GlobalCommandCooldownManager(noOpLogger);

    testClock.set(1000);
    manager.updateCommandTimestamp("!testhello");

    testClock.set(3000);
    const blocked = manager.isCommandOnCooldown("!testhello", 1000);

    expect(blocked).toBe(false);
  });

  it("clears expired cooldowns and reports removal count", () => {
    const manager = new GlobalCommandCooldownManager(noOpLogger);

    testClock.set(1000);
    manager.updateCommandTimestamp("!testold");

    testClock.set(11_000);
    const removed = manager.clearExpiredCooldowns(1000);

    expect(removed).toBe(1);
    expect(manager.commandTimestamps.size).toBe(0);
  });

  it("resets cooldown state and statistics without routine diagnostics", () => {
    const logger = { ...noOpLogger, debug: vi.fn<(...args: unknown[]) => unknown>() };
    const manager = new GlobalCommandCooldownManager(logger);
    testClock.set(1000);
    manager.updateCommandTimestamp("!synthetic");
    expect(manager.getStats()).toMatchObject({ totalTrackedCommands: 1, totalUpdates: 1 });
    manager.resetAllCooldowns();
    expect(manager.getStats()).toMatchObject({ totalTrackedCommands: 0, totalUpdates: 0, totalChecks: 0, totalBlocks: 0 });
    expect(manager.getRemainingCooldown("!synthetic", 1000)).toBe(0);
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it("fails open when internal errors occur", () => {
    const erroringLogger = {
      debug: vi.fn(() => {
        throw new Error("logger failure");
      }),
      info: vi.fn<(...args: unknown[]) => unknown>(),
      warn: vi.fn<(...args: unknown[]) => unknown>(),
      error: vi.fn<(...args: unknown[]) => unknown>(),
    };
    const manager = new GlobalCommandCooldownManager(erroringLogger);

    testClock.set(1000);
    manager.updateCommandTimestamp("!testboom");
    testClock.set(1100);
    const allowed = manager.isCommandOnCooldown("!testboom", 1000);

    expect(allowed).toBe(false);
    expect(erroringLogger.error).toHaveBeenCalledTimes(1);
  });
});
