let mockHandler;
jest.mock('../../../src/utils/platform-error-handler', () => {
    mockHandler = {
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    };
    return {
        createPlatformErrorHandler: jest.fn(() => mockHandler)
    };
});

const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const { GlobalCommandCooldownManager } = require('../../../src/utils/global-command-cooldown');

describe('GlobalCommandCooldownManager behavior', () => {
    const buildLogger = (overrides = {}) => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        ...overrides
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('allows execution on invalid inputs and tracks checks without blocks', () => {
        const logger = buildLogger();
        const manager = new GlobalCommandCooldownManager(logger);

        const allowed = manager.isCommandOnCooldown('', 0);

        expect(allowed).toBe(false);
        expect(manager.stats.totalChecks).toBe(1);
        expect(manager.stats.totalBlocks).toBe(0);
        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringContaining('invalid parameters'),
            'global-cooldown'
        );
    });

    it('blocks commands still within cooldown window and reports remaining time', () => {
        const logger = buildLogger();
        const manager = new GlobalCommandCooldownManager(logger);
        const nowSpy = jest.spyOn(Date, 'now');

        nowSpy.mockReturnValueOnce(1000); // initial timestamp for update
        manager.updateCommandTimestamp('!hello');

        nowSpy.mockReturnValueOnce(1500); // check timestamp
        const blocked = manager.isCommandOnCooldown('!hello', 1000);

        expect(blocked).toBe(true);
        expect(manager.stats.totalBlocks).toBe(1);
        nowSpy.mockReturnValueOnce(1500);
        expect(manager.getRemainingCooldown('!hello', 1000)).toBeGreaterThan(0);
        nowSpy.mockRestore();
    });

    it('clears expired cooldowns and reports removal count', () => {
        const logger = buildLogger();
        const manager = new GlobalCommandCooldownManager(logger);
        const nowSpy = jest.spyOn(Date, 'now');

        nowSpy.mockReturnValue(0);
        manager.updateCommandTimestamp('!old');

        nowSpy.mockReturnValue(10_000);
        const removed = manager.clearExpiredCooldowns(1000);

        expect(removed).toBe(1);
        expect(manager.commandTimestamps.size).toBe(0);
        nowSpy.mockRestore();
    });

    it('routes errors through platform error handler and fails open', () => {
        const erroringLogger = buildLogger({
            debug: jest.fn(() => {
                throw new Error('logger failure');
            })
        });
        const manager = new GlobalCommandCooldownManager(erroringLogger);

        const allowed = manager.isCommandOnCooldown('!boom', 1000);

        expect(allowed).toBe(false);
        expect(createPlatformErrorHandler).toHaveBeenCalled();
        manager.errorHandler = mockHandler; // ensure handler available for the routing check
        manager._handleCooldownError('forced', 'non-error', { commandName: '!boom', cooldownMs: 1000 });
        expect(mockHandler.logOperationalError).toHaveBeenCalledWith(
            expect.stringContaining('forced'),
            'global-cooldown',
            expect.objectContaining({ commandName: '!boom', cooldownMs: 1000 })
        );
    });
});
