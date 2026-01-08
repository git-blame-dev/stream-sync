jest.mock('../../../src/core/logging', () => ({
    logger: { debug: jest.fn() },
    getUnifiedLogger: jest.fn(() => ({ unified: true }))
}));

jest.unmock('../../../src/utils/logger-utils');

let logging = require('../../../src/core/logging');
const {
    isDebugModeEnabled: initialIsDebugModeEnabled,
    getLazyLogger: initialGetLazyLogger,
    getLazyUnifiedLogger: initialGetLazyUnifiedLogger,
    safeObjectStringify: initialSafeObjectStringify,
    formatLogParams: initialFormatLogParams,
    createNoopLogger: initialCreateNoopLogger,
    getLoggerOrNoop: initialGetLoggerOrNoop
} = require('../../../src/utils/logger-utils');

let isDebugModeEnabled = initialIsDebugModeEnabled;
let getLazyLogger = initialGetLazyLogger;
let getLazyUnifiedLogger = initialGetLazyUnifiedLogger;
let safeObjectStringify = initialSafeObjectStringify;
let formatLogParams = initialFormatLogParams;
let createNoopLogger = initialCreateNoopLogger;
let getLoggerOrNoop = initialGetLoggerOrNoop;

describe('logger-utils behavior', () => {
    const originalArgv = [...process.argv];
    const originalEnv = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        logging = require('../../../src/core/logging');
        ({
            isDebugModeEnabled,
            getLazyLogger,
            getLazyUnifiedLogger,
            safeObjectStringify,
            formatLogParams,
            createNoopLogger,
            getLoggerOrNoop
        } = require('../../../src/utils/logger-utils'));
        jest.clearAllMocks();
    });

    afterEach(() => {
        process.argv = [...originalArgv];
        process.env = { ...originalEnv };
    });

    it('detects debug mode via argv or env', () => {
        process.argv.push('--debug');
        expect(isDebugModeEnabled()).toBe(true);
        process.argv = [...originalArgv];
        process.env.EMERGENCY_DEBUG = '1';
        expect(isDebugModeEnabled()).toBe(true);
    });

    it('lazily loads loggers', () => {
        expect(getLazyLogger()).toBe(logging.logger);
        expect(getLazyUnifiedLogger()).toEqual({ unified: true });
    });

    it('safely stringifies objects and formats params', () => {
        const circ = {}; circ.self = circ;
        const str = safeObjectStringify(circ, 1);
        expect(str).toMatch(/max depth|circular reference/i);

        const formatted = formatLogParams('a', 1, { b: 2 });
        expect(formatted).toContain('a');
        expect(formatted).toContain('1');
        expect(formatted).toContain('"b":2');
    });

    it('provides a no-op logger fallback', () => {
        const noop = createNoopLogger();
        expect(typeof noop.debug).toBe('function');
        expect(typeof noop.info).toBe('function');
        expect(typeof noop.warn).toBe('function');
        expect(typeof noop.error).toBe('function');
        expect(() => noop.debug('hello')).not.toThrow();
    });

    it('returns the provided logger when available', () => {
        const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        expect(getLoggerOrNoop(logger)).toBe(logger);
    });

    it('returns a no-op logger when none is provided', () => {
        const logger = getLoggerOrNoop();
        expect(typeof logger.debug).toBe('function');
        expect(() => logger.info('hello')).not.toThrow();
    });
});
