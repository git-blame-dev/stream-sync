const { describe, expect, it } = require('bun:test');
const { noOpLogger } = require('../../helpers/mock-factories');
const {
    validateLoggerInterface,
    validateNotificationManagerInterface,
    validateConnectionFactoryInterface,
    validateYouTubePlatformDependencies,
    validateConnectionStateManagerDependencies,
    validateFactoryCanCreateConnections,
    createStandardDependencies
} = require('../../../src/utils/dependency-validator.ts');

export {};

describe('dependency-validator behavior', () => {
    it('validates logger interfaces and surfaces missing method guidance', () => {
        expect(() => validateLoggerInterface(null)).toThrow(/Logger dependency is required/);
        expect(() => validateLoggerInterface({})).toThrow(/Logger interface missing required methods: debug, info, error, warn/);
        expect(() => validateLoggerInterface(noOpLogger)).not.toThrow();
    });

    it('validates notification manager and YouTube platform dependencies', () => {
        expect(() => validateNotificationManagerInterface(null)).toThrow(/NotificationManager dependency is required/);
        expect(() => validateNotificationManagerInterface({ emit: () => {} })).toThrow(/missing required methods: on/);

        const deps = { logger: noOpLogger, streamDetectionService: { detectLiveStreams: () => {} } };
        expect(() => validateYouTubePlatformDependencies(deps)).not.toThrow();

        const missingLogger = { streamDetectionService: { detectLiveStreams: () => {} } };
        expect(() => validateYouTubePlatformDependencies(missingLogger)).toThrow(/Missing required dependencies: logger/);

        const invalidViewerProvider = { ...deps, viewerCountProvider: {} };
        expect(() => validateYouTubePlatformDependencies(invalidViewerProvider)).toThrow(/viewerCountProvider must implement getViewerCount/);

        expect(() => validateYouTubePlatformDependencies({ logger: 'invalid', streamDetectionService: { detectLiveStreams: () => {} } }))
            .toThrow(/Logger expected object/);
    });

    it('validates connection factory and state manager dependency contracts', () => {
        expect(() => validateConnectionFactoryInterface(null)).toThrow(/Connection factory is required/);
        expect(() => validateConnectionFactoryInterface({})).toThrow(/missing createConnection method/);
        expect(() => validateConnectionFactoryInterface({ createConnection: () => ({}) })).not.toThrow();

        expect(() => validateConnectionStateManagerDependencies(null, { logger: noOpLogger }))
            .toThrow(/missing required configuration/);
        expect(() => validateConnectionStateManagerDependencies({}, null))
            .toThrow(/missing required dependencies/);
        expect(() => validateConnectionStateManagerDependencies({}, {}))
            .toThrow(/missing required dependencies \(logger\)/);
        expect(() => validateConnectionStateManagerDependencies({}, { logger: noOpLogger }))
            .not.toThrow();
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

        const invalidTypeFactory = { createConnection: () => 'bad-connection' };
        expect(() => validateFactoryCanCreateConnections(invalidTypeFactory, 'twitch', {}, {}))
            .toThrow(/Factory returned invalid connection type for twitch/);
    });

    it('creates standard dependencies structure once logger validates', () => {
        const deps = createStandardDependencies('youtube', noOpLogger);
        expect(deps.logger).toBeDefined();
        expect(typeof deps.notificationManager.emit).toBe('function');
        expect(typeof deps.displayQueue.add).toBe('function');
    });
});
