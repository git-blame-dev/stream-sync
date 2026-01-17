const { describe, test, expect } = require('bun:test');
const { noOpLogger } = require('../../helpers/mock-factories');
const { PlatformConnectionFactory } = require('../../../src/utils/platform-connection-factory');

describe('platform-connection-factory behavior', () => {

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

    test('wraps non-emitter connections returned by TikTok constructor', () => {
        const factory = new PlatformConnectionFactory(noOpLogger);
        const deps = {
            logger: noOpLogger,
            TikTokWebSocketClient: function() { this.connect = () => {}; }
        };

        const conn = factory.createConnection('tiktok', { username: 'testuser' }, deps);
        expect(typeof conn.on).toBe('function');
        expect(typeof conn.removeAllListeners).toBe('function');
    });

    test('throws on missing inputs', () => {
        const factory = new PlatformConnectionFactory(noOpLogger);
        expect(() => factory.createConnection(null, {}, { logger: noOpLogger })).toThrow('Platform name is required');
        expect(() => factory.createConnection('tiktok', null, { logger: noOpLogger })).toThrow('Configuration is required');
        expect(() => factory.createConnection('tiktok', {}, null)).toThrow('missing dependencies');
        expect(() => factory.createConnection('tiktok', {}, { logger: null })).toThrow('missing dependencies (logger)');
    });

    test('creates TikTok connections and propagates constructor errors', () => {
        const factory = new PlatformConnectionFactory(noOpLogger);
        const deps = {
            logger: noOpLogger,
            TikTokWebSocketClient: function() { throw new Error('construct fail'); }
        };

        expect(() => factory.createConnection('tiktok', { username: 'testuser' }, deps)).toThrow('construct fail');
    });

    test('throws for unsupported platform', () => {
        const factory = new PlatformConnectionFactory(noOpLogger);
        expect(() => factory.createConnection('unknown', {}, { logger: noOpLogger })).toThrow('Unsupported platform');
    });

    test('logs masked apiKey when building TikTok connection config', () => {
        const logCollector = createLogCollector();
        const factory = new PlatformConnectionFactory(logCollector);

        const apiKey = 'euler_1234567890abcdef';
        const config = factory.buildTikTokConnectionConfig({ apiKey });

        expect(config.apiKey).toBe(apiKey);
        expect(logCollector.entries.some((entry) => entry.level === 'debug' && entry.message.includes('EulerStream API key'))).toBe(true);
        expect(logCollector.entries.every((entry) => !entry.message.includes(apiKey))).toBe(true);
    });

    test('warns when TikTok apiKey is missing from config', () => {
        const logCollector = createLogCollector();
        const factory = new PlatformConnectionFactory(logCollector);

        const config = factory.buildTikTokConnectionConfig({});

        expect(config.apiKey).toBeNull();
        expect(logCollector.entries.some((entry) => entry.level === 'warn' && entry.message.toLowerCase().includes('no api key'))).toBe(true);
    });
});
