const { describe, it, expect, beforeEach, afterEach } = require('bun:test');

const testClock = require('./test-clock');
const { resetTestIds } = require('./test-id');
const {
    TestLogger,
    LogEntry,
    LOG_LEVELS,
    LOG_LEVEL_NAMES,
    createTestLogger,
    createSilentLogger,
    createVerboseLogger,
    createPerformanceLogger,
    assertNoErrors,
    assertNoWarnings,
    assertMessageLogged,
    assertEntryCount
} = require('./test-logger');

describe('test-logger behavior', () => {
    beforeEach(() => {
        testClock.reset();
        resetTestIds();
    });

    afterEach(() => {
        testClock.useRealTime();
    });

    it('builds log entry serialization and formatting contracts', () => {
        const entry = new LogEntry(LOG_LEVELS.INFO, 'test message', { key: 'value' }, testClock.now());

        expect(entry.level).toBe(LOG_LEVELS.INFO);
        expect(entry.levelName).toBe(LOG_LEVEL_NAMES[LOG_LEVELS.INFO]);
        expect(entry.id.startsWith('log-')).toBe(true);

        const json = entry.toJSON();
        expect(json.message).toBe('test message');
        expect(json.meta.key).toBe('value');
        expect(typeof json.isoString).toBe('string');

        expect(entry.toString()).toContain('[INFO] test message');
        expect(entry.toString()).toContain('"key":"value"');
    });

    it('applies level gating, max entries, filters, and hooks', () => {
        const logger = new TestLogger({ level: LOG_LEVELS.INFO, maxEntries: 2, enableConsole: false });
        const beforeLevels = [];
        const afterMessages = [];

        logger.addFilter((_level, message) => !message.includes('skip'));
        logger.addHook('beforeLog', (level) => {
            beforeLevels.push(level);
        });
        logger.addHook('beforeLog', () => {
            throw new Error('ignore hook error');
        });
        logger.addHook('afterLog', (entry) => {
            afterMessages.push(entry.message);
        });
        logger.addHook('invalidHookType', () => {
            throw new Error('should never run');
        });

        logger.debug('debug ignored by level');
        logger.info('skip this message');
        logger.info('message one');
        logger.warn('message two');
        logger.error('message three');

        expect(beforeLevels.length).toBe(4);
        expect(afterMessages).toEqual(['debug ignored by level', 'message one', 'message two', 'message three']);
        expect(logger.entries.length).toBe(2);
        expect(logger.entries[0].message).toBe('message two');
        expect(logger.entries[1].message).toBe('message three');
    });

    it('supports logger convenience methods and entry filtering', () => {
        const logger = createTestLogger({ level: LOG_LEVELS.TRACE });

        testClock.set(1000);
        logger.error('error message', { code: 'test-error' });
        testClock.advance(50);
        logger.warn('warn message', { scope: 'test' });
        testClock.advance(50);
        logger.info('info alpha');
        testClock.advance(50);
        logger.info('info beta');
        testClock.advance(50);
        logger.debug('debug message');
        testClock.advance(50);
        logger.trace('trace message');

        expect(logger.getEntries({ level: LOG_LEVELS.INFO }).length).toBe(2);
        expect(logger.getEntries({ levelName: 'WARN' }).length).toBe(1);
        expect(logger.getEntries({ message: 'info' }).length).toBe(2);
        expect(logger.getEntries({ since: 1100 }).length).toBeGreaterThan(0);
        expect(logger.getEntries({ until: 1100 }).length).toBeGreaterThan(0);
        expect(logger.getEntries({ limit: 2 }).length).toBe(2);

        expect(logger.getErrors().length).toBe(1);
        expect(logger.getWarnings().length).toBe(1);
        expect(logger.getInfo().length).toBe(2);
        expect(logger.getDebug().length).toBe(1);
        expect(logger.hasErrors()).toBe(true);
        expect(logger.hasWarnings()).toBe(true);
    });

    it('tracks performance stats and supports clear and reset', () => {
        const logger = createTestLogger({ level: LOG_LEVELS.TRACE });
        logger.info('first message');
        logger.warn('second message');

        const performance = logger.getPerformanceStats();
        expect(performance.totalCalls).toBe(2);
        expect(performance.callsByLevel.INFO).toBe(1);
        expect(performance.callsByLevel.WARN).toBe(1);

        const stats = logger.getStats();
        expect(stats.totalEntries).toBe(2);
        expect(stats.entriesByLevel.INFO).toBe(1);

        expect(logger.exportAsJSON()).toContain('"message": "first message"');
        expect(logger.exportAsText()).toContain('[INFO] first message');

        logger.clear();
        expect(logger.entries.length).toBe(0);

        logger.info('restored entry');
        expect(logger.entries.length).toBe(1);
        logger.reset();
        expect(logger.entries.length).toBe(0);
        expect(logger.getPerformanceStats().totalCalls).toBe(0);
    });

    it('uses console output when enabled and preserves factory defaults', () => {
        const originalConsoleLog = console.log;
        const captured = [];

        console.log = (message) => {
            captured.push(String(message));
        };

        const verboseLogger = createVerboseLogger();
        verboseLogger.info('console-visible-message');

        console.log = originalConsoleLog;

        expect(captured.some((line) => line.includes('console-visible-message'))).toBe(true);

        const silentLogger = createSilentLogger();
        silentLogger.trace('silent-trace');
        expect(silentLogger.getEntries().length).toBe(1);

        const performanceLogger = createPerformanceLogger();
        performanceLogger.debug('hidden-debug');
        performanceLogger.info('visible-info');
        expect(performanceLogger.getEntries().length).toBe(1);
        expect(performanceLogger.getEntries()[0].message).toBe('visible-info');
    });

    it('provides assertion helper contracts for log outcomes', () => {
        const logger = createTestLogger({ level: LOG_LEVELS.TRACE });

        logger.info('hello world');
        assertNoErrors(logger);
        assertNoWarnings(logger);
        assertMessageLogged(logger, 'hello', 'INFO');
        assertEntryCount(logger, 1);
        assertEntryCount(logger, 1, 'INFO');

        logger.warn('warn item');
        logger.error('error item');

        expect(() => assertNoWarnings(logger)).toThrow();
        expect(() => assertNoErrors(logger)).toThrow();
        expect(() => assertMessageLogged(logger, 'missing-text', 'INFO')).toThrow();
        expect(() => assertEntryCount(logger, 99, 'INFO')).toThrow();
    });
});
