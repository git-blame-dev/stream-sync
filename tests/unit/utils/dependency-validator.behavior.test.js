const { describe, test, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const {
    validateLoggerInterface,
    validateNotificationManagerInterface,
    validateYouTubePlatformDependencies,
    validateFactoryCanCreateConnections,
    createStandardDependencies
} = require('../../../src/utils/dependency-validator');

describe('dependency-validator behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const validLogger = () => ({
        debug: createMockFn(),
        info: createMockFn(),
        error: createMockFn(),
        warn: createMockFn()
    });

    it('validates logger interfaces and surfaces missing method guidance', () => {
        expect(() => validateLoggerInterface(null)).toThrow(/Logger dependency is required/);
        expect(() => validateLoggerInterface({})).toThrow(/Logger interface missing required methods: debug, info, error, warn/);
        expect(() => validateLoggerInterface(validLogger())).not.toThrow();
    });

    it('validates notification manager and YouTube platform dependencies', () => {
        expect(() => validateNotificationManagerInterface(null)).toThrow(/NotificationManager dependency is required/);
        expect(() => validateNotificationManagerInterface({ emit: () => {} })).toThrow(/missing required methods: on/);

        const deps = { logger: validLogger(), streamDetectionService: { detectLiveStreams: () => {} } };
        expect(() => validateYouTubePlatformDependencies(deps)).not.toThrow();

        const missingLogger = { streamDetectionService: { detectLiveStreams: () => {} } };
        expect(() => validateYouTubePlatformDependencies(missingLogger)).toThrow(/Missing required dependencies: logger/);

        const invalidViewerProvider = { ...deps, viewerCountProvider: {} };
        expect(() => validateYouTubePlatformDependencies(invalidViewerProvider)).toThrow(/viewerCountProvider must implement getViewerCount/);
    });

    it('wraps connection factory errors with platform context', () => {
        const factory = {
            createConnection: () => { throw new Error('factory boom'); }
        };

        expect(() => validateFactoryCanCreateConnections(factory, 'youtube', {}, {}))
            .toThrow(/Factory failed to create valid connection for youtube: factory boom/);

        const nullFactory = { createConnection: () => null };
        expect(() => validateFactoryCanCreateConnections(nullFactory, 'tiktok', {}, {}))
            .toThrow(/Factory returned null\/undefined connection for tiktok/);
    });

    it('creates standard dependencies structure once logger validates', () => {
        const deps = createStandardDependencies('youtube', validLogger());
        expect(deps.logger).toBeDefined();
        expect(typeof deps.notificationManager.emit).toBe('function');
        expect(typeof deps.displayQueue.add).toBe('function');
    });
});
