const { describe, test, expect, afterEach } = require('bun:test');

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
        process.argv = [...originalArgv];
        process.env = { ...originalEnv };
    });

    test('detects debug mode via argv or env', () => {
        process.argv.push('--debug');
        expect(isDebugModeEnabled()).toBe(true);
        process.argv = [...originalArgv];
        process.env.EMERGENCY_DEBUG = '1';
        expect(isDebugModeEnabled()).toBe(true);
    });

    test('lazily loads loggers', () => {
        const logger = getLazyLogger();
        expect(logger).toBeDefined();
        expect(typeof logger.debug).toBe('function');

        const unifiedLogger = getLazyUnifiedLogger();
        expect(unifiedLogger).toBeDefined();
        expect(typeof unifiedLogger.debug).toBe('function');
    });

    test('safely stringifies primitives, objects, and formats params', () => {
        expect(safeObjectStringify(null)).toBe('null');
        expect(safeObjectStringify(undefined)).toBe('undefined');
        expect(safeObjectStringify('hello')).toBe('hello');
        expect(safeObjectStringify(42)).toBe('42');
        expect(safeObjectStringify(true)).toBe('true');

        const circ = {}; circ.self = circ;
        expect(safeObjectStringify(circ, 1)).toContain('stringify failed');

        const formatted = formatLogParams('a', 1, { b: 2 });
        expect(formatted).toContain('a');
        expect(formatted).toContain('1');
        expect(formatted).toContain('"b":2');
    });

    test('serializes Error objects with message, stack, and name', () => {
        const error = new Error('test-boom');
        const serialized = safeObjectStringify(error);
        const parsed = JSON.parse(serialized);
        expect(parsed.message).toBe('test-boom');
        expect(parsed.name).toBe('Error');
        expect(parsed.stack).toContain('test-boom');
    });

    test('provides a no-op logger fallback', () => {
        const noop = createNoopLogger();
        expect(typeof noop.debug).toBe('function');
        expect(typeof noop.info).toBe('function');
        expect(typeof noop.warn).toBe('function');
        expect(typeof noop.error).toBe('function');
        expect(() => noop.debug('hello')).not.toThrow();
    });

    test('returns the provided logger when available', () => {
        const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
        expect(getLoggerOrNoop(logger)).toBe(logger);
    });

    test('returns a no-op logger when none is provided', () => {
        const logger = getLoggerOrNoop();
        expect(typeof logger.debug).toBe('function');
        expect(() => logger.info('hello')).not.toThrow();
    });
});
