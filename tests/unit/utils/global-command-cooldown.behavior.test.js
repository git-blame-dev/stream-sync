const { describe, expect, beforeEach, it } = require('bun:test');
const { createMockFn, spyOn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { GlobalCommandCooldownManager } = require('../../../src/utils/global-command-cooldown');

describe('GlobalCommandCooldownManager behavior', () => {
    let mockLogger;

    beforeEach(() => {
        mockLogger = noOpLogger;
    });

    it('allows execution on invalid inputs and tracks checks without blocks', () => {
        const manager = new GlobalCommandCooldownManager(mockLogger);

        const allowed = manager.isCommandOnCooldown('', 0);

        expect(allowed).toBe(false);
        expect(manager.stats.totalChecks).toBe(1);
        expect(manager.stats.totalBlocks).toBe(0);
    });

    it('blocks commands still within cooldown window and reports remaining time', () => {
        const manager = new GlobalCommandCooldownManager(mockLogger);
        const nowSpy = spyOn(Date, 'now');

        nowSpy.mockReturnValueOnce(1000);
        manager.updateCommandTimestamp('!testhello');

        nowSpy.mockReturnValueOnce(1500);
        const blocked = manager.isCommandOnCooldown('!testhello', 1000);

        expect(blocked).toBe(true);
        expect(manager.stats.totalBlocks).toBe(1);

        nowSpy.mockReturnValueOnce(1500);
        expect(manager.getRemainingCooldown('!testhello', 1000)).toBeGreaterThan(0);
        nowSpy.mockRestore();
    });

    it('allows commands after cooldown window has expired', () => {
        const manager = new GlobalCommandCooldownManager(mockLogger);
        const nowSpy = spyOn(Date, 'now');

        nowSpy.mockReturnValueOnce(1000);
        manager.updateCommandTimestamp('!testhello');

        nowSpy.mockReturnValueOnce(3000);
        const blocked = manager.isCommandOnCooldown('!testhello', 1000);

        expect(blocked).toBe(false);
        nowSpy.mockRestore();
    });

    it('clears expired cooldowns and reports removal count', () => {
        const manager = new GlobalCommandCooldownManager(mockLogger);
        const nowSpy = spyOn(Date, 'now');

        nowSpy.mockReturnValue(0);
        manager.updateCommandTimestamp('!testold');

        nowSpy.mockReturnValue(10_000);
        const removed = manager.clearExpiredCooldowns(1000);

        expect(removed).toBe(1);
        expect(manager.commandTimestamps.size).toBe(0);
        nowSpy.mockRestore();
    });

    it('fails open when internal errors occur', () => {
        const erroringLogger = {
            debug: createMockFn(() => { throw new Error('logger failure'); }),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
        const manager = new GlobalCommandCooldownManager(erroringLogger);

        const allowed = manager.isCommandOnCooldown('!testboom', 1000);

        expect(allowed).toBe(false);
    });
});
