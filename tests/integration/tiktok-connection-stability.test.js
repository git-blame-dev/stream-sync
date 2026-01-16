const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const { TikTokPlatform } = require('../../src/platforms/tiktok');

describe('TikTok Platform Validation', () => {
    let mockDependencies;

    beforeEach(() => {
        mockDependencies = {
            logger: noOpLogger,
            TikTokWebSocketClient: createMockFn(),
            WebcastEvent: { CHAT: 'chat', GIFT: 'gift', FOLLOW: 'follow' },
            ControlEvent: { CONNECTED: 'connected' },
            WebcastPushConnection: createMockFn(),
            constants: { GRACE_PERIODS: { TIKTOK: 5000 } }
        };
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('Platform Construction and Basic Validation', () => {
        it('should be importable and constructible', () => {
            expect(TikTokPlatform).toBeDefined();
            expect(typeof TikTokPlatform).toBe('function');

            const config = { enabled: true, username: 'test_user' };
            let platform;
            expect(() => {
                platform = new TikTokPlatform(config, mockDependencies);
            }).not.toThrow();

            expect(platform).toBeDefined();
            expect(platform instanceof TikTokPlatform).toBe(true);
        });

        it('should validate platform instance structure', () => {
            const config = { enabled: true, username: 'test_user' };
            const platform = new TikTokPlatform(config, mockDependencies);

            expect(platform).toBeDefined();
            expect(typeof platform).toBe('object');
            expect(platform.constructor.name).toBe('TikTokPlatform');
        });

        it('should have expected methods available', () => {
            const config = { enabled: true, username: 'test_user' };
            const platform = new TikTokPlatform(config, mockDependencies);

            const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(platform))
                .filter(name => typeof platform[name] === 'function' && name !== 'constructor');

            expect(methods).toBeDefined();
            expect(Array.isArray(methods)).toBe(true);
            expect(methods.length).toBeGreaterThan(0);
        });

        it('should accept injected logger dependency', () => {
            const config = { enabled: true, username: 'test_user' };
            const platform = new TikTokPlatform(config, mockDependencies);

            expect(platform.logger).toBe(noOpLogger);
        });

        it('should validate TikTok Platform prototype structure', () => {
            const prototype = TikTokPlatform.prototype;
            const prototypeMethodNames = Object.getOwnPropertyNames(prototype);

            expect(prototype).toBeDefined();
            expect(prototypeMethodNames).toBeDefined();
            expect(Array.isArray(prototypeMethodNames)).toBe(true);
        });

        it('should store provided config', () => {
            const config = { enabled: true, username: 'test_user' };
            const platform = new TikTokPlatform(config, mockDependencies);

            expect(platform.config).toBeDefined();
            expect(platform.config.enabled).toBe(true);
            expect(platform.config.username).toBe('test_user');
        });
    });
});
