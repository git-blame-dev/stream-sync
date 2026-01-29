const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

describe('TikTokPlatform Error Handling', () => {
    let TikTokPlatform;
    let mockConnection;
    let mockRetrySystem;
    let baseConfig;
    let baseDependencies;

    beforeEach(() => {
        ({ TikTokPlatform } = require('../../../src/platforms/tiktok'));

        mockConnection = {
            connect: createMockFn(),
            fetchIsLive: createMockFn(),
            waitUntilLive: createMockFn(),
            on: createMockFn(),
            getState: createMockFn().mockReturnValue({ isConnected: false })
        };

        const retrySystemCalls = { handleConnectionError: [] };
        mockRetrySystem = {
            handleConnectionError: (err) => retrySystemCalls.handleConnectionError.push(err),
            handleConnectionSuccess: createMockFn(),
            resetRetryCount: createMockFn(),
            incrementRetryCount: createMockFn(),
            executeWithRetry: createMockFn(),
            _calls: retrySystemCalls
        };

        baseConfig = {
            enabled: true,
            username: 'testUser',
            dataLoggingEnabled: false
        };

        baseDependencies = {
            logger: noOpLogger,
            retrySystem: mockRetrySystem,
            WebcastPushConnection: createMockFn(() => mockConnection),
            WebcastEvent: { GIFT: 'gift', FOLLOW: 'follow', CHAT: 'chat' },
            ControlEvent: {},
            TikTokWebSocketClient: createMockFn(() => mockConnection)
        };
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('handleConnectionError', () => {
        test('handles error object without message property without crashing', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);
            const errorWithoutMessage = {};

            expect(() => {
                platform.handleConnectionError(errorWithoutMessage);
            }).not.toThrow();
        });

        test('handles null error gracefully', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);

            expect(() => {
                platform.handleConnectionError(null);
            }).not.toThrow();
        });

        test('handles string error properly', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);
            const stringError = 'Connection timeout';

            expect(() => {
                platform.handleConnectionError(stringError);
            }).not.toThrow();
        });

        test('handles TLS errors without crashing', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);
            const tlsError = new Error('Client network socket disconnected before secure TLS connection was established');

            expect(() => {
                platform.handleConnectionError(tlsError);
            }).not.toThrow();
        });

        test('handles room info retrieval failures without crashing', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);
            const roomError = new Error('Failed to retrieve room info');

            expect(() => {
                platform.handleConnectionError(roomError);
            }).not.toThrow();
        });

        test('handles timeout errors without crashing', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);
            const timeoutError = new Error('Connection timeout exceeded');

            expect(() => {
                platform.handleConnectionError(timeoutError);
            }).not.toThrow();
        });

        test('cleans up connection state after error', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);
            platform.connection = mockConnection;
            platform.connectionActive = true;
            platform.listenersConfigured = true;

            platform.handleConnectionError(new Error('Test error'));

            expect(platform.connection).toBeNull();
            expect(platform.connectionActive).toBe(false);
            expect(platform.listenersConfigured).toBe(false);
        });

        test('triggers retry system on error', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);

            platform.handleConnectionError(new Error('Test error'));

            expect(mockRetrySystem._calls.handleConnectionError.length).toBeGreaterThan(0);
        });
    });

    describe('stream not live detection', () => {
        test('handles stream not live error without crashing', () => {
            const platform = new TikTokPlatform(baseConfig, baseDependencies);
            const notLiveError = new Error('Stream is not live');

            expect(() => {
                platform.handleConnectionError(notLiveError);
            }).not.toThrow();
        });
    });
});
