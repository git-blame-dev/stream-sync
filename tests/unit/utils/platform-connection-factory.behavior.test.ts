const { describe, test, expect, afterEach } = require('bun:test');
export {};
const { noOpLogger } = require('../../helpers/mock-factories');
const { PlatformConnectionFactory } = require('../../../src/utils/platform-connection-factory');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../src/core/secrets');

describe('platform-connection-factory behavior', () => {
    afterEach(() => {
        _resetForTesting();
        initializeStaticSecrets();
    });

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
        secrets.tiktok.apiKey = apiKey;
        const config = factory.buildTikTokConnectionConfig({});

        expect(config.apiKey).toBe(apiKey);
        expect(logCollector.entries.some((entry) => entry.level === 'debug' && entry.message.includes('EulerStream API key'))).toBe(true);
        expect(logCollector.entries.every((entry) => !entry.message.includes(apiKey))).toBe(true);
    });

    test('warns when TikTok apiKey is missing from config', () => {
        const logCollector = createLogCollector();
        const factory = new PlatformConnectionFactory(logCollector);

        _resetForTesting();
        const config = factory.buildTikTokConnectionConfig({});

        expect(config.apiKey).toBeNull();
        expect(logCollector.entries.some((entry) => entry.level === 'warn' && entry.message.toLowerCase().includes('no api key'))).toBe(true);
    });

    test('preserves class-based logger prototype methods', () => {
        let warnCalls = 0;

        class PrototypeLogger {
            debug() {}

            info() {}

            warn() {
                warnCalls += 1;
            }

            error() {}
        }

        const logger = new PrototypeLogger();
        const factory = new PlatformConnectionFactory(logger);

        _resetForTesting();
        factory.buildTikTokConnectionConfig({});

        expect(warnCalls).toBeGreaterThan(0);
    });

    test('supports incomplete logger implementations via normalized behavior', () => {
        const loggerWithOnlyDebug = {
            debug: () => {}
        };

        const factory = new PlatformConnectionFactory(loggerWithOnlyDebug);

        _resetForTesting();
        expect(() => factory.buildTikTokConnectionConfig({})).not.toThrow();
    });

    test('creates YouTube connection with compatibility methods', async () => {
        const factory = new PlatformConnectionFactory(noOpLogger);
        const connection = factory.createConnection('youtube', { username: 'test-youtube-user' }, { logger: noOpLogger });

        expect(connection.platform).toBe('youtube');
        expect(connection.isConnected()).toBe(false);

        await connection.connect();
        expect(connection.isConnected()).toBe(true);

        await connection.disconnect();
        expect(connection.isConnected()).toBe(false);
        expect(connection.getUsername()).toBe('test-youtube-user');
    });

    test('throws for twitch creation placeholder path', () => {
        const factory = new PlatformConnectionFactory(noOpLogger);

        expect(() => factory.createConnection('twitch', { username: 'test-user' }, { logger: noOpLogger }))
            .toThrow('Twitch connection creation not yet implemented');
    });

    test('fails dependency logger validation before platform creation', () => {
        const factory = new PlatformConnectionFactory(noOpLogger);
        const deps = {
            logger: {},
            TikTokWebSocketClient: function() { this.connect = () => {}; }
        };

        expect(() => factory.createConnection('tiktok', { username: 'testuser' }, deps))
            .toThrow('Platform creation failed for tiktok');
    });

    test('strips @ prefix from tiktok username before constructing connection', () => {
        const factory = new PlatformConnectionFactory(noOpLogger);
        let capturedUsername = null;

        function TikTokWebSocketClient(username) {
            capturedUsername = username;
            this.connect = () => {};
            this.on = () => {};
            this.emit = () => {};
            this.removeAllListeners = () => {};
        }

        factory.createConnection('tiktok', { username: '@testuser' }, {
            logger: noOpLogger,
            TikTokWebSocketClient
        });

        expect(capturedUsername).toBe('testuser');
    });

    test('fails when TikTokWebSocketClient dependency is missing', () => {
        const factory = new PlatformConnectionFactory(noOpLogger);

        expect(() => factory.createConnection('tiktok', { username: 'testuser' }, { logger: noOpLogger }))
            .toThrow('missing TikTokWebSocketClient');
    });

    test('fails when constructed TikTok connection lacks connect method', () => {
        const factory = new PlatformConnectionFactory(noOpLogger);

        function TikTokWebSocketClient() {
            this.on = () => {};
            this.emit = () => {};
            this.removeAllListeners = () => {};
        }

        expect(() => factory.createConnection('tiktok', { username: 'testuser' }, {
            logger: noOpLogger,
            TikTokWebSocketClient
        })).toThrow('missing essential method: connect');
    });

    test('supports platform helpers for supported and unsupported values', () => {
        const factory = new PlatformConnectionFactory(noOpLogger);

        expect(factory.getSupportedPlatforms()).toEqual(['tiktok', 'youtube']);
        expect(factory.isPlatformSupported('tiktok')).toBe(true);
        expect(factory.isPlatformSupported('youtube')).toBe(true);
        expect(factory.isPlatformSupported('twitch')).toBe(false);
        expect(factory.isPlatformSupported(null)).toBe(false);
    });
});
