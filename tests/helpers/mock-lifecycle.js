
const { validateMockContract } = require('./mock-validation');

// ================================================================================================
// MOCK LIFECYCLE MANAGER
// ================================================================================================

class MockLifecycleManager {
    constructor() {
        this.activeMocks = new Map();
        this.mockStats = new Map();
        this.cleanupCallbacks = [];
        this.performanceMetrics = {
            totalMocksCreated: 0,
            totalCleanupOperations: 0,
            averageCleanupTime: 0
        };
    }

    registerMock(mockId, mockObject, options = {}) {
        const defaultOptions = {
            autoValidate: true,
            contractName: mockObject._mockType,
            autoCleanup: true,
            reuseStrategy: 'none', // 'none', 'test', 'suite'
            ...options
        };

        // Validate mock if requested
        if (defaultOptions.autoValidate && defaultOptions.contractName) {
            const validation = validateMockContract(mockObject, defaultOptions.contractName);
            if (!validation.success) {
                console.warn(`Mock validation failed for ${mockId}:`, validation.errors);
            }
        }

        // Register mock with metadata
        this.activeMocks.set(mockId, {
            mock: mockObject,
            options: defaultOptions,
            createdAt: Date.now(),
            lastUsed: Date.now(),
            useCount: 0
        });

        // Update stats
        this.performanceMetrics.totalMocksCreated++;
        this._updateMockStats(mockId, 'created');

        return mockObject;
    }

    getMock(mockId) {
        const mockData = this.activeMocks.get(mockId);
        if (mockData) {
            mockData.lastUsed = Date.now();
            mockData.useCount++;
            return mockData.mock;
        }
        return null;
    }

    cleanup(mockId = null, cleanupOptions = {}) {
        const startTime = Date.now();
        const defaultCleanupOptions = {
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

        // Update performance metrics
        const cleanupTime = Date.now() - startTime;
        this.performanceMetrics.totalCleanupOperations++;
        this._updateAverageCleanupTime(cleanupTime);
    }

    _cleanupSingleMock(mockId, options) {
        const mockData = this.activeMocks.get(mockId);
        if (!mockData) return;

        const { mock } = mockData;

        // Clear mock call history
        if (options.clearCalls) {
            this._clearMockCalls(mock);
        }

        // Reset mock implementations
        if (options.resetImplementations) {
            this._resetMockImplementations(mock);
        }

        // Validate mock after cleanup
        if (options.validateAfterCleanup && mockData.options.contractName) {
            const validation = validateMockContract(mock, mockData.options.contractName);
            if (!validation.success) {
                console.warn(`Mock validation failed after cleanup for ${mockId}:`, validation.errors);
            }
        }

        // Remove from registry if requested
        if (options.removeFromRegistry) {
            this.activeMocks.delete(mockId);
        }

        this._updateMockStats(mockId, 'cleaned');
    }

    _cleanupAllMocks(options) {
        for (const mockId of this.activeMocks.keys()) {
            this._cleanupSingleMock(mockId, { ...options, removeFromRegistry: false });
        }

        if (options.removeFromRegistry) {
            this.activeMocks.clear();
        }
    }

    _clearMockCalls(mockObject) {
        Object.keys(mockObject).forEach(key => {
            if (jest.isMockFunction(mockObject[key])) {
                mockObject[key].mockClear();
            }
        });
    }

    _resetMockImplementations(mockObject) {
        Object.keys(mockObject).forEach(key => {
            if (jest.isMockFunction(mockObject[key])) {
                mockObject[key].mockReset();
            }
        });
    }

    _updateMockStats(mockId, operation) {
        if (!this.mockStats.has(mockId)) {
            this.mockStats.set(mockId, {
                created: 0,
                cleaned: 0,
                used: 0
            });
        }
        
        this.mockStats.get(mockId)[operation]++;
    }

    _updateAverageCleanupTime(cleanupTime) {
        const { totalCleanupOperations, averageCleanupTime } = this.performanceMetrics;
        this.performanceMetrics.averageCleanupTime = 
            ((averageCleanupTime * (totalCleanupOperations - 1)) + cleanupTime) / totalCleanupOperations;
    }

    addCleanupCallback(callback) {
        this.cleanupCallbacks.push(callback);
    }

    executeCleanupCallbacks() {
        this.cleanupCallbacks.forEach(callback => {
            try {
                callback();
            } catch (error) {
                console.warn('Cleanup callback failed:', error);
            }
        });
    }

    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            activeMocks: this.activeMocks.size,
            mockStats: Object.fromEntries(this.mockStats),
            memoryUsage: this._estimateMemoryUsage()
        };
    }

    _estimateMemoryUsage() {
        let totalMocks = 0;
        let totalFunctions = 0;

        this.activeMocks.forEach(mockData => {
            totalMocks++;
            Object.keys(mockData.mock).forEach(key => {
                if (jest.isMockFunction(mockData.mock[key])) {
                    totalFunctions++;
                }
            });
        });

        return {
            totalMocks,
            totalFunctions,
            estimatedBytes: (totalMocks * 1024) + (totalFunctions * 256) // Rough estimation
        };
    }

    reset() {
        this.cleanup(null, { removeFromRegistry: true });
        this.mockStats.clear();
        this.cleanupCallbacks = [];
        this.performanceMetrics = {
            totalMocksCreated: 0,
            totalCleanupOperations: 0,
            averageCleanupTime: 0
        };
    }
}

// ================================================================================================
// GLOBAL LIFECYCLE MANAGER INSTANCE
// ================================================================================================

const globalLifecycleManager = new MockLifecycleManager();

// ================================================================================================
// AUTOMATED CLEANUP HOOKS
// ================================================================================================

const setupAutomatedCleanup = (options = {}) => {
    const defaultOptions = {
        clearCallsBeforeEach: true,
        resetImplementationsAfterEach: false,
        validateAfterCleanup: false,
        logPerformanceMetrics: false,
        ...options
    };

    // Return cleanup functions that can be called manually in proper Jest lifecycle
    const cleanup = {
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
            // Execute custom cleanup callbacks
            globalLifecycleManager.executeCleanupCallbacks();
        },
        
        afterAll: () => {
            if (defaultOptions.logPerformanceMetrics) {
                const metrics = globalLifecycleManager.getPerformanceMetrics();
                console.log('Mock Lifecycle Performance Metrics:', JSON.stringify(metrics, null, 2));
            }
        }
    };

    return cleanup;
};

// ================================================================================================
// CONVENIENT FACTORY INTEGRATION
// ================================================================================================

const withLifecycleManagement = (factoryFunction, mockType, lifecycleOptions = {}) => {
    return (...args) => {
        const mockObject = factoryFunction(...args);
        const mockId = `${mockType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        return globalLifecycleManager.registerMock(mockId, mockObject, {
            contractName: mockType,
            ...lifecycleOptions
        });
    };
};

const createManagedMock = (mockObject, options = {}) => {
    const mockId = `managed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return globalLifecycleManager.registerMock(mockId, mockObject, options);
};

// ================================================================================================
// MOCK ISOLATION UTILITIES
// ================================================================================================

const checkMockIsolation = (mocksToCheck) => {
    const issues = [];
    const warnings = [];

    mocksToCheck.forEach((mock, index) => {
        Object.keys(mock).forEach(key => {
            if (jest.isMockFunction(mock[key])) {
                const mockFn = mock[key];
                
                // Check for unexpected call history
                if (mockFn.mock.calls.length > 0) {
                    issues.push(`Mock ${index}.${key} has ${mockFn.mock.calls.length} residual calls`);
                }

                // Check for custom implementations that might leak state
                if (mockFn.getMockImplementation && mockFn.getMockImplementation()) {
                    warnings.push(`Mock ${index}.${key} has custom implementation that may retain state`);
                }
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

const withMockIsolation = (testFunction, mockFactories = []) => {
    return async (...args) => {
        // Create fresh mocks for this test
        const freshMocks = mockFactories.map(factory => factory());
        
        // Execute test with fresh mocks
        try {
            const result = await testFunction(...freshMocks, ...args);
            
            // Verify isolation after test
            const isolationCheck = checkMockIsolation(freshMocks);
            if (!isolationCheck.isolated) {
                console.warn('Mock isolation issues detected:', isolationCheck.issues);
            }
            
            return result;
        } finally {
            // Clean up fresh mocks
            freshMocks.forEach(mock => {
                if (mock._mockType) {
                    globalLifecycleManager._clearMockCalls(mock);
                }
            });
        }
    };
};

// ================================================================================================
// PERFORMANCE OPTIMIZATION
// ================================================================================================

class MockReuseCache {
    constructor() {
        this.cache = new Map();
        this.accessCount = new Map();
    }

    getOrCreate(cacheKey, factoryFunction, reuseOptions = {}) {
        const defaultReuseOptions = {
            maxUses: 100,
            clearCallsBetweenUses: true,
            resetAfterMaxUses: true,
            ...reuseOptions
        };

        if (this.cache.has(cacheKey)) {
            const cachedMock = this.cache.get(cacheKey);
            const accessCount = this.accessCount.get(cacheKey) || 0;

            // Check if we've exceeded max uses
            if (accessCount >= defaultReuseOptions.maxUses && defaultReuseOptions.resetAfterMaxUses) {
                this.cache.delete(cacheKey);
                this.accessCount.delete(cacheKey);
                return this.getOrCreate(cacheKey, factoryFunction, reuseOptions);
            }

            // Clear calls if requested
            if (defaultReuseOptions.clearCallsBetweenUses) {
                globalLifecycleManager._clearMockCalls(cachedMock);
            }

            this.accessCount.set(cacheKey, accessCount + 1);
            return cachedMock;
        }

        // Create new mock and cache it
        const newMock = factoryFunction();
        this.cache.set(cacheKey, newMock);
        this.accessCount.set(cacheKey, 1);
        return newMock;
    }

    clear() {
        this.cache.clear();
        this.accessCount.clear();
    }

    getStats() {
        return {
            totalCachedMocks: this.cache.size,
            totalAccesses: Array.from(this.accessCount.values()).reduce((sum, count) => sum + count, 0),
            averageUsesPerMock: this.cache.size > 0 ? 
                Array.from(this.accessCount.values()).reduce((sum, count) => sum + count, 0) / this.cache.size : 0
        };
    }
}

const globalMockCache = new MockReuseCache();

// ================================================================================================
// EXPORTS
// ================================================================================================

module.exports = {
    // Core lifecycle management
    MockLifecycleManager,
    globalLifecycleManager,
    
    // Automated setup
    setupAutomatedCleanup,
    
    // Factory integration
    withLifecycleManagement,
    createManagedMock,
    
    // Test isolation
    checkMockIsolation,
    withMockIsolation,
    
    // Performance optimization
    MockReuseCache,
    globalMockCache
};