const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const { EventEmitter } = require('events');

mockModule('../../../src/utils/logger-utils', () => ({
    getLazyUnifiedLogger: () => ({
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn()
    }),
    createNoopLogger: () => ({
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn()
    }),
    getLoggerOrNoop: (logger) => logger || ({
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn()
    })
}));

mockModule('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: createMockFn(() => ({
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn()
    }))
}));

mockModule('../../../src/utils/dependency-validator', () => ({
    validateLoggerInterface: createMockFn(() => true)
}));

const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const { validateLoggerInterface } = require('../../../src/utils/dependency-validator');
const { PlatformConnectionFactory } = require('../../../src/utils/platform-connection-factory');

describe('platform-connection-factory behavior', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    const logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() };
    const createLogCollector = () => {
        const entries = [];
        const collect = (level) => (message) => entries.push({ level, message });
        return {
            entries,
            debug: collect('debug'),
            info: collect('info'),
            warn: collect('warn'),
            error: collect('error')
        };
    };

    beforeEach(() => {
        });

    it('wraps non-emitter connections returned by TikTok constructor', () => {
        const factory = new PlatformConnectionFactory(logger);
        const deps = {
            logger,
            TikTokWebSocketClient: createMockFn(() => ({ connect: createMockFn() }))
        };

        const conn = factory.createConnection('tiktok', { username: 'user' }, deps);
        expect(typeof conn.on).toBe('function');
        expect(typeof conn.removeAllListeners).toBe('function');
    });

    it('throws on missing inputs and validates logger dependency', () => {
        const factory = new PlatformConnectionFactory(logger);
        expect(() => factory.createConnection(null, {}, { logger })).toThrow('Platform name is required');
        expect(() => factory.createConnection('tiktok', null, { logger })).toThrow('Configuration is required');
        expect(() => factory.createConnection('tiktok', {}, null)).toThrow('missing dependencies');
        expect(() => factory.createConnection('tiktok', {}, { logger: null })).toThrow('missing dependencies (logger)');
        expect(validateLoggerInterface).toHaveBeenCalled();
    });

    it('creates TikTok connections and routes constructor errors', () => {
        const factory = new PlatformConnectionFactory(logger);
        const deps = {
            logger,
            TikTokWebSocketClient: createMockFn(() => {
                throw new Error('construct fail');
            })
        };

        expect(() => factory.createConnection('tiktok', { username: 'user' }, deps)).toThrow('construct fail');
        expect(createPlatformErrorHandler).toHaveBeenCalled();
    });

    it('throws for unsupported platform', () => {
        const factory = new PlatformConnectionFactory(logger);
        expect(() => factory.createConnection('unknown', {}, { logger })).toThrow('Unsupported platform');
    });

    it('logs masked apiKey when building TikTok connection config', () => {
        const logCollector = createLogCollector();
        const factory = new PlatformConnectionFactory(logCollector);

        const apiKey = 'euler_1234567890abcdef';
        const config = factory.buildTikTokConnectionConfig({ apiKey });

        expect(config.apiKey).toBe(apiKey);
        expect(logCollector.entries.some((entry) => entry.level === 'debug' && entry.message.includes('EulerStream API key'))).toBe(true);
        expect(logCollector.entries.every((entry) => !entry.message.includes(apiKey))).toBe(true);
    });

    it('warns when TikTok apiKey is missing from config', () => {
        const logCollector = createLogCollector();
        const factory = new PlatformConnectionFactory(logCollector);

        const config = factory.buildTikTokConnectionConfig({});

        expect(config.apiKey).toBeNull();
        expect(logCollector.entries.some((entry) => entry.level === 'warn' && entry.message.toLowerCase().includes('no api key'))).toBe(true);
    });
});
