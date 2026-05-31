import { validateMockContract } from './mock-validation';
import testClock from './test-clock';
import { nextTestId } from './test-id';
import { isMockFunction, type TestMockFn } from './bun-mock-utils';

type MockObject = object & {
    _mockType?: string;
};

type LifecycleOptions = {
    autoValidate?: boolean;
    contractName?: string | undefined;
    autoCleanup?: boolean;
    reuseStrategy?: string;
};

type ResolvedLifecycleOptions = {
    autoValidate: boolean;
    contractName: string | undefined;
    autoCleanup: boolean;
    reuseStrategy: string;
};

type CleanupOptions = {
    clearCalls?: boolean;
    resetImplementations?: boolean;
    removeFromRegistry?: boolean;
    validateAfterCleanup?: boolean;
};

type ResolvedCleanupOptions = {
    clearCalls: boolean;
    resetImplementations: boolean;
    removeFromRegistry: boolean;
    validateAfterCleanup: boolean;
};

type AutomatedCleanupOptions = {
    clearCallsBeforeEach?: boolean;
    resetImplementationsAfterEach?: boolean;
    validateAfterCleanup?: boolean;
    logPerformanceMetrics?: boolean;
};

type ResolvedAutomatedCleanupOptions = Required<AutomatedCleanupOptions>;

type CleanupHooks = {
    beforeEach: () => void;
    afterEach: () => void;
    afterAll: () => void;
};

type MockLifecycleEntry = {
    mock: MockObject;
    options: ResolvedLifecycleOptions;
    createdAt: number;
    lastUsed: number;
    useCount: number;
};

type MockStats = {
    created: number;
    cleaned: number;
    used: number;
};

type PerformanceMetrics = {
    totalMocksCreated: number;
    totalCleanupOperations: number;
    averageCleanupTime: number;
};

type MemoryEstimate = {
    totalMocks: number;
    totalFunctions: number;
    estimatedBytes: number;
};

type LifecycleMetrics = PerformanceMetrics & {
    activeMocks: number;
    mockStats: Record<string, MockStats>;
    memoryUsage: MemoryEstimate;
};

type IsolationResult = {
    isolated: boolean;
    issues: string[];
    warnings: string[];
    checkedMocks: number;
};

type MockWithImplementationReader = TestMockFn & {
    getMockImplementation?: () => unknown;
};

type MockReuseOptions = {
    maxUses?: number;
    clearCallsBetweenUses?: boolean;
    resetAfterMaxUses?: boolean;
};

type ResolvedMockReuseOptions = Required<MockReuseOptions>;

type MockReuseStats = {
    totalCachedMocks: number;
    totalAccesses: number;
    averageUsesPerMock: number;
};

type MockReuseKey<TMock extends object> = string & {
    readonly __mockReuseValue?: TMock;
};

type FactoryResults<TFactories extends readonly (() => object)[]> = {
    -readonly [Index in keyof TFactories]: TFactories[Index] extends () => infer TMock
        ? TMock extends object
            ? TMock
            : never
        : never;
};

type ArgsAfterMocks<AllArgs extends unknown[], TMocks extends unknown[]> = AllArgs extends [...TMocks, ...infer Args]
    ? Args
    : never;

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};

const getMockType = (mockObject: object): string | undefined => {
    if (!isRecord(mockObject)) {
        return undefined;
    }

    const mockType = mockObject._mockType;
    return typeof mockType === 'string' ? mockType : undefined;
};

const hasImplementationReader = (mockFn: TestMockFn): mockFn is MockWithImplementationReader => {
    return 'getMockImplementation' in mockFn && typeof mockFn.getMockImplementation === 'function';
};

const defaultPerformanceMetrics = (): PerformanceMetrics => ({
    totalMocksCreated: 0,
    totalCleanupOperations: 0,
    averageCleanupTime: 0
});

const createMockReuseKey = <TMock extends object>(cacheKey: string): MockReuseKey<TMock> => {
    return cacheKey as MockReuseKey<TMock>;
};

class MockLifecycleManager {
    private activeMocks: Map<string, MockLifecycleEntry>;
    private mockStats: Map<string, MockStats>;
    private cleanupCallbacks: Array<() => void>;
    private performanceMetrics: PerformanceMetrics;

    constructor() {
        this.activeMocks = new Map();
        this.mockStats = new Map();
        this.cleanupCallbacks = [];
        this.performanceMetrics = defaultPerformanceMetrics();
    }

    registerMock<TMock extends object>(mockId: string, mockObject: TMock, options: LifecycleOptions = {}): TMock {
        const defaultOptions: ResolvedLifecycleOptions = {
            autoValidate: true,
            contractName: getMockType(mockObject),
            autoCleanup: true,
            reuseStrategy: 'none',
            ...options
        };

        if (defaultOptions.autoValidate && defaultOptions.contractName) {
            const validation = validateMockContract(mockObject, defaultOptions.contractName);
            if (!validation.success) {
                console.warn(`Mock validation failed for ${mockId}:`, validation.errors);
            }
        }

        this.activeMocks.set(mockId, {
            mock: mockObject,
            options: defaultOptions,
            createdAt: testClock.now(),
            lastUsed: testClock.now(),
            useCount: 0
        });

        this.performanceMetrics.totalMocksCreated++;
        this._updateMockStats(mockId, 'created');

        return mockObject;
    }

    getMock<TMock extends object = MockObject>(mockId: string): TMock | null {
        const mockData = this.activeMocks.get(mockId);
        if (!mockData) {
            return null;
        }

        mockData.lastUsed = testClock.now();
        mockData.useCount++;
        this._updateMockStats(mockId, 'used');
        return mockData.mock as TMock;
    }

    cleanup(mockId: string | null = null, cleanupOptions: CleanupOptions = {}): void {
        const startTime = testClock.now();
        const defaultCleanupOptions: ResolvedCleanupOptions = {
            clearCalls: true,
            resetImplementations: false,
            removeFromRegistry: false,
            validateAfterCleanup: false,
            ...cleanupOptions
        };

        if (mockId) {
            this._cleanupSingleMock(mockId, defaultCleanupOptions);
        } else {
            this._cleanupAllMocks(defaultCleanupOptions);
        }

        const cleanupTime = testClock.now() - startTime;
        this.performanceMetrics.totalCleanupOperations++;
        this._updateAverageCleanupTime(cleanupTime);
    }

    _cleanupSingleMock(mockId: string, options: ResolvedCleanupOptions): void {
        const mockData = this.activeMocks.get(mockId);
        if (!mockData) {
            return;
        }

        const { mock } = mockData;

        if (options.clearCalls) {
            this._clearMockCalls(mock);
        }

        if (options.resetImplementations) {
            this._resetMockImplementations(mock);
        }

        if (options.validateAfterCleanup && mockData.options.contractName) {
            const validation = validateMockContract(mock, mockData.options.contractName);
            if (!validation.success) {
                console.warn(`Mock validation failed after cleanup for ${mockId}:`, validation.errors);
            }
        }

        if (options.removeFromRegistry) {
            this.activeMocks.delete(mockId);
        }

        this._updateMockStats(mockId, 'cleaned');
    }

    _cleanupAllMocks(options: ResolvedCleanupOptions): void {
        for (const mockId of this.activeMocks.keys()) {
            this._cleanupSingleMock(mockId, { ...options, removeFromRegistry: false });
        }

        if (options.removeFromRegistry) {
            this.activeMocks.clear();
        }
    }

    _clearMockCalls(mockObject: object): void {
        if (!isRecord(mockObject)) {
            return;
        }

        Object.keys(mockObject).forEach((key) => {
            const value = mockObject[key];
            if (isMockFunction(value)) {
                value.mockClear();
            }
        });
    }

    _resetMockImplementations(mockObject: object): void {
        if (!isRecord(mockObject)) {
            return;
        }

        Object.keys(mockObject).forEach((key) => {
            const value = mockObject[key];
            if (isMockFunction(value)) {
                value.mockReset();
            }
        });
    }

    _updateMockStats(mockId: string, operation: keyof MockStats): void {
        const stats = this.mockStats.get(mockId) ?? {
            created: 0,
            cleaned: 0,
            used: 0
        };

        stats[operation]++;
        this.mockStats.set(mockId, stats);
    }

    _updateAverageCleanupTime(cleanupTime: number): void {
        const { totalCleanupOperations, averageCleanupTime } = this.performanceMetrics;
        this.performanceMetrics.averageCleanupTime =
            ((averageCleanupTime * (totalCleanupOperations - 1)) + cleanupTime) / totalCleanupOperations;
    }

    addCleanupCallback(callback: () => void): void {
        this.cleanupCallbacks.push(callback);
    }

    executeCleanupCallbacks(): void {
        this.cleanupCallbacks.forEach((callback) => {
            try {
                callback();
            } catch (error) {
                console.warn('Cleanup callback failed:', error);
            }
        });
    }

    getPerformanceMetrics(): LifecycleMetrics {
        return {
            ...this.performanceMetrics,
            activeMocks: this.activeMocks.size,
            mockStats: Object.fromEntries(this.mockStats),
            memoryUsage: this._estimateMemoryUsage()
        };
    }

    _estimateMemoryUsage(): MemoryEstimate {
        let totalMocks = 0;
        let totalFunctions = 0;

        this.activeMocks.forEach((mockData) => {
            totalMocks++;
            if (!isRecord(mockData.mock)) {
                return;
            }

            const mockRecord: Record<string, unknown> = mockData.mock;
            Object.keys(mockRecord).forEach((key) => {
                if (isMockFunction(mockRecord[key])) {
                    totalFunctions++;
                }
            });
        });

        return {
            totalMocks,
            totalFunctions,
            estimatedBytes: (totalMocks * 1024) + (totalFunctions * 256)
        };
    }

    reset(): void {
        this.cleanup(null, { removeFromRegistry: true });
        this.mockStats.clear();
        this.cleanupCallbacks = [];
        this.performanceMetrics = defaultPerformanceMetrics();
    }
}

const globalLifecycleManager = new MockLifecycleManager();

const setupAutomatedCleanup = (options: AutomatedCleanupOptions = {}): CleanupHooks => {
    const defaultOptions: ResolvedAutomatedCleanupOptions = {
        clearCallsBeforeEach: true,
        resetImplementationsAfterEach: false,
        validateAfterCleanup: false,
        logPerformanceMetrics: false,
        ...options
    };

    return {
        beforeEach: () => {
            if (defaultOptions.clearCallsBeforeEach) {
                globalLifecycleManager.cleanup(null, {
                    clearCalls: true,
                    resetImplementations: false,
                    validateAfterCleanup: defaultOptions.validateAfterCleanup
                });
            }
        },

        afterEach: () => {
            if (defaultOptions.resetImplementationsAfterEach) {
                globalLifecycleManager.cleanup(null, {
                    clearCalls: false,
                    resetImplementations: true,
                    validateAfterCleanup: defaultOptions.validateAfterCleanup
                });
            }
            globalLifecycleManager.executeCleanupCallbacks();
        },

        afterAll: () => {
            if (defaultOptions.logPerformanceMetrics) {
                const metrics = globalLifecycleManager.getPerformanceMetrics();
                console.log('Mock Lifecycle Performance Metrics:', JSON.stringify(metrics, null, 2));
            }
        }
    };
};

const withLifecycleManagement = <Args extends unknown[], TMock extends object>(
    factoryFunction: (...args: Args) => TMock,
    mockType: string,
    lifecycleOptions: LifecycleOptions = {}
) => {
    return (...args: Args): TMock => {
        const mockObject = factoryFunction(...args);
        const mockId = nextTestId(mockType);

        return globalLifecycleManager.registerMock(mockId, mockObject, {
            contractName: mockType,
            ...lifecycleOptions
        });
    };
};

const createManagedMock = <TMock extends object>(mockObject: TMock, options: LifecycleOptions = {}): TMock => {
    const mockId = nextTestId('managed');
    return globalLifecycleManager.registerMock(mockId, mockObject, options);
};

const checkMockIsolation = (mocksToCheck: object[]): IsolationResult => {
    const issues: string[] = [];
    const warnings: string[] = [];

    mocksToCheck.forEach((mock, index) => {
        if (!isRecord(mock)) {
            return;
        }

        Object.keys(mock).forEach((key) => {
            const mockFn = mock[key];
            if (!isMockFunction(mockFn)) {
                return;
            }

            if (mockFn.mock.calls.length > 0) {
                issues.push(`Mock ${index}.${key} has ${mockFn.mock.calls.length} residual calls`);
            }

            if (hasImplementationReader(mockFn) && mockFn.getMockImplementation?.()) {
                warnings.push(`Mock ${index}.${key} has custom implementation that may retain state`);
            }
        });
    });

    return {
        isolated: issues.length === 0,
        issues,
        warnings,
        checkedMocks: mocksToCheck.length
    };
};

function withMockIsolation<
    const TFactories extends readonly (() => object)[],
    AllArgs extends [...FactoryResults<TFactories>, ...unknown[]],
    Result
>(
    testFunction: (...args: AllArgs) => Result | Promise<Result>,
    mockFactories: TFactories
): (...args: ArgsAfterMocks<AllArgs, FactoryResults<TFactories>>) => Promise<Awaited<Result>>;
function withMockIsolation<Args extends unknown[], Result>(
    testFunction: (...args: Args) => Result | Promise<Result>,
    mockFactories?: Array<() => object>
): (...args: Args) => Promise<Awaited<Result>>;
function withMockIsolation(
    testFunction: (...args: unknown[]) => unknown,
    mockFactories: Array<() => object> = []
) {
    return async (...args: unknown[]) => {
        const freshMocks = mockFactories.map((factory) => factory());

        try {
            const result = await testFunction(...freshMocks, ...args);

            const isolationCheck = checkMockIsolation(freshMocks);
            if (!isolationCheck.isolated) {
                console.warn('Mock isolation issues detected:', isolationCheck.issues);
            }

            return result;
        } finally {
            freshMocks.forEach((mock) => {
                if (getMockType(mock)) {
                    globalLifecycleManager._clearMockCalls(mock);
                }
            });
        }
    };
}

class MockReuseCache {
    private cache: Map<string, object>;
    private accessCount: Map<string, number>;

    constructor() {
        this.cache = new Map();
        this.accessCount = new Map();
    }

    getOrCreate<TMock extends object>(
        cacheKey: MockReuseKey<TMock>,
        factoryFunction: () => TMock,
        reuseOptions?: MockReuseOptions
    ): TMock;
    getOrCreate(
        cacheKey: string,
        factoryFunction: () => object,
        reuseOptions?: MockReuseOptions
    ): object;
    getOrCreate(
        cacheKey: string,
        factoryFunction: () => object,
        reuseOptions: MockReuseOptions = {}
    ): object {
        const defaultReuseOptions: ResolvedMockReuseOptions = {
            maxUses: 100,
            clearCallsBetweenUses: true,
            resetAfterMaxUses: true,
            ...reuseOptions
        };

        if (this.cache.has(cacheKey)) {
            const cachedMock = this.cache.get(cacheKey);
            const accessCount = this.accessCount.get(cacheKey) ?? 0;

            if (!cachedMock) {
                this.accessCount.delete(cacheKey);
                return this.getOrCreate(cacheKey, factoryFunction, reuseOptions);
            }

            if (accessCount >= defaultReuseOptions.maxUses && defaultReuseOptions.resetAfterMaxUses) {
                this.cache.delete(cacheKey);
                this.accessCount.delete(cacheKey);
                return this.getOrCreate(cacheKey, factoryFunction, reuseOptions);
            }

            if (defaultReuseOptions.clearCallsBetweenUses) {
                globalLifecycleManager._clearMockCalls(cachedMock);
            }

            this.accessCount.set(cacheKey, accessCount + 1);
            return cachedMock;
        }

        const newMock = factoryFunction();
        this.cache.set(cacheKey, newMock);
        this.accessCount.set(cacheKey, 1);
        return newMock;
    }

    clear(): void {
        this.cache.clear();
        this.accessCount.clear();
    }

    getStats(): MockReuseStats {
        const totalAccesses = Array.from(this.accessCount.values()).reduce((sum, count) => sum + count, 0);

        return {
            totalCachedMocks: this.cache.size,
            totalAccesses,
            averageUsesPerMock: this.cache.size > 0 ? totalAccesses / this.cache.size : 0
        };
    }
}

const globalMockCache = new MockReuseCache();

export {
    type LifecycleOptions,
    type CleanupOptions,
    type LifecycleMetrics,
    type IsolationResult,
    type MockReuseOptions,
    type MockReuseKey,

    MockLifecycleManager,
    globalLifecycleManager,

    setupAutomatedCleanup,

    withLifecycleManagement,
    createManagedMock,

    checkMockIsolation,
    withMockIsolation,

    MockReuseCache,
    createMockReuseKey,
    globalMockCache
};
