jest.mock('../../../src/core/logging', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

describe('command-parser behavior', () => {
    const loadModule = () => {
        jest.resetModules();
        return require('../../../src/utils/command-parser');
    };

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.resetModules();
    });

    it('applies per-user cooldowns and heavy limit escalation', () => {
        const parser = loadModule();
        const userCommandTimestamps = {};
        const userHeavyLimit = {};

        for (let i = 0; i < 4; i++) {
            parser.updateUserCommandTimestamps(userCommandTimestamps, userHeavyLimit, 'user1');
        }

        expect(userHeavyLimit.user1).toBe(true);
        expect(parser.checkCommandCooldown('user1', 500, 5000, userCommandTimestamps, userHeavyLimit)).toBe(true);

        jest.setSystemTime(new Date('2024-01-01T00:05:30Z'));
        expect(parser.checkCommandCooldown('user1', 500, 5000, userCommandTimestamps, userHeavyLimit)).toBe(false);
        expect(userHeavyLimit.user1).toBe(false);
    });

    it('tracks global cooldowns with remaining time and cleanup', () => {
        const parser = loadModule();

        parser.updateGlobalCommandCooldown('!wave');
        expect(parser.checkGlobalCommandCooldown('!wave', 5000)).toBe(true);
        expect(parser.getRemainingGlobalCooldown('!wave', 5000)).toBeGreaterThan(0);

        jest.setSystemTime(new Date('2024-01-01T00:02:00Z'));
        expect(parser.checkGlobalCommandCooldown('!wave', 5000)).toBe(false);
        expect(parser.getRemainingGlobalCooldown('!wave', 5000)).toBe(0);

        jest.setSystemTime(new Date('2024-01-01T01:00:00Z'));
        expect(parser.clearExpiredGlobalCooldowns(300000)).toBe(1);
        expect(parser.getGlobalCooldownStats().totalTrackedCommands).toBe(0);
    });

    it('leaves cooldown manager idle when no commands are tracked', () => {
        const parser = loadModule();
        const stats = parser.getGlobalCooldownStats();

        expect(stats.totalTrackedCommands).toBe(0);
        expect(parser.clearExpiredGlobalCooldowns(1000)).toBe(0);
    });
});
