const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const {
    isDebugModeEnabled,
    getLazyLogger,
    getLazyUnifiedLogger,
    safeObjectStringify,
    formatLogParams,
    createNoopLogger,
    getLoggerOrNoop
} = require('../../../src/utils/logger-utils');

describe('logger-utils behavior', () => {
    const originalArgv = [...process.argv];
    const originalEnv = { ...process.env };

    afterEach(() => {
        restoreAllMocks();
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
        const logger = getLazyLogger();
        expect(logger).toBeDefined();
        expect(typeof logger.debug).toBe('function');

        const unifiedLogger = getLazyUnifiedLogger();
        expect(unifiedLogger).toBeDefined();
        expect(typeof unifiedLogger.debug).toBe('function');
    });

    it('safely stringifies objects and formats params', () => {
        const circ = {}; circ.self = circ;
        const str = safeObjectStringify(circ, 1);
        expect(str).toContain('stringify failed');

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
        const logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() };
        expect(getLoggerOrNoop(logger)).toBe(logger);
    });

    it('returns a no-op logger when none is provided', () => {
        const logger = getLoggerOrNoop();
        expect(typeof logger.debug).toBe('function');
        expect(() => logger.info('hello')).not.toThrow();
    });
});
