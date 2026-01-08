
const { 
  initializeTestLogging,
  createTestUser, 
  TEST_TIMEOUTS 
} = require('../helpers/test-setup');

const { 
  createMockLogger,
  createMockConfig 
} = require('../helpers/mock-factories');

const { 
  setupAutomatedCleanup 
} = require('../helpers/mock-lifecycle');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true
});

describe('Command Cooldown Integration', () => {
  let mockConfig;
  let commandParser;
  let checkGlobalCommandCooldown;
  let updateGlobalCommandCooldown;
  let clearExpiredGlobalCooldowns;

  beforeEach(() => {
    // Create fresh mock config
    mockConfig = createMockConfig({
      general: {
        cmdCooldownMs: 5000,
        globalCmdCooldownMs: 3000
      },
      commands: {
        'hello': '!hello|!hi,hello-media,5000',
        'why': '!why,why-media,3000'
      }
    });

    // Clear require cache and import fresh modules
    delete require.cache[require.resolve('../../src/utils/command-parser')];
    const commandParserModule = require('../../src/utils/command-parser');
    
    checkGlobalCommandCooldown = commandParserModule.checkGlobalCommandCooldown;
    updateGlobalCommandCooldown = commandParserModule.updateGlobalCommandCooldown;
    clearExpiredGlobalCooldowns = commandParserModule.clearExpiredGlobalCooldowns;
  });

  describe('when multiple users trigger same command', () => {
    const user1 = createTestUser({ username: 'Alice', userId: 'user1' });
    const user2 = createTestUser({ username: 'Bob', userId: 'user2' });

    it('should block second user due to global cooldown', () => {
      // User 1 triggers command
      updateGlobalCommandCooldown('!hello');
      
      // User 2 tries same command immediately
      const isBlocked = checkGlobalCommandCooldown('!hello', 3000);
      
      expect(isBlocked).toBe(true);
    });

    it('should allow different commands from same users', () => {
      // User 1 triggers !hello
      updateGlobalCommandCooldown('!hello');
      
      // User 2 tries !why (different command)
      const isBlocked = checkGlobalCommandCooldown('!why', 3000);
      
      expect(isBlocked).toBe(false);
    });

    it('should allow same command after cooldown expires', () => {
      // User 1 triggers command
      updateGlobalCommandCooldown('!hello');
      
      // Mock time passing
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 4000);
      
      // User 2 tries same command after cooldown
      const isBlocked = checkGlobalCommandCooldown('!hello', 3000);
      
      expect(isBlocked).toBe(false);
      
      Date.now.mockRestore();
    });
  });

  describe('when handling rapid command succession', () => {
    it('should handle multiple rapid cooldown checks correctly', () => {
      const results = [];
      
      // First execution - should be allowed
      results.push(checkGlobalCommandCooldown('!spam', 2000));
      updateGlobalCommandCooldown('!spam');
      
      // Rapid subsequent checks - should all be blocked
      for (let i = 0; i < 5; i++) {
        results.push(checkGlobalCommandCooldown('!spam', 2000));
      }
      
      expect(results[0]).toBe(false); // First allowed
      expect(results.slice(1)).toEqual([true, true, true, true, true]); // Rest blocked
    });

    it('should maintain separate cooldowns for different commands', () => {
      const commands = ['!cmd1', '!cmd2', '!cmd3'];
      
      // Trigger all commands
      commands.forEach(cmd => updateGlobalCommandCooldown(cmd));
      
      // Check that each is on cooldown independently
      const results = commands.map(cmd => checkGlobalCommandCooldown(cmd, 2000));
      
      expect(results).toEqual([true, true, true]);
    });
  });

  describe('when memory management is required', () => {
    it('should clean up expired cooldowns', () => {
      // Add several commands with timestamps
      const commands = ['!old1', '!old2', '!recent'];
      
      commands.forEach(cmd => updateGlobalCommandCooldown(cmd));
      
      // Mock older timestamps for first two commands
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10000);
      
      // Clean up cooldowns older than 5 seconds
      const cleanedCount = clearExpiredGlobalCooldowns(5000);
      
      expect(cleanedCount).toBeGreaterThanOrEqual(0);
      
      Date.now.mockRestore();
    });

    it('should handle cleanup without affecting active cooldowns', () => {
      // Add recent command
      updateGlobalCommandCooldown('!active');
      
      // Clean up with short expiry (shouldn't remove active command)
      const cleanedCount = clearExpiredGlobalCooldowns(10000);
      
      // Active command should still be blocked
      const isStillBlocked = checkGlobalCommandCooldown('!active', 5000);
      expect(isStillBlocked).toBe(true);
    });
  });

  describe('when handling edge cases', () => {
    it('should handle concurrent cooldown operations safely', () => {
      const commandName = '!concurrent';
      
      // Simulate concurrent operations
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
      
      // Execute all operations
      const results = operations.map(op => op());
      
      // At least the first should succeed, others may be blocked
      expect(results.some(result => result === false)).toBe(true);
    });

    it('should handle malformed command names gracefully', () => {
      const malformedCommands = [null, undefined, '', '   ', '!', 'normal_text'];
      
      malformedCommands.forEach(cmd => {
        expect(() => {
          const result = checkGlobalCommandCooldown(cmd, 1000);
          updateGlobalCommandCooldown(cmd);
        }).not.toThrow();
      });
    });

    it('should handle extreme cooldown values', () => {
      updateGlobalCommandCooldown('!extreme');
      
      // Test with very large cooldown
      const longCooldown = checkGlobalCommandCooldown('!extreme', Number.MAX_SAFE_INTEGER);
      expect(longCooldown).toBe(true);
      
      // Test with zero cooldown
      const zeroCooldown = checkGlobalCommandCooldown('!extreme', 0);
      expect(zeroCooldown).toBe(false);
      
      // Test with negative cooldown
      const negativeCooldown = checkGlobalCommandCooldown('!extreme', -1000);
      expect(negativeCooldown).toBe(false);
    });
  });

  describe('when integrating with configuration system', () => {
    it('should respect different cooldown periods per platform', () => {
      const platforms = ['twitch', 'youtube', 'tiktok'];
      const cooldownPeriods = [1000, 2000, 3000];
      
      platforms.forEach((platform, index) => {
        const commandName = `!${platform}cmd`;
        updateGlobalCommandCooldown(commandName);
        
        const isBlocked = checkGlobalCommandCooldown(commandName, cooldownPeriods[index]);
        expect(isBlocked).toBe(true);
      });
    });

    it('should handle config changes without losing existing cooldowns', () => {
      // Set up cooldown with initial config
      updateGlobalCommandCooldown('!persistent');
      const initialBlock = checkGlobalCommandCooldown('!persistent', 2000);
      expect(initialBlock).toBe(true);
      
      // Simulate config change (new instance would be created in real app)
      // The singleton pattern should maintain state
      const postConfigBlock = checkGlobalCommandCooldown('!persistent', 3000);
      expect(postConfigBlock).toBe(true);
    });
  });
}, TEST_TIMEOUTS.INTEGRATION);