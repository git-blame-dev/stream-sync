
// ================================================================================================
// LOG LEVEL DEFINITIONS
// ================================================================================================

const testClock = require('./test-clock');
const { nextTestId } = require('./test-id');

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

// ================================================================================================
// LOG ENTRY STRUCTURE
// ================================================================================================

class LogEntry {
    constructor(level, message, meta = {}, timestamp = testClock.now()) {
        this.level = level;
        this.levelName = LOG_LEVEL_NAMES[level];
        this.message = message;
        this.meta = meta;
        this.timestamp = timestamp;
        this.id = this.generateId();
    }

    generateId() {
        return nextTestId('log');
    }

    toJSON() {
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

    toString() {
        const metaStr = Object.keys(this.meta).length > 0 
            ? ` ${JSON.stringify(this.meta)}` 
            : '';
        return `[${this.levelName}] ${this.message}${metaStr}`;
    }
}

// ================================================================================================
// TEST LOGGER CLASS
// ================================================================================================

class TestLogger {
    constructor(options = {}) {
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

    reset() {
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

    addFilter(filterFn) {
        this.filters.push(filterFn);
    }

    addHook(hookType, hookFn) {
        if (this.hooks[hookType]) {
            this.hooks[hookType].push(hookFn);
        }
    }

    log(level, message, meta = {}) {
        const startTime = testClock.now();

        // Check if message should be filtered
        if (this.filters.some(filter => !filter(level, message, meta))) {
            return;
        }

        // Execute before hooks
        this.hooks.beforeLog.forEach(hook => {
            try {
                hook(level, message, meta);
            } catch (error) {
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
            } catch (error) {
                // Don't let hook errors break logging
            }
        });

        return entry;
    }

    updatePerformanceStats(level, callTime) {
        this.performance.totalCalls++;
        this.performance.totalCallTime += callTime;
        this.performance.averageCallTime = this.performance.totalCallTime / this.performance.totalCalls;

        const levelName = LOG_LEVEL_NAMES[level];
        if (!this.performance.callsByLevel[levelName]) {
            this.performance.callsByLevel[levelName] = 0;
        }
        this.performance.callsByLevel[levelName]++;
    }

    // Convenience methods for different log levels
    error(message, meta = {}) {
        return this.log(LOG_LEVELS.ERROR, message, meta);
    }

    warn(message, meta = {}) {
        return this.log(LOG_LEVELS.WARN, message, meta);
    }

    info(message, meta = {}) {
        return this.log(LOG_LEVELS.INFO, message, meta);
    }

    debug(message, meta = {}) {
        return this.log(LOG_LEVELS.DEBUG, message, meta);
    }

    trace(message, meta = {}) {
        return this.log(LOG_LEVELS.TRACE, message, meta);
    }

    getEntries(filter = {}) {
        let entries = [...this.entries];

        if (filter.level !== undefined) {
            entries = entries.filter(entry => entry.level === filter.level);
        }

        if (filter.levelName !== undefined) {
            entries = entries.filter(entry => entry.levelName === filter.levelName);
        }

        if (filter.message !== undefined) {
            entries = entries.filter(entry => 
                entry.message.includes(filter.message)
            );
        }

        if (filter.since !== undefined) {
            entries = entries.filter(entry => entry.timestamp >= filter.since);
        }

        if (filter.until !== undefined) {
            entries = entries.filter(entry => entry.timestamp <= filter.until);
        }

        if (filter.limit !== undefined) {
            entries = entries.slice(-filter.limit);
        }

        return entries;
    }

    getEntriesByLevel(levelName) {
        return this.getEntries({ levelName });
    }

    getErrors() {
        return this.getEntriesByLevel('ERROR');
    }

    getWarnings() {
        return this.getEntriesByLevel('WARN');
    }

    getInfo() {
        return this.getEntriesByLevel('INFO');
    }

    getDebug() {
        return this.getEntriesByLevel('DEBUG');
    }

    hasErrors() {
        return this.getErrors().length > 0;
    }

    hasWarnings() {
        return this.getWarnings().length > 0;
    }

    getPerformanceStats() {
        return { ...this.performance };
    }

    getStats() {
        return {
            totalEntries: this.entries.length,
            entriesByLevel: Object.fromEntries(
                Object.keys(LOG_LEVEL_NAMES).map(level => [
                    LOG_LEVEL_NAMES[level],
                    this.getEntriesByLevel(LOG_LEVEL_NAMES[level]).length
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

    clear() {
        this.entries = [];
    }

    exportAsJSON() {
        return JSON.stringify(this.entries.map(entry => entry.toJSON()), null, 2);
    }

    exportAsText() {
        return this.entries.map(entry => entry.toString()).join('\n');
    }
}

// ================================================================================================
// FACTORY FUNCTIONS
// ================================================================================================

const createTestLogger = (options = {}) => {
    return new TestLogger(options);
};

const createSilentLogger = () => {
    return new TestLogger({
        level: LOG_LEVELS.TRACE,
        enableConsole: false,
        enableStructured: true
    });
};

const createVerboseLogger = () => {
    return new TestLogger({
        level: LOG_LEVELS.TRACE,
        enableConsole: true,
        enableStructured: true
    });
};

const createPerformanceLogger = () => {
    return new TestLogger({
        level: LOG_LEVELS.INFO,
        enableConsole: false,
        enableStructured: true,
        enablePerformance: true
    });
};

// ================================================================================================
// ASSERTION HELPERS
// ================================================================================================

const assertNoErrors = (logger, message = 'No errors should be logged') => {
    expect(logger.hasErrors()).toBe(false);
    if (logger.hasErrors()) {
        const errors = logger.getErrors();
        throw new Error(`${message}. Found ${errors.length} errors: ${errors.map(e => e.message).join(', ')}`);
    }
};

const assertNoWarnings = (logger, message = 'No warnings should be logged') => {
    expect(logger.hasWarnings()).toBe(false);
    if (logger.hasWarnings()) {
        const warnings = logger.getWarnings();
        throw new Error(`${message}. Found ${warnings.length} warnings: ${warnings.map(w => w.message).join(', ')}`);
    }
};

const assertMessageLogged = (logger, message, levelName = 'INFO') => {
    const entries = logger.getEntriesByLevel(levelName);
    const found = entries.some(entry => entry.message.includes(message));
    expect(found).toBe(true);
    if (!found) {
        throw new Error(`Expected message "${message}" not found in ${levelName} logs`);
    }
};

const assertEntryCount = (logger, count, levelName = null) => {
    const entries = levelName ? logger.getEntriesByLevel(levelName) : logger.entries;
    expect(entries.length).toBe(count);
};

// ================================================================================================
// EXPORTS
// ================================================================================================

module.exports = {
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
