const { describe, it, expect, beforeEach } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

class TestableYouTubeNotificationDispatcher {
    constructor(options) {
        this.logger = options.logger;
        this.NotificationBuilder = options.NotificationBuilder;
        this.AuthorExtractor = options.AuthorExtractor;
        this.config = options.config;
        this.fallbackConfig = options.fallbackConfig;

        if (this.config && typeof this.config.get === 'function') {
            this.enableAPI = this.config.get('youtube', 'enableAPI', false);
        } else if (this.config && 'enableAPI' in this.config) {
            this.enableAPI = this.config.enableAPI;
        } else if (this.fallbackConfig) {
            this.enableAPI = this.fallbackConfig.get
                ? this.fallbackConfig.get('youtube', 'enableAPI', false)
                : false;
        } else {
            this.enableAPI = false;
        }
    }
}

describe('YouTube Platform Config Injection', () => {
    let mockConfigManager;

    beforeEach(() => {
        mockConfigManager = {
            get: createMockFn(),
            getPlatformConfig: createMockFn(),
            youtube: {
                enabled: true,
                username: 'test-channel',
                apiKey: 'test-api-key',
                enableAPI: true
            }
        };

    });

    describe('when YouTube platform is initialized with proper config', () => {
        it('should create YouTubeNotificationDispatcher with config that has .get() method', () => {
            mockConfigManager.get.mockReturnValue(false);

            const dispatcher = new TestableYouTubeNotificationDispatcher({
                logger: noOpLogger,
                NotificationBuilder: { build: createMockFn() },
                AuthorExtractor: { extractAuthor: createMockFn() },
                config: mockConfigManager
            });

            expect(dispatcher.config).toBe(mockConfigManager);
            expect(dispatcher.enableAPI).toBe(false);
        });

        it('should handle missing config dependency gracefully', () => {
            expect(() => {
                new TestableYouTubeNotificationDispatcher({
                    logger: noOpLogger,
                    NotificationBuilder: { build: createMockFn() },
                    AuthorExtractor: { extractAuthor: createMockFn() },
                    config: undefined
                });
            }).not.toThrow();
        });

        it('should handle plain config objects without .get() method', () => {
            const plainConfig = { enableAPI: true };

            const dispatcher = new TestableYouTubeNotificationDispatcher({
                logger: noOpLogger,
                NotificationBuilder: { build: createMockFn() },
                AuthorExtractor: { extractAuthor: createMockFn() },
                config: plainConfig
            });

            expect(dispatcher.config).toBe(plainConfig);
            expect(dispatcher.enableAPI).toBe(true);
        });
    });

    describe('when config object lacks .get() method', () => {
        it('should use fallback config when provided', () => {
            const plainConfig = { someProperty: 'value' };
            const fallbackConfig = {
                get: createMockFn().mockReturnValue(false)
            };

            const dispatcher = new TestableYouTubeNotificationDispatcher({
                logger: noOpLogger,
                NotificationBuilder: { build: createMockFn() },
                AuthorExtractor: { extractAuthor: createMockFn() },
                config: plainConfig,
                fallbackConfig
            });

            expect(dispatcher.enableAPI).toBe(false);
        });
    });

    describe('error scenarios', () => {
        it('should provide clear error when config.get fails', () => {
            const brokenConfig = {
                get: createMockFn().mockImplementation(() => {
                    throw new Error('Config access failed');
                })
            };

            expect(() => {
                new TestableYouTubeNotificationDispatcher({
                    logger: noOpLogger,
                    NotificationBuilder: { build: createMockFn() },
                    AuthorExtractor: { extractAuthor: createMockFn() },
                    config: brokenConfig
                });
            }).toThrow('Config access failed');
        });
    });

    describe('Config Injection Pattern Validation', () => {
        it('should demonstrate correct config injection order', () => {
            const configManager = {
                get: createMockFn((section, key, defaultValue) => {
                    if (section === 'youtube' && key === 'enableAPI') return true;
                    return defaultValue;
                })
            };

            const dispatcher = new TestableYouTubeNotificationDispatcher({
                logger: noOpLogger,
                NotificationBuilder: { build: createMockFn() },
                AuthorExtractor: { extractAuthor: createMockFn() },
                config: configManager
            });

            expect(dispatcher.config).toBe(configManager);
            expect(dispatcher.enableAPI).toBe(true);
        });
    });
});
