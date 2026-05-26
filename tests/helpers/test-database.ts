import { afterAll, afterEach } from 'bun:test';

import testClock from './test-clock';
import { nextTestId } from './test-id';
import { resolveDelay, scheduleTimeout } from './time-utils';

type TestDataKey = string;
type TestDataMetadata = {
    createdAt: number;
    accessCount: number;
    lastAccessed?: number;
    [key: string]: unknown;
};

type TestDataStats = {
    totalEntries: number;
    totalAccesses: number;
    averageAccessCount: number;
    oldestEntry: string | null;
    newestEntry: string | null;
};

type CleanupTask = {
    fn: () => Promise<unknown> | unknown;
    description: string;
    addedAt: number;
};

type CleanupResult = {
    success: boolean;
    description: string;
    executionTime: number;
    error?: string;
};

type StateSnapshot = {
    state: unknown;
    timestamp: number;
    testName: string | null;
};

type TestEnvironmentConfig = {
    isolationLevel: string;
    cleanupMode: 'automatic' | 'manual' | string;
    snapshotMode: string;
    timeoutMs: number;
    retryAttempts: number;
};

type TestContext = {
    name: string;
    data: TestDataStore;
    state: TestStateManager;
    setData: (key: string, value: unknown, metadata?: Record<string, unknown>) => void;
    getData: <T = unknown>(key: string) => T | undefined;
    hasData: (key: string) => boolean;
    clearData: () => void;
    startTest: (testName: string) => void;
    endTest: () => number;
    addCleanup: (fn: () => Promise<unknown> | unknown, description?: string) => void;
    cleanup: () => Promise<CleanupResult[]>;
};

type UserFixture = {
    id: string;
    username: string;
    displayName: string;
    email: string;
    createdAt: string;
} & Record<string, unknown>;

type NotificationFixture = {
    id: string;
    type: string;
    username: string;
    platform: string;
    message: string;
    timestamp: string;
} & Record<string, unknown>;

type ConfigFixture = {
    enabled: boolean;
    debug: boolean;
    timeout: number;
    retries: number;
} & Record<string, unknown>;

type EventFixture = {
    id: string;
    type: string;
    platform: string;
    timestamp: string;
    data: Record<string, unknown>;
} & Record<string, unknown>;

type TestDataFactories = {
    user: (overrides?: Partial<UserFixture>) => UserFixture;
    notification: (overrides?: Partial<NotificationFixture>) => NotificationFixture;
    config: (overrides?: Partial<ConfigFixture>) => ConfigFixture;
    event: (overrides?: Partial<EventFixture>) => EventFixture;
};

type GlobalTestEnvironment = {
    data: TestDataStore;
    state: TestStateManager;
    config: TestEnvironmentConfig;
};

declare global {
    var testEnv: GlobalTestEnvironment | undefined;
}

const getErrorMessage = (error: unknown): string => {
    return error instanceof Error ? error.message : String(error);
};

// ================================================================================================
// TEST DATA STORAGE
// ================================================================================================

class TestDataStore {
    private data: Map<TestDataKey, unknown>;
    private metadata: Map<TestDataKey, TestDataMetadata>;
    private cleanupHooks: Array<() => Promise<unknown> | unknown>;

    constructor() {
        this.data = new Map();
        this.metadata = new Map();
        this.cleanupHooks = [];
    }

    set(key: string, value: unknown, metadata: Record<string, unknown> = {}): void {
        this.data.set(key, value);
        this.metadata.set(key, {
            createdAt: testClock.now(),
            accessCount: 0,
            ...metadata
        });
    }

    get<T = unknown>(key: string): T | undefined {
        const metadata = this.metadata.get(key);
        if (metadata) {
            metadata.accessCount++;
            metadata.lastAccessed = testClock.now();
        }
        return this.data.get(key) as T | undefined;
    }

    has(key: string): boolean {
        return this.data.has(key);
    }

    delete(key: string): boolean {
        const deleted = this.data.delete(key);
        this.metadata.delete(key);
        return deleted;
    }

    clear(): void {
        this.data.clear();
        this.metadata.clear();
    }

    keys(): string[] {
        return Array.from(this.data.keys());
    }

    getStats(): TestDataStats {
        const stats: TestDataStats = {
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
    currentTest: string | null;
    testSuite: string | null;
    executionStart: number | null;
    cleanupQueue: CleanupTask[];
    stateSnapshots: Map<string, StateSnapshot>;

    constructor() {
        this.currentTest = null;
        this.testSuite = null;
        this.executionStart = null;
        this.cleanupQueue = [];
        this.stateSnapshots = new Map();
    }

    startTest(testName: string, suiteName = 'unknown'): void {
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

    endTest(): number {
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

    addCleanupTask(cleanupFn: () => Promise<unknown> | unknown, description = 'unknown'): void {
        this.cleanupQueue.push({
            fn: cleanupFn,
            description,
            addedAt: testClock.now()
        });
    }

    async executeCleanup(): Promise<CleanupResult[]> {
        const results: CleanupResult[] = [];
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
                    error: getErrorMessage(error),
                    executionTime: testClock.now() - task.addedAt
                });
            }
        }
        this.cleanupQueue = [];
        return results;
    }

    saveSnapshot(name: string, state: unknown): void {
        this.stateSnapshots.set(name, {
            state: JSON.parse(JSON.stringify(state)), // Deep clone
            timestamp: testClock.now(),
            testName: this.currentTest
        });
    }

    getSnapshot<T = unknown>(name: string): T | null {
        const snapshot = this.stateSnapshots.get(name);
        return snapshot ? snapshot.state as T : null;
    }

    clearSnapshots(): void {
        this.stateSnapshots.clear();
    }
}

// ================================================================================================
// TEST ENVIRONMENT SETUP
// ================================================================================================

class TestEnvironment {
    dataStore: TestDataStore;
    stateManager: TestStateManager;
    config: TestEnvironmentConfig;

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

    initialize(config: Partial<TestEnvironmentConfig> = {}): void {
        this.config = { ...this.config, ...config };
        
        // Set up global test utilities
        globalThis.testEnv = {
            data: this.dataStore,
            state: this.stateManager,
            config: this.config
        };

        // Set up cleanup hooks
        this.setupCleanupHooks();
    }

    setupCleanupHooks(): void {
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

    createTestContext(contextName: string): TestContext {
        const contextData = new TestDataStore();
        const contextState = new TestStateManager();

        return {
            name: contextName,
            data: contextData,
            state: contextState,
            
            // Convenience methods
            setData: (key: string, value: unknown, metadata?: Record<string, unknown>) => contextData.set(key, value, metadata),
            getData: <T = unknown>(key: string) => contextData.get<T>(key),
            hasData: (key: string) => contextData.has(key),
            clearData: () => contextData.clear(),
            
            startTest: (testName: string) => contextState.startTest(testName, contextName),
            endTest: () => contextState.endTest(),
            addCleanup: (fn: () => Promise<unknown> | unknown, description?: string) => contextState.addCleanupTask(fn, description),
            
            // Cleanup method
            cleanup: async () => {
                const results = await contextState.executeCleanup();
                contextData.clear();
                return results;
            }
        };
    }

    reset(): void {
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

function createTestDataFactory<Type extends keyof TestDataFactories>(type: Type, options?: Record<string, unknown>): TestDataFactories[Type];
function createTestDataFactory(type: string, options?: Record<string, unknown>): (overrides?: Record<string, unknown>) => Record<string, unknown>;
function createTestDataFactory(type: string, _options: Record<string, unknown> = {}) {
    const factories: TestDataFactories = {
        user: (overrides = {}) => ({
            id: nextTestId('user'),
            username: `testuser_${testClock.now()}`,
            displayName: `Test User ${testClock.now()}`,
            email: `test${testClock.now()}@example.com`,
            createdAt: new Date(testClock.now()).toISOString(),
            ...overrides
        }),
        
        notification: (overrides = {}) => ({
            id: nextTestId('notification'),
            type: 'platform:gift',
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
            id: nextTestId('event'),
            type: 'chat',
            platform: 'tiktok',
            timestamp: new Date(testClock.now()).toISOString(),
            data: {},
            ...overrides
        })
    };

    return factories[type as keyof TestDataFactories] || (() => ({}));
}

const waitForCondition = (condition: () => boolean, timeout = 5000, interval = 100): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
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
        advance: (ms: number) => { currentTime += ms; },
        set: (time: number) => { currentTime = time; },
        reset: () => { currentTime = startTime; }
    };
};

// ================================================================================================
// EXPORTS
// ================================================================================================

export {
    TestDataStore,
    TestStateManager,
    TestEnvironment,
    createTestDataFactory,
    waitForCondition,
    createMockTimer
};
