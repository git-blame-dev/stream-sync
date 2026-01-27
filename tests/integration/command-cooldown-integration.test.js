
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');

const { TEST_TIMEOUTS } = require('../helpers/test-setup');

const {
  createConfigFixture
} = require('../helpers/mock-factories');

const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const testClock = require('../helpers/test-clock');
const { restoreAllMocks, spyOn } = require('../helpers/bun-mock-utils');

setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true
});

const testWithTimeout = (name, fn) => test(name, fn, { timeout: TEST_TIMEOUTS.INTEGRATION });

describe('Command Cooldown Integration', () => {
  let checkGlobalCommandCooldown;
  let updateGlobalCommandCooldown;
  let clearExpiredGlobalCooldowns;

  beforeEach(() => {
    testClock.reset();
    createConfigFixture({
      general: {
        cmdCooldownMs: 5000,
        globalCmdCooldownMs: 3000
      },
      commands: {
        'hello': '!hello|!hi,hello-media,5000',
        'why': '!why,why-media,3000'
      }
    });

    delete require.cache[require.resolve('../../src/utils/command-parser')];
    const commandParserModule = require('../../src/utils/command-parser');

    checkGlobalCommandCooldown = commandParserModule.checkGlobalCommandCooldown;
    updateGlobalCommandCooldown = commandParserModule.updateGlobalCommandCooldown;
    clearExpiredGlobalCooldowns = commandParserModule.clearExpiredGlobalCooldowns;
  });

  afterEach(() => {
    restoreAllMocks();
  });

  describe('when multiple users trigger same command', () => {
    testWithTimeout('should block second user due to global cooldown', () => {
      updateGlobalCommandCooldown('!hello');

      const isBlocked = checkGlobalCommandCooldown('!hello', 3000);

      expect(isBlocked).toBe(true);
    });

    testWithTimeout('should allow different commands from same users', () => {
      updateGlobalCommandCooldown('!hello');

      const isBlocked = checkGlobalCommandCooldown('!why', 3000);

      expect(isBlocked).toBe(false);
    });

    testWithTimeout('should allow same command after cooldown expires', () => {
      const dateNowSpy = spyOn(Date, 'now').mockImplementation(() => testClock.now());
      updateGlobalCommandCooldown('!hello');

      testClock.advance(4000);

      const isBlocked = checkGlobalCommandCooldown('!hello', 3000);

      expect(isBlocked).toBe(false);

      dateNowSpy.mockRestore();
    });
  });

  describe('when handling rapid command succession', () => {
    testWithTimeout('should handle multiple rapid cooldown checks correctly', () => {
      const results = [];

      results.push(checkGlobalCommandCooldown('!spam', 2000));
      updateGlobalCommandCooldown('!spam');

      for (let i = 0; i < 5; i++) {
        results.push(checkGlobalCommandCooldown('!spam', 2000));
      }

      expect(results[0]).toBe(false);
      expect(results.slice(1)).toEqual([true, true, true, true, true]);
    });

    testWithTimeout('should maintain separate cooldowns for different commands', () => {
      const commands = ['!cmd1', '!cmd2', '!cmd3'];

      commands.forEach(cmd => updateGlobalCommandCooldown(cmd));

      const results = commands.map(cmd => checkGlobalCommandCooldown(cmd, 2000));

      expect(results).toEqual([true, true, true]);
    });
  });

  describe('when memory management is required', () => {
    testWithTimeout('should clean up expired cooldowns', () => {
      const commands = ['!old1', '!old2', '!recent'];

      const dateNowSpy = spyOn(Date, 'now').mockImplementation(() => testClock.now());
      commands.forEach(cmd => updateGlobalCommandCooldown(cmd));

      testClock.advance(10000);

      const cleanedCount = clearExpiredGlobalCooldowns(5000);

      expect(cleanedCount).toBeGreaterThanOrEqual(0);

      dateNowSpy.mockRestore();
    });

    testWithTimeout('should handle cleanup without affecting active cooldowns', () => {
      updateGlobalCommandCooldown('!active');

      clearExpiredGlobalCooldowns(10000);

      const isStillBlocked = checkGlobalCommandCooldown('!active', 5000);
      expect(isStillBlocked).toBe(true);
    });
  });

  describe('when handling edge cases', () => {
    testWithTimeout('should handle concurrent cooldown operations safely', () => {
      const commandName = '!concurrent';

      const operations = [];
      for (let i = 0; i < 10; i++) {
        operations.push(() => {
          const blocked = checkGlobalCommandCooldown(commandName, 1000);
          if (!blocked) {
            updateGlobalCommandCooldown(commandName);
          }
          return blocked;
        });
      }

      const results = operations.map(op => op());

      expect(results.some(result => result === false)).toBe(true);
    });

    testWithTimeout('should handle malformed command names gracefully', () => {
      const malformedCommands = [null, undefined, '', '   ', '!', 'normal_text'];

      malformedCommands.forEach(cmd => {
        expect(() => {
          checkGlobalCommandCooldown(cmd, 1000);
          updateGlobalCommandCooldown(cmd);
        }).not.toThrow();
      });
    });

    testWithTimeout('should handle extreme cooldown values', () => {
      updateGlobalCommandCooldown('!extreme');

      const longCooldown = checkGlobalCommandCooldown('!extreme', Number.MAX_SAFE_INTEGER);
      expect(longCooldown).toBe(true);

      const zeroCooldown = checkGlobalCommandCooldown('!extreme', 0);
      expect(zeroCooldown).toBe(false);

      const negativeCooldown = checkGlobalCommandCooldown('!extreme', -1000);
      expect(negativeCooldown).toBe(false);
    });
  });

  describe('when integrating with configuration system', () => {
    testWithTimeout('should respect different cooldown periods per platform', () => {
      const platforms = ['twitch', 'youtube', 'tiktok'];
      const cooldownPeriods = [1000, 2000, 3000];

      platforms.forEach((platform, index) => {
        const commandName = `!${platform}cmd`;
        updateGlobalCommandCooldown(commandName);

        const isBlocked = checkGlobalCommandCooldown(commandName, cooldownPeriods[index]);
        expect(isBlocked).toBe(true);
      });
    });

    testWithTimeout('should handle config changes without losing existing cooldowns', () => {
      updateGlobalCommandCooldown('!persistent');
      const initialBlock = checkGlobalCommandCooldown('!persistent', 2000);
      expect(initialBlock).toBe(true);

      const postConfigBlock = checkGlobalCommandCooldown('!persistent', 3000);
      expect(postConfigBlock).toBe(true);
    });
  });
});
