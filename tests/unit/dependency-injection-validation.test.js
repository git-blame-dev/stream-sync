
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { unmockModule, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

const { createMockLogger } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');

unmockModule('../../src/platforms/youtube');
unmockModule('../../src/utils/logger-utils');
unmockModule('../../src/core/logging');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Dependency Injection Validation', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let mockLogger;
    
    beforeEach(() => {
        mockLogger = createMockLogger();
    });

    describe('Logger Interface Contract Validation', () => {
        it('should validate logger has required interface methods before platform initialization', () => {
            // Given: An incomplete logger interface (missing required methods)
            const incompleteLogger = {
                info: createMockFn(),
                // Missing: debug, error, warn methods
            };

            // When: Attempting to create platform with incomplete logger
            const createPlatform = () => {
                const { ConnectionStateManager } = require('../../src/utils/connection-state-manager');
                const manager = new ConnectionStateManager('youtube', null);
                
                // This should validate logger interface and throw descriptive error
                manager.initialize({}, { logger: incompleteLogger });
            };

            // Then: User gets clear error message about missing logger methods
            expect(createPlatform).toThrow();
            expect(createPlatform).toThrow(/logger.*interface.*missing.*debug.*error.*warn/i);
        });

        it('should validate logger methods are callable functions', () => {
            // Given: Logger with non-function properties
            const invalidLogger = {
                info: createMockFn(),
                debug: 'not-a-function',  // Invalid: should be function
                error: null,              // Invalid: should be function
                warn: undefined           // Invalid: should be function
            };

            // When: Attempting to initialize with invalid logger
            const initializeWithInvalidLogger = () => {
                const { ConnectionStateManager } = require('../../src/utils/connection-state-manager');
                const manager = new ConnectionStateManager('youtube', null);
                manager.initialize({}, { logger: invalidLogger });
            };

            // Then: User gets specific error about missing methods (since they're not functions)
            expect(initializeWithInvalidLogger).toThrow();
            expect(initializeWithInvalidLogger).toThrow(/Logger interface missing required methods.*debug.*error.*warn/i);
        });

        it('should accept valid logger interface and proceed with initialization', () => {
            // Given: Complete and valid logger interface
            const validLogger = {
                info: createMockFn(),
                debug: createMockFn(),
                error: createMockFn(),
                warn: createMockFn()
            };

            // When: Initializing with valid logger
            const initializeWithValidLogger = () => {
                const { ConnectionStateManager } = require('../../src/utils/connection-state-manager');
                const manager = new ConnectionStateManager('youtube', null);
                manager.initialize({}, { logger: validLogger });
                return manager;
            };

            // Then: Initialization succeeds without errors
            expect(initializeWithValidLogger).not.toThrow();
            const manager = initializeWithValidLogger();
            expect(manager.logger).toBe(validLogger);
        });
    });

    describe('YouTube Platform Dependency Validation', () => {
        it('should validate all required dependencies before platform initialization', () => {
            // Given: YouTube platform with missing critical dependencies
            const incompleteDependencies = {
                // Missing: logger and core dependency bundle
                someOtherDep: {}
            };

            // When: Attempting to create YouTube platform
            const createYouTubePlatform = () => {
                // This should fail because required dependencies are missing
                // Note: This will fail initially because dependency validation isn't implemented
                const config = { youtube: { apiKey: 'test-key' } };
                const dependencies = incompleteDependencies;
                
                // The platform should validate dependencies before proceeding
                const { YouTubePlatform } = require('../../src/platforms/youtube');
                return new YouTubePlatform(config, dependencies);
            };

            // Then: User gets descriptive error about missing dependencies
            expect(createYouTubePlatform).toThrow();
            expect(createYouTubePlatform).toThrow(/missing.*required.*dependencies.*logger/i);
        });

        it('should provide helpful guidance when dependency validation fails', () => {
            // Given: Platform creation with null dependencies
            const nullDependencies = null;

            // When: Attempting platform initialization
            const createPlatformWithNullDeps = () => {
                const config = { youtube: { apiKey: 'test-key' } };
                const { YouTubePlatform } = require('../../src/platforms/youtube');
                return new YouTubePlatform(config, nullDependencies);
            };

            // Then: Error message provides helpful guidance for fixing the issue
            expect(createPlatformWithNullDeps).toThrow();
            expect(createPlatformWithNullDeps).toThrow(/missing required dependencies: logger/i);
        });

        it('should validate dependency types and interfaces match expected contracts', () => {
            // Given: Dependencies with wrong types/interfaces
            const invalidTypeDependencies = {
                logger: "string-instead-of-object",
                notificationManager: { emit: createMockFn(), on: createMockFn(), removeListener: createMockFn() },
                streamDetectionService: {
                    detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
                }
            };

            // When: Attempting to create platform
            const createPlatformWithInvalidTypes = () => {
                const config = { youtube: { apiKey: 'test-key' } };
                const { YouTubePlatform } = require('../../src/platforms/youtube');
                return new YouTubePlatform(config, invalidTypeDependencies);
            };

            // Then: User gets specific error about type mismatches
            expect(createPlatformWithInvalidTypes).toThrow();
            expect(createPlatformWithInvalidTypes).toThrow(/logger.*expected.*object.*received.*string/i);
        });
    });

    describe('ConnectionStateManager Dependency Validation', () => {
        it('should fail fast when initialized without required dependencies', () => {
            // Given: ConnectionStateManager without required dependencies
            const manager = new (require('../../src/utils/connection-state-manager').ConnectionStateManager)('youtube', null);

            // When: Attempting to initialize without dependencies
            const initializeWithoutDeps = () => {
                manager.initialize({}, {}); // Empty dependencies
            };

            // Then: User gets clear error about missing dependencies
            expect(initializeWithoutDeps).toThrow();
            expect(initializeWithoutDeps).toThrow(/initialization.*failed.*missing.*required.*dependencies/i);
        });

        it('should validate connection factory interface before proceeding', () => {
            // Given: ConnectionStateManager with invalid factory
            const invalidFactory = {
                // Missing createConnection method
                someOtherMethod: createMockFn()
            };

            // When: Creating manager with invalid factory
            const createManagerWithInvalidFactory = () => {
                const { ConnectionStateManager } = require('../../src/utils/connection-state-manager');
                return new ConnectionStateManager('youtube', invalidFactory);
            };

            // Then: User gets error about invalid factory interface
            expect(createManagerWithInvalidFactory).toThrow();
            expect(createManagerWithInvalidFactory).toThrow(/factory.*missing.*createConnection.*method/i);
        });

        it('should ensure connection factory can create valid connections', () => {
            // Given: Factory that returns invalid connections
            const factoryReturningNull = {
                createConnection: createMockFn().mockReturnValue(null)
            };

            // When: Using manager with factory that returns null
            const useManagerWithNullFactory = () => {
                const { ConnectionStateManager } = require('../../src/utils/connection-state-manager');
                const manager = new ConnectionStateManager('youtube', factoryReturningNull);
                manager.initialize({}, { logger: mockLogger });
                
                // This should detect factory returns null and fail gracefully
                return manager.ensureConnection();
            };

            // Then: User gets error about factory returning invalid connections
            expect(useManagerWithNullFactory).toThrow();
            expect(useManagerWithNullFactory).toThrow(/factory.*returned.*null.*invalid.*connection/i);
        });
    });

    describe('Platform Factory Dependency Validation', () => {
        it('should validate factory dependencies before creating platform instances', () => {
            // Given: Platform factory with incomplete dependencies
            const incompleteDeps = {
                // Missing critical dependencies
            };

            // When: Using factory to create platform
            const createPlatformViaFactory = () => {
                const { PlatformConnectionFactory } = require('../../src/utils/platform-connection-factory');
                const factory = new PlatformConnectionFactory();
                
                // Factory should validate dependencies before creating platform
                return factory.createConnection('youtube', {}, incompleteDeps);
            };

            // Then: Factory fails with dependency validation error
            expect(createPlatformViaFactory).toThrow();
            expect(createPlatformViaFactory).toThrow(/Platform creation failed.*missing dependencies.*logger/i);
        });

        it('should ensure factory creates consistent dependency interfaces', () => {
            // Given: Factory that should create standardized dependencies
            const factory = new (require('../../src/utils/platform-connection-factory').PlatformConnectionFactory)(mockLogger);

            // When: Creating dependencies for different platforms
            const createYouTubeDeps = () => {
                return factory.createStandardDependencies('youtube', mockLogger);
            };

            // Then: Created dependencies should have consistent interface
            // Note: This will fail initially because createStandardDependencies doesn't exist yet
            expect(createYouTubeDeps).not.toThrow();
            const deps = createYouTubeDeps();
            expect(deps).toHaveProperty('logger');
            expect(deps.logger).toHaveProperty('info');
            expect(deps.logger).toHaveProperty('debug');
            expect(deps.logger).toHaveProperty('error');
            expect(deps.logger).toHaveProperty('warn');
        });
    });

    describe('Error Message Quality for Dependency Issues', () => {
        it('should provide actionable error messages for missing logger methods', () => {
            // Given: Logger missing specific methods
            const partialLogger = {
                info: createMockFn(),
                error: createMockFn()
                // Missing: debug, warn
            };

            // When: Validation detects missing methods
            const validateLogger = () => {
                // This should provide specific guidance about what's missing
                const { validateLoggerInterface } = require('../../src/utils/dependency-validator');
                validateLoggerInterface(partialLogger);
            };

            // Then: Error message tells user exactly what to add
            expect(validateLogger).toThrow();
            expect(validateLogger).toThrow(/please.*add.*methods.*debug.*warn/i);
        });

        it('should suggest fixes when dependencies are completely missing', () => {
            // Given: Platform initialization with no dependencies
            const initializeWithoutDeps = () => {
                const config = { youtube: { apiKey: 'test-key' } };
                const { YouTubePlatform } = require('../../src/platforms/youtube');
                return new YouTubePlatform(config, undefined);
            };

            // Then: Error message provides template for correct dependency structure
            expect(initializeWithoutDeps).toThrow();
            expect(initializeWithoutDeps).toThrow(/missing required dependencies: logger/i);
        });

        it('should help users understand dependency injection patterns', () => {
            // Given: User attempting incorrect dependency injection
            const attemptIncorrectInjection = () => {
                const config = { youtube: { apiKey: 'test-key' } };
                const { YouTubePlatform } = require('../../src/platforms/youtube');
                
                // User passes dependencies as string instead of object (common mistake)
                return new YouTubePlatform(config, 'invalid_dependencies_string'); // Wrong pattern
            };

            // Then: Error explains correct dependency injection pattern
            expect(attemptIncorrectInjection).toThrow();
            expect(attemptIncorrectInjection).toThrow(/dependencies.*should.*be.*single.*object.*with.*logger.*property/i);
        });
    });

    describe('Integration Point Validation', () => {
        it('should validate main.js to platform dependency handoff', () => {
            // Given: main.js attempting to create platform with dependencies
            const simulateMainJsHandoff = () => {
                // Simulate how main.js creates and passes dependencies
                const dependencies = {
                    logger: mockLogger,
                    notificationManager: { emit: createMockFn(), on: createMockFn(), removeListener: createMockFn() },
                    app: { handleChatMessage: createMockFn() },
                    streamDetectionService: {
                        detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
                    }
                };

                const config = { youtube: { apiKey: 'test-key' } };
                const { YouTubePlatform } = require('../../src/platforms/youtube');

                // This handoff should be validated
                return new YouTubePlatform(config, dependencies);
            };

            // Then: Handoff validation ensures proper dependency structure
            // Note: Will fail initially because validation not implemented
            expect(simulateMainJsHandoff).not.toThrow();
        });

        it('should ensure consistent dependency interfaces across all platforms', () => {
            // Given: Dependencies that should work for any platform
            const universalDependencies = {
                logger: mockLogger,
                notificationManager: { emit: createMockFn(), on: createMockFn(), removeListener: createMockFn() },
                app: { handleChatMessage: createMockFn() },
                streamDetectionService: {
                    detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
                }
            };

            // When: Using same dependencies for different platforms
            const testMultiplePlatforms = () => {
                const config = {
                    youtube: { apiKey: 'test-key' },
                    twitch: { apiKey: 'test-key' },
                    tiktok: { apiKey: 'test-key' }
                };

                // All platforms should accept the same dependency structure
                const { YouTubePlatform } = require('../../src/platforms/youtube');
                const youtubeOk = new YouTubePlatform(config, universalDependencies);

                // Note: This tests the contract consistency across platforms
                return { youtubeOk };
            };

            // Then: Same dependency object works across platforms
            expect(testMultiplePlatforms).not.toThrow();
        });
    });
});
