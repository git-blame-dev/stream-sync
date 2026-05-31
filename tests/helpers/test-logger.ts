
// LOG LEVEL DEFINITIONS

import { expect } from 'bun:test';

import testClock from './test-clock';
import { nextTestId } from './test-id';

const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
    TRACE: 4
};

const LOG_LEVEL_NAMES = {
    0: 'ERROR',
    1: 'WARN',
    2: 'INFO',
    3: 'DEBUG',
    4: 'TRACE'
};

type LogMeta = Record<string, unknown>;

type LogEntryJson = {
    id: string;
    level: number;
    levelName: string;
    message: string;
    meta: LogMeta;
    timestamp: number;
    isoString: string;
};

type TestLoggerOptions = {
    level: number;
    enableConsole: boolean;
    enableStructured: boolean;
    enablePerformance: boolean;
    maxEntries: number;
};

type PerformanceStats = {
    totalCalls: number;
    callsByLevel: Record<string, number>;
    averageCallTime: number;
    totalCallTime: number;
};

type LogFilter = (level: number, message: string, meta: LogMeta) => boolean;
type BeforeLogHook = (level: number, message: string, meta: LogMeta) => void;
type AfterLogHook = (entry: LogEntry) => void;
type LogHook = BeforeLogHook | AfterLogHook;

type LoggerHooks = Record<string, LogHook[]> & {
    beforeLog: BeforeLogHook[];
    afterLog: AfterLogHook[];
};

type EntryFilter = {
    level?: number;
    levelName?: string;
    message?: string;
    since?: number;
    until?: number;
    limit?: number;
};

function getLogLevelName(level: number): string {
    return LOG_LEVEL_NAMES[level as keyof typeof LOG_LEVEL_NAMES] ?? String(level);
}

// LOG ENTRY STRUCTURE

class LogEntry {
    level: number;
    levelName: string;
    message: string;
    meta: LogMeta;
    timestamp: number;
    id: string;

    constructor(level: number, message: string, meta: LogMeta = {}, timestamp: number = testClock.now()) {
        this.level = level;
        this.levelName = getLogLevelName(level);
        this.message = message;
        this.meta = meta;
        this.timestamp = timestamp;
        this.id = this.generateId();
    }

    generateId(): string {
        return nextTestId('log');
    }

    toJSON(): LogEntryJson {
        return {
            id: this.id,
            level: this.level,
            levelName: this.levelName,
            message: this.message,
            meta: this.meta,
            timestamp: this.timestamp,
            isoString: new Date(this.timestamp).toISOString()
        };
    }

    toString(): string {
        const metaStr = Object.keys(this.meta).length > 0 
            ? ` ${JSON.stringify(this.meta)}` 
            : '';
        return `[${this.levelName}] ${this.message}${metaStr}`;
    }
}

// TEST LOGGER CLASS

class TestLogger {
    options: TestLoggerOptions;
    entries: LogEntry[];
    performance: PerformanceStats;
    filters: LogFilter[];
    hooks: LoggerHooks;

    constructor(options: Partial<TestLoggerOptions> = {}) {
        this.options = {
            level: LOG_LEVELS.DEBUG,
            enableConsole: false,
            enableStructured: true,
            enablePerformance: true,
            maxEntries: 1000,
            ...options
        };

        this.entries = [];
        this.performance = {
            totalCalls: 0,
            callsByLevel: {},
            averageCallTime: 0,
            totalCallTime: 0
        };

        this.filters = [];
        this.hooks = {
            beforeLog: [],
            afterLog: []
        };

        this.reset();
    }

    reset(): void {
        this.entries = [];
        this.performance = {
            totalCalls: 0,
            callsByLevel: {},
            averageCallTime: 0,
            totalCallTime: 0
        };
        this.filters = [];
        this.hooks = {
            beforeLog: [],
            afterLog: []
        };
    }

    addFilter(filterFn: LogFilter): void {
        this.filters.push(filterFn);
    }

    addHook(hookType: 'beforeLog', hookFn: BeforeLogHook): void;
    addHook(hookType: 'afterLog', hookFn: AfterLogHook): void;
    addHook(hookType: string, hookFn: LogHook): void;
    addHook(hookType: string, hookFn: LogHook): void {
        const hooks = this.hooks[hookType];
        if (hooks) {
            hooks.push(hookFn);
        }
    }

    log(level: number, message: string, meta: LogMeta = {}): LogEntry | undefined {
        const startTime = testClock.now();

        // Check if message should be filtered
        if (this.filters.some(filter => !filter(level, message, meta))) {
            return;
        }

        // Execute before hooks
        this.hooks.beforeLog.forEach(hook => {
            try {
                hook(level, message, meta);
            } catch {
                // Don't let hook errors break logging
            }
        });

        // Create log entry
        const entry = new LogEntry(level, message, meta);

        // Add to entries if level is enabled
        if (level <= this.options.level) {
            this.entries.push(entry);

            // Maintain max entries limit
            if (this.entries.length > this.options.maxEntries) {
                this.entries.shift();
            }

            // Update performance stats
            this.updatePerformanceStats(level, testClock.now() - startTime);

            // Console output if enabled
            if (this.options.enableConsole) {
                console.log(entry.toString());
            }
        }

        // Execute after hooks
        this.hooks.afterLog.forEach(hook => {
            try {
                hook(entry);
            } catch {
                // Don't let hook errors break logging
            }
        });

        return entry;
    }

    updatePerformanceStats(level: number, callTime: number): void {
        this.performance.totalCalls++;
        this.performance.totalCallTime += callTime;
        this.performance.averageCallTime = this.performance.totalCallTime / this.performance.totalCalls;

        const levelName = getLogLevelName(level);
        if (!this.performance.callsByLevel[levelName]) {
            this.performance.callsByLevel[levelName] = 0;
        }
        this.performance.callsByLevel[levelName]++;
    }

    // Convenience methods for different log levels
    error(message: string, meta: LogMeta = {}): LogEntry | undefined {
        return this.log(LOG_LEVELS.ERROR, message, meta);
    }

    warn(message: string, meta: LogMeta = {}): LogEntry | undefined {
        return this.log(LOG_LEVELS.WARN, message, meta);
    }

    info(message: string, meta: LogMeta = {}): LogEntry | undefined {
        return this.log(LOG_LEVELS.INFO, message, meta);
    }

    debug(message: string, meta: LogMeta = {}): LogEntry | undefined {
        return this.log(LOG_LEVELS.DEBUG, message, meta);
    }

    trace(message: string, meta: LogMeta = {}): LogEntry | undefined {
        return this.log(LOG_LEVELS.TRACE, message, meta);
    }

    getEntries(filter: EntryFilter = {}): LogEntry[] {
        let entries = [...this.entries];

        if (filter.level !== undefined) {
            entries = entries.filter(entry => entry.level === filter.level);
        }

        if (filter.levelName !== undefined) {
            entries = entries.filter(entry => entry.levelName === filter.levelName);
        }

        if (filter.message !== undefined) {
            const message = filter.message;
            entries = entries.filter(entry => 
                entry.message.includes(message)
            );
        }

        if (filter.since !== undefined) {
            const since = filter.since;
            entries = entries.filter(entry => entry.timestamp >= since);
        }

        if (filter.until !== undefined) {
            const until = filter.until;
            entries = entries.filter(entry => entry.timestamp <= until);
        }

        if (filter.limit !== undefined) {
            entries = entries.slice(-filter.limit);
        }

        return entries;
    }

    getEntriesByLevel(levelName: string): LogEntry[] {
        return this.getEntries({ levelName });
    }

    getErrors(): LogEntry[] {
        return this.getEntriesByLevel('ERROR');
    }

    getWarnings(): LogEntry[] {
        return this.getEntriesByLevel('WARN');
    }

    getInfo(): LogEntry[] {
        return this.getEntriesByLevel('INFO');
    }

    getDebug(): LogEntry[] {
        return this.getEntriesByLevel('DEBUG');
    }

    hasErrors(): boolean {
        return this.getErrors().length > 0;
    }

    hasWarnings(): boolean {
        return this.getWarnings().length > 0;
    }

    getPerformanceStats(): PerformanceStats {
        return { ...this.performance };
    }

    getStats() {
        return {
            totalEntries: this.entries.length,
            entriesByLevel: Object.fromEntries(
                Object.values(LOG_LEVEL_NAMES).map(levelName => [
                    levelName,
                    this.getEntriesByLevel(levelName).length
                ])
            ),
            performance: this.getPerformanceStats(),
            filters: this.filters.length,
            hooks: {
                beforeLog: this.hooks.beforeLog.length,
                afterLog: this.hooks.afterLog.length
            }
        };
    }

    clear(): void {
        this.entries = [];
    }

    exportAsJSON(): string {
        return JSON.stringify(this.entries.map(entry => entry.toJSON()), null, 2);
    }

    exportAsText(): string {
        return this.entries.map(entry => entry.toString()).join('\n');
    }
}

// FACTORY FUNCTIONS

const createTestLogger = (options: Partial<TestLoggerOptions> = {}): TestLogger => {
    return new TestLogger(options);
};

const createSilentLogger = (): TestLogger => {
    return new TestLogger({
        level: LOG_LEVELS.TRACE,
        enableConsole: false,
        enableStructured: true
    });
};

const createVerboseLogger = (): TestLogger => {
    return new TestLogger({
        level: LOG_LEVELS.TRACE,
        enableConsole: true,
        enableStructured: true
    });
};

const createPerformanceLogger = (): TestLogger => {
    return new TestLogger({
        level: LOG_LEVELS.INFO,
        enableConsole: false,
        enableStructured: true,
        enablePerformance: true
    });
};

// ASSERTION HELPERS

const assertNoErrors = (logger: TestLogger, message = 'No errors should be logged'): void => {
    expect(logger.hasErrors()).toBe(false);
    if (logger.hasErrors()) {
        const errors = logger.getErrors();
        throw new Error(`${message}. Found ${errors.length} errors: ${errors.map(e => e.message).join(', ')}`);
    }
};

const assertNoWarnings = (logger: TestLogger, message = 'No warnings should be logged'): void => {
    expect(logger.hasWarnings()).toBe(false);
    if (logger.hasWarnings()) {
        const warnings = logger.getWarnings();
        throw new Error(`${message}. Found ${warnings.length} warnings: ${warnings.map(w => w.message).join(', ')}`);
    }
};

const assertMessageLogged = (logger: TestLogger, message: string, levelName = 'INFO'): void => {
    const entries = logger.getEntriesByLevel(levelName);
    const found = entries.some(entry => entry.message.includes(message));
    expect(found).toBe(true);
    if (!found) {
        throw new Error(`Expected message "${message}" not found in ${levelName} logs`);
    }
};

const assertEntryCount = (logger: TestLogger, count: number, levelName: string | null = null): void => {
    const entries = levelName ? logger.getEntriesByLevel(levelName) : logger.entries;
    expect(entries.length).toBe(count);
};

// EXPORTS

export {
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
};
