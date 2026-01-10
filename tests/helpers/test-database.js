
const { scheduleTimeout, resolveDelay } = require('./time-utils');
const testClock = require('./test-clock');

// ================================================================================================
// TEST DATA STORAGE
// ================================================================================================

class TestDataStore {
    constructor() {
        this.data = new Map();
        this.metadata = new Map();
        this.cleanupHooks = [];
    }

    set(key, value, metadata = {}) {
        this.data.set(key, value);
        this.metadata.set(key, {
            createdAt: testClock.now(),
            accessCount: 0,
            ...metadata
        });
    }

    get(key) {
        const metadata = this.metadata.get(key);
        if (metadata) {
            metadata.accessCount++;
            metadata.lastAccessed = testClock.now();
        }
        return this.data.get(key);
    }

    has(key) {
        return this.data.has(key);
    }

    delete(key) {
        const deleted = this.data.delete(key);
        this.metadata.delete(key);
        return deleted;
    }

    clear() {
        this.data.clear();
        this.metadata.clear();
    }

    keys() {
        return Array.from(this.data.keys());
    }

    getStats() {
        const stats = {
            totalEntries: this.data.size,
            totalAccesses: 0,
            averageAccessCount: 0,
            oldestEntry: null,
            newestEntry: null
        };

        let totalAccesses = 0;
        let oldestTime = testClock.now();
        let newestTime = 0;

        for (const [key, metadata] of this.metadata) {
            totalAccesses += metadata.accessCount;
            if (metadata.createdAt < oldestTime) {
                oldestTime = metadata.createdAt;
                stats.oldestEntry = key;
            }
            if (metadata.createdAt > newestTime) {
                newestTime = metadata.createdAt;
                stats.newestEntry = key;
            }
        }

        stats.totalAccesses = totalAccesses;
        stats.averageAccessCount = this.data.size > 0 ? totalAccesses / this.data.size : 0;

        return stats;
    }
}

// ================================================================================================
// TEST STATE MANAGEMENT
// ================================================================================================

class TestStateManager {
    constructor() {
        this.currentTest = null;
        this.testSuite = null;
        this.executionStart = null;
        this.cleanupQueue = [];
        this.stateSnapshots = new Map();
    }

    startTest(testName, suiteName = 'unknown') {
        // Defensive programming: If a test is already running, end it first
        if (this.currentTest !== null && this.executionStart !== null) {
            // Silently end the previous test to prevent state corruption
            this.endTest();
        }

        this.currentTest = testName;
        this.testSuite = suiteName;
        this.executionStart = testClock.now();
        this.cleanupQueue = [];
    }

    endTest() {
        // Defensive programming: Handle invalid state gracefully
        if (this.executionStart === null || this.executionStart === undefined) {
            // If no test was started, return 0 instead of negative time
            this.currentTest = null;
            this.testSuite = null;
            this.executionStart = null;
            return 0;
        }

        const now = testClock.now();
        const executionTime = now - this.executionStart;

        // Prevent negative timing values due to clock adjustments or race conditions
        const safeExecutionTime = Math.max(0, executionTime);

        // Reset state
        this.currentTest = null;
        this.testSuite = null;
        this.executionStart = null;

        return safeExecutionTime;
    }

    addCleanupTask(cleanupFn, description = 'unknown') {
        this.cleanupQueue.push({
            fn: cleanupFn,
            description,
            addedAt: testClock.now()
        });
    }

    async executeCleanup() {
        const results = [];
        for (const task of this.cleanupQueue) {
            try {
                await task.fn();
                results.push({
                    success: true,
                    description: task.description,
                    executionTime: testClock.now() - task.addedAt
                });
            } catch (error) {
                results.push({
                    success: false,
                    description: task.description,
                    error: error.message,
                    executionTime: testClock.now() - task.addedAt
                });
            }
        }
        this.cleanupQueue = [];
        return results;
    }

    saveSnapshot(name, state) {
        this.stateSnapshots.set(name, {
            state: JSON.parse(JSON.stringify(state)), // Deep clone
            timestamp: testClock.now(),
            testName: this.currentTest
        });
    }

    getSnapshot(name) {
        const snapshot = this.stateSnapshots.get(name);
        return snapshot ? snapshot.state : null;
    }

    clearSnapshots() {
        this.stateSnapshots.clear();
    }
}

// ================================================================================================
// TEST ENVIRONMENT SETUP
// ================================================================================================

class TestEnvironment {
    constructor() {
        this.dataStore = new TestDataStore();
        this.stateManager = new TestStateManager();
        this.config = {
            isolationLevel: 'test', // test, suite, global
            cleanupMode: 'automatic', // automatic, manual
            snapshotMode: 'enabled', // enabled, disabled
            timeoutMs: 15000,
            retryAttempts: 3
        };
    }

    initialize(config = {}) {
        this.config = { ...this.config, ...config };
        
        // Set up global test utilities
        global.testEnv = {
            data: this.dataStore,
            state: this.stateManager,
            config: this.config
        };

        // Set up cleanup hooks
        this.setupCleanupHooks();
    }

    setupCleanupHooks() {
        if (this.config.cleanupMode === 'automatic') {
            afterEach(async () => {
                await this.stateManager.executeCleanup();
            });

            afterAll(() => {
                this.dataStore.clear();
                this.stateManager.clearSnapshots();
            });
        }
    }

    createTestContext(contextName) {
        const contextData = new TestDataStore();
        const contextState = new TestStateManager();

        return {
            name: contextName,
            data: contextData,
            state: contextState,
            
            // Convenience methods
            setData: (key, value, metadata) => contextData.set(key, value, metadata),
            getData: (key) => contextData.get(key),
            hasData: (key) => contextData.has(key),
            clearData: () => contextData.clear(),
            
            startTest: (testName) => contextState.startTest(testName, contextName),
            endTest: () => contextState.endTest(),
            addCleanup: (fn, description) => contextState.addCleanupTask(fn, description),
            
            // Cleanup method
            cleanup: async () => {
                const results = await contextState.executeCleanup();
                contextData.clear();
                return results;
            }
        };
    }

    reset() {
        this.dataStore.clear();
        this.stateManager.clearSnapshots();
        this.stateManager.cleanupQueue = [];
    }

    getStats() {
        return {
            dataStore: this.dataStore.getStats(),
            stateManager: {
                currentTest: this.stateManager.currentTest,
                testSuite: this.stateManager.testSuite,
                cleanupQueueLength: this.stateManager.cleanupQueue.length,
                snapshotCount: this.stateManager.stateSnapshots.size
            },
            config: this.config
        };
    }
}

// ================================================================================================
// UTILITY FUNCTIONS
// ================================================================================================

const createTestDataFactory = (type, options = {}) => {
    const factories = {
        user: (overrides = {}) => ({
            id: Math.random().toString(36).substr(2, 9),
            username: `testuser_${testClock.now()}`,
            displayName: `Test User ${testClock.now()}`,
            email: `test${testClock.now()}@example.com`,
            createdAt: new Date(testClock.now()).toISOString(),
            ...overrides
        }),
        
        notification: (overrides = {}) => ({
            id: Math.random().toString(36).substr(2, 9),
            type: 'gift',
            username: `testuser_${testClock.now()}`,
            platform: 'tiktok',
            message: `Test notification ${testClock.now()}`,
            timestamp: new Date(testClock.now()).toISOString(),
            ...overrides
        }),
        
        config: (overrides = {}) => ({
            enabled: true,
            debug: false,
            timeout: 5000,
            retries: 3,
            ...overrides
        }),
        
        event: (overrides = {}) => ({
            id: Math.random().toString(36).substr(2, 9),
            type: 'chat',
            platform: 'tiktok',
            timestamp: new Date(testClock.now()).toISOString(),
            data: {},
            ...overrides
        })
    };

    return factories[type] || (() => ({}));
};

const waitForCondition = (condition, timeout = 5000, interval = 100) => {
    return new Promise((resolve, reject) => {
        const startTime = testClock.now();
        const effectiveInterval = resolveDelay(interval);
        
        const checkCondition = () => {
            try {
                if (condition()) {
                    resolve();
                    return;
                }
                
                if (testClock.now() - startTime > timeout) {
                    reject(new Error(`Condition not met within ${timeout}ms`));
                    return;
                }
                
                scheduleTimeout(checkCondition, effectiveInterval);
                testClock.advance(effectiveInterval);
            } catch (error) {
                reject(error);
            }
        };
        
        checkCondition();
    });
};

const createMockTimer = (startTime = testClock.now()) => {
    let currentTime = startTime;
    
    return {
        now: () => currentTime,
        advance: (ms) => { currentTime += ms; },
        set: (time) => { currentTime = time; },
        reset: () => { currentTime = startTime; }
    };
};

// ================================================================================================
// EXPORTS
// ================================================================================================

module.exports = {
    TestDataStore,
    TestStateManager,
    TestEnvironment,
    createTestDataFactory,
    waitForCondition,
    createMockTimer
}; 
