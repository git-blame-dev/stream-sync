const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');

describe('Dependency Injection Validation', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    describe('Logger Interface Contract Validation', () => {
        it('should validate logger has required interface methods before platform initialization', () => {
            const incompleteLogger = {
                info: createMockFn()
            };

            const createPlatform = () => {
                const { ConnectionStateManager } = require('../../src/utils/connection-state-manager');
                const manager = new ConnectionStateManager('youtube', null);
                manager.initialize({}, { logger: incompleteLogger });
            };

            expect(createPlatform).toThrow();
            expect(createPlatform).toThrow(/logger.*interface.*missing.*debug.*error.*warn/i);
        });

        it('should validate logger methods are callable functions', () => {
            const invalidLogger = {
                info: createMockFn(),
                debug: 'not-a-function',
                error: null,
                warn: undefined
            };

            const initializeWithInvalidLogger = () => {
                const { ConnectionStateManager } = require('../../src/utils/connection-state-manager');
                const manager = new ConnectionStateManager('youtube', null);
                manager.initialize({}, { logger: invalidLogger });
            };

            expect(initializeWithInvalidLogger).toThrow();
            expect(initializeWithInvalidLogger).toThrow(/Logger interface missing required methods.*debug.*error.*warn/i);
        });

        it('should accept valid logger interface and proceed with initialization', () => {
            const validLogger = {
                info: createMockFn(),
                debug: createMockFn(),
                error: createMockFn(),
                warn: createMockFn()
            };

            const initializeWithValidLogger = () => {
                const { ConnectionStateManager } = require('../../src/utils/connection-state-manager');
                const manager = new ConnectionStateManager('youtube', null);
                manager.initialize({}, { logger: validLogger });
                return manager;
            };

            expect(initializeWithValidLogger).not.toThrow();
            const manager = initializeWithValidLogger();
            expect(manager.logger).toBe(validLogger);
        });
    });

    describe('YouTube Platform Dependency Validation', () => {
        it('should validate all required dependencies before platform initialization', () => {
            const incompleteDependencies = {
                someOtherDep: {}
            };

            const createYouTubePlatform = () => {
                const config = { youtube: { apiKey: 'test-key' } };
                const { YouTubePlatform } = require('../../src/platforms/youtube');
                return new YouTubePlatform(config, incompleteDependencies);
            };

            expect(createYouTubePlatform).toThrow();
            expect(createYouTubePlatform).toThrow(/missing.*required.*dependencies.*logger/i);
        });

        it('should provide helpful guidance when dependency validation fails', () => {
            const nullDependencies = null;

            const createPlatformWithNullDeps = () => {
                const config = { youtube: { apiKey: 'test-key' } };
                const { YouTubePlatform } = require('../../src/platforms/youtube');
                return new YouTubePlatform(config, nullDependencies);
            };

            expect(createPlatformWithNullDeps).toThrow();
            expect(createPlatformWithNullDeps).toThrow(/missing required dependencies: logger/i);
        });

        it('should validate dependency types and interfaces match expected contracts', () => {
            const invalidTypeDependencies = {
                logger: "string-instead-of-object",
                notificationManager: { emit: createMockFn(), on: createMockFn(), removeListener: createMockFn() },
                streamDetectionService: {
                    detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
                }
            };

            const createPlatformWithInvalidTypes = () => {
                const config = { youtube: { apiKey: 'test-key' } };
                const { YouTubePlatform } = require('../../src/platforms/youtube');
                return new YouTubePlatform(config, invalidTypeDependencies);
            };

            expect(createPlatformWithInvalidTypes).toThrow();
            expect(createPlatformWithInvalidTypes).toThrow(/logger.*expected.*object.*received.*string/i);
        });
    });

    describe('ConnectionStateManager Dependency Validation', () => {
        it('should fail fast when initialized without required dependencies', () => {
            const manager = new (require('../../src/utils/connection-state-manager').ConnectionStateManager)('youtube', null);

            const initializeWithoutDeps = () => {
                manager.initialize({}, {});
            };

            expect(initializeWithoutDeps).toThrow();
            expect(initializeWithoutDeps).toThrow(/initialization.*failed.*missing.*required.*dependencies/i);
        });

        it('should validate connection factory interface before proceeding', () => {
            const invalidFactory = {
                someOtherMethod: createMockFn()
            };

            const createManagerWithInvalidFactory = () => {
                const { ConnectionStateManager } = require('../../src/utils/connection-state-manager');
                return new ConnectionStateManager('youtube', invalidFactory);
            };

            expect(createManagerWithInvalidFactory).toThrow();
            expect(createManagerWithInvalidFactory).toThrow(/factory.*missing.*createConnection.*method/i);
        });

        it('should ensure connection factory can create valid connections', () => {
            const factoryReturningNull = {
                createConnection: createMockFn().mockReturnValue(null)
            };

            const useManagerWithNullFactory = () => {
                const { ConnectionStateManager } = require('../../src/utils/connection-state-manager');
                const manager = new ConnectionStateManager('youtube', factoryReturningNull);
                manager.initialize({}, { logger: noOpLogger });
                return manager.ensureConnection();
            };

            expect(useManagerWithNullFactory).toThrow();
            expect(useManagerWithNullFactory).toThrow(/factory.*returned.*null.*invalid.*connection/i);
        });
    });

    describe('Platform Factory Dependency Validation', () => {
        it('should validate factory dependencies before creating platform instances', () => {
            const incompleteDeps = {};

            const createPlatformViaFactory = () => {
                const { PlatformConnectionFactory } = require('../../src/utils/platform-connection-factory');
                const factory = new PlatformConnectionFactory();
                return factory.createConnection('youtube', {}, incompleteDeps);
            };

            expect(createPlatformViaFactory).toThrow();
            expect(createPlatformViaFactory).toThrow(/Platform creation failed.*missing dependencies.*logger/i);
        });

        it('should ensure factory creates consistent dependency interfaces', () => {
            const factory = new (require('../../src/utils/platform-connection-factory').PlatformConnectionFactory)(noOpLogger);

            const createYouTubeDeps = () => {
                return factory.createStandardDependencies('youtube', noOpLogger);
            };

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
            const partialLogger = {
                info: createMockFn(),
                error: createMockFn()
            };

            const validateLogger = () => {
                const { validateLoggerInterface } = require('../../src/utils/dependency-validator');
                validateLoggerInterface(partialLogger);
            };

            expect(validateLogger).toThrow();
            expect(validateLogger).toThrow(/please.*add.*methods.*debug.*warn/i);
        });

        it('should suggest fixes when dependencies are completely missing', () => {
            const initializeWithoutDeps = () => {
                const config = { youtube: { apiKey: 'test-key' } };
                const { YouTubePlatform } = require('../../src/platforms/youtube');
                return new YouTubePlatform(config, undefined);
            };

            expect(initializeWithoutDeps).toThrow();
            expect(initializeWithoutDeps).toThrow(/missing required dependencies: logger/i);
        });

        it('should help users understand dependency injection patterns', () => {
            const attemptIncorrectInjection = () => {
                const config = { youtube: { apiKey: 'test-key' } };
                const { YouTubePlatform } = require('../../src/platforms/youtube');
                return new YouTubePlatform(config, 'invalid_dependencies_string');
            };

            expect(attemptIncorrectInjection).toThrow();
            expect(attemptIncorrectInjection).toThrow(/dependencies.*should.*be.*single.*object.*with.*logger.*property/i);
        });
    });

    describe('Integration Point Validation', () => {
        it('should validate main.js to platform dependency handoff', () => {
            const simulateMainJsHandoff = () => {
                const dependencies = {
                    logger: noOpLogger,
                    notificationManager: { emit: createMockFn(), on: createMockFn(), removeListener: createMockFn() },
                    app: { handleChatMessage: createMockFn() },
                    streamDetectionService: {
                        detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
                    }
                };

                const config = { youtube: { apiKey: 'test-key' } };
                const { YouTubePlatform } = require('../../src/platforms/youtube');
                return new YouTubePlatform(config, dependencies);
            };

            expect(simulateMainJsHandoff).not.toThrow();
        });

        it('should ensure consistent dependency interfaces across all platforms', () => {
            const universalDependencies = {
                logger: noOpLogger,
                notificationManager: { emit: createMockFn(), on: createMockFn(), removeListener: createMockFn() },
                app: { handleChatMessage: createMockFn() },
                streamDetectionService: {
                    detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
                }
            };

            const testMultiplePlatforms = () => {
                const config = {
                    youtube: { apiKey: 'test-key' },
                    tiktok: { apiKey: 'test-key' }
                };

                const { YouTubePlatform } = require('../../src/platforms/youtube');
                const youtubeOk = new YouTubePlatform(config, universalDependencies);
                return { youtubeOk };
            };

            expect(testMultiplePlatforms).not.toThrow();
        });
    });
});
