
const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { spyOn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { 
  initializeTestLogging,
  createTestUser, 
  TEST_TIMEOUTS 
} = require('../helpers/test-setup');

const {
  noOpLogger
} = require('../helpers/mock-factories');

const { 
  setupAutomatedCleanup 
} = require('../helpers/mock-lifecycle');
const testClock = require('../helpers/test-clock');

initializeTestLogging();

setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true
});

describe('GlobalCommandCooldownManager', () => {
  let cooldownManager;
  let mockLogger;

  beforeEach(() => {
    mockLogger = noOpLogger;
    spyOn(Date, 'now').mockImplementation(() => testClock.now());

    delete require.cache[require.resolve('../../src/utils/global-command-cooldown')];
    const { GlobalCommandCooldownManager } = require('../../src/utils/global-command-cooldown');
    cooldownManager = new GlobalCommandCooldownManager(mockLogger);
  });

  afterEach(() => {
        restoreAllMocks();
  });

  describe('when checking cooldown for new command', () => {
    it('should allow command execution on first use', () => {
      const result = cooldownManager.isCommandOnCooldown('!hello', 5000);

      expect(result).toBe(false);
    });
  });

  describe('when command has been executed recently', () => {
    beforeEach(() => {
      cooldownManager.updateCommandTimestamp('!hello');
    });

    it('should block command within cooldown period', () => {
      const result = cooldownManager.isCommandOnCooldown('!hello', 5000);
      
      expect(result).toBe(true);
    });

    it('should allow command after cooldown expires', () => {
      testClock.advance(6000);

      const result = cooldownManager.isCommandOnCooldown('!hello', 5000);

      expect(result).toBe(false);
    });
  });

  describe('when handling different commands', () => {
    beforeEach(() => {
      cooldownManager.updateCommandTimestamp('!hello');
    });

    it('should not affect different commands', () => {
      const result = cooldownManager.isCommandOnCooldown('!why', 5000);
      
      expect(result).toBe(false);
    });

    it('should track each command independently', () => {
      cooldownManager.updateCommandTimestamp('!why');
      
      const helloResult = cooldownManager.isCommandOnCooldown('!hello', 5000);
      const whyResult = cooldownManager.isCommandOnCooldown('!why', 5000);
      
      expect(helloResult).toBe(true);
      expect(whyResult).toBe(true);
    });
  });

  describe('when updating command timestamps', () => {
    it('should record current timestamp for command', () => {
      cooldownManager.updateCommandTimestamp('!hello');
      testClock.advance(1);

      const result = cooldownManager.isCommandOnCooldown('!hello', 1000);
      expect(result).toBe(true);
    });

    it('should handle multiple timestamp updates', () => {
      cooldownManager.updateCommandTimestamp('!hello');
      cooldownManager.updateCommandTimestamp('!hello');
      
      const result = cooldownManager.isCommandOnCooldown('!hello', 5000);
      expect(result).toBe(true);
    });
  });

  describe('when handling edge cases', () => {
    describe('and command name is invalid', () => {
      it('should allow execution for null command', () => {
        const result = cooldownManager.isCommandOnCooldown(null, 5000);
        expect(result).toBe(false);
      });

      it('should allow execution for undefined command', () => {
        const result = cooldownManager.isCommandOnCooldown(undefined, 5000);
        expect(result).toBe(false);
      });

      it('should allow execution for empty string command', () => {
        const result = cooldownManager.isCommandOnCooldown('', 5000);
        expect(result).toBe(false);
      });
    });

    describe('and cooldown period is invalid', () => {
      beforeEach(() => {
        cooldownManager.updateCommandTimestamp('!hello');
      });

      it('should allow execution for zero cooldown', () => {
        const result = cooldownManager.isCommandOnCooldown('!hello', 0);
        expect(result).toBe(false);
      });

      it('should allow execution for negative cooldown', () => {
        const result = cooldownManager.isCommandOnCooldown('!hello', -1000);
        expect(result).toBe(false);
      });
    });

    describe('and handling command name variations', () => {
      beforeEach(() => {
        cooldownManager.updateCommandTimestamp('!hello');
      });

      it('should treat case-sensitive commands as different', () => {
        const lowerResult = cooldownManager.isCommandOnCooldown('!hello', 5000);
        const upperResult = cooldownManager.isCommandOnCooldown('!HELLO', 5000);
        
        expect(lowerResult).toBe(true);
        expect(upperResult).toBe(false);
      });

      it('should handle commands with spaces', () => {
        cooldownManager.updateCommandTimestamp('!hello world');
        
        const result = cooldownManager.isCommandOnCooldown('!hello world', 5000);
        expect(result).toBe(true);
      });

      it('should handle commands with special characters', () => {
        cooldownManager.updateCommandTimestamp('!@#$%');
        
        const result = cooldownManager.isCommandOnCooldown('!@#$%', 5000);
        expect(result).toBe(true);
      });
    });
  });

  describe('when getting cooldown statistics', () => {
    beforeEach(() => {
      cooldownManager.updateCommandTimestamp('!hello');
      cooldownManager.updateCommandTimestamp('!why');
    });

    it('should return total tracked commands', () => {
      const stats = cooldownManager.getStats();
      
      expect(stats.totalTrackedCommands).toBe(2);
    });

    it('should return commands currently on cooldown', () => {
      const stats = cooldownManager.getStats();
      
      expect(stats.commandsOnCooldown).toBe(2);
    });

    it('should return oldest command timestamp', () => {
      const stats = cooldownManager.getStats();
      
      expect(stats.oldestCommandTimestamp).toBeGreaterThan(0);
      expect(typeof stats.oldestCommandTimestamp).toBe('number');
    });
  });

  describe('when clearing expired cooldowns', () => {
    beforeEach(() => {
      cooldownManager.updateCommandTimestamp('!hello');
      cooldownManager.updateCommandTimestamp('!why');
    });

    it('should remove expired cooldowns', () => {
      testClock.advance(10000);

      const removedCount = cooldownManager.clearExpiredCooldowns(5000);

      expect(removedCount).toBe(2);
    });

    it('should keep active cooldowns', () => {
      const removedCount = cooldownManager.clearExpiredCooldowns(10000);

      expect(removedCount).toBe(0);

      const stats = cooldownManager.getStats();
      expect(stats.totalTrackedCommands).toBe(2);
    });
  });
}, TEST_TIMEOUTS.FAST);